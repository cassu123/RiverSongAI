"""
api/routes/fleet.py

Generic device-fleet API for the River Song satellite programs that don't
have a dedicated router yet: Horizon (drones), Kova (chore robots),
Sentinel (patrol robots), and Vortex (home hubs).

This generalizes the proven River Vector pattern — admin claims a unit and
receives a unit token; the device then authenticates every call with the
X-Unit-Token header. One implementation, mounted once per program, so each
satellite gets the prefix its client code expects (/api/horizon/...,
/api/kova/..., etc.).

River Vector keeps its richer dedicated router (zones, mowing programs,
schedules) in vector_fleet.py; this module is the on-ramp for everything
else. Domain-specific behavior can graduate to a dedicated router later
without changing the device-facing contract.

Surface (per program):
  Admin (JWT, admin role):
    POST   /units/claim            {name}            → {unit_id, unit_token}
    GET    /units                                    → [{unit_id, name, online, ...}]
    DELETE /units/{unit_id}
    POST   /units/{unit_id}/command {command, params} → {command_id}
  Device (X-Unit-Token):
    POST   /register               {unit_id, metadata?}
    POST   /heartbeat              {unit_id}
    POST   /telemetry              {unit_id, snapshots: [{timestamp, ...}]}
    POST   /alerts                 {unit_id, level, message}
    GET    /commands?unit_id=...                     → oldest pending or 204
    POST   /commands/{command_id}/ack {status}
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from core.auth import require_role
from core.webhook_tokens import constant_time_match, hash_token
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

FLEET_PROGRAMS = ("horizon", "kova", "sentinel", "vortex", "vexa")

_MAX_TELEMETRY_BATCH = 50
_ACK_STATUSES = {"acknowledged", "rejected", "completed", "failed"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS fleet_units (
    program        TEXT NOT NULL,
    unit_id        TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    unit_token     TEXT NOT NULL,
    metadata       TEXT NOT NULL DEFAULT '{}',
    online         INTEGER NOT NULL DEFAULT 0,
    registered_at  TEXT,
    last_seen      TEXT,
    PRIMARY KEY (program, unit_id)
);
CREATE TABLE IF NOT EXISTS fleet_telemetry (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    program   TEXT NOT NULL,
    unit_id   TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    payload   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_unit
    ON fleet_telemetry(program, unit_id, timestamp);
CREATE TABLE IF NOT EXISTS fleet_alerts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    program   TEXT NOT NULL,
    unit_id   TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    level     TEXT NOT NULL DEFAULT 'info',
    message   TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fleet_commands (
    command_id TEXT PRIMARY KEY,
    program    TEXT NOT NULL,
    unit_id    TEXT NOT NULL,
    payload    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    issued_at  TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fleet_commands_pending
    ON fleet_commands(program, unit_id, status, issued_at);
"""

_schema_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ensure_schema(store: SQLiteStore) -> None:
    global _schema_ready
    if _schema_ready:
        return
    for statement in _SCHEMA.split(";"):
        if statement.strip():
            await store.execute_write_async(statement, ())
    _schema_ready = True


async def _verify_unit(store: SQLiteStore, program: str, unit_id: str,
                       token: Optional[str]) -> dict:
    unit = await store.execute_read_one_async(
        "SELECT * FROM fleet_units WHERE program=? AND unit_id=?",
        (program, unit_id),
    )
    # unit_token stores sha256(token); hash the presented token and compare in
    # constant time. Legacy plaintext rows fail here and must be re-claimed.
    if not unit or not token or not constant_time_match(
            unit["unit_token"], hash_token(token)):
        raise HTTPException(status_code=401, detail="Invalid unit credentials")
    return unit


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ClaimBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RegisterBody(BaseModel):
    unit_id: str
    metadata: Optional[Dict[str, Any]] = None


class HeartbeatBody(BaseModel):
    unit_id: str


class TelemetryBody(BaseModel):
    unit_id: str
    snapshots: List[Dict[str, Any]]


class AlertBody(BaseModel):
    unit_id: str
    level: str = "info"
    message: str = ""


class CommandBody(BaseModel):
    command: str
    params: Optional[Dict[str, Any]] = None


class AckBody(BaseModel):
    status: str = "acknowledged"


class SimulateBody(BaseModel):
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# Router factory — one identical router per program prefix
# ---------------------------------------------------------------------------

def build_fleet_router(program: str) -> APIRouter:
    router = APIRouter(prefix=f"/api/{program}", tags=[f"fleet:{program}"])

    # ---- Admin surface ----

    @router.post("/units/claim", dependencies=[Depends(require_role("admin"))])
    async def claim_unit(body: ClaimBody):
        store = SQLiteStore()
        await _ensure_schema(store)
        unit_id = uuid.uuid4().hex[:12]
        unit_token = uuid.uuid4().hex + uuid.uuid4().hex
        # Store only the hash; the plaintext is returned to the admin once, here.
        await store.execute_write_async(
            "INSERT INTO fleet_units (program, unit_id, name, unit_token, registered_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (program, unit_id, body.name, hash_token(unit_token), _now()),
        )
        logger.info("Fleet %s: claimed unit %s (%s)", program, unit_id, body.name)
        return {"unit_id": unit_id, "unit_token": unit_token}

    @router.get("/units", dependencies=[Depends(require_role("admin"))])
    async def list_units():
        store = SQLiteStore()
        await _ensure_schema(store)
        rows = await store.execute_read_async(
            "SELECT program, unit_id, name, metadata, online, registered_at, last_seen "
            "FROM fleet_units WHERE program=? ORDER BY registered_at",
            (program,),
        )
        for r in rows:
            try:
                r["metadata"] = json.loads(r.get("metadata") or "{}")
            except ValueError:
                r["metadata"] = {}
        return {"units": rows}

    @router.get("/units/{unit_id}", dependencies=[Depends(require_role("admin"))])
    async def get_unit(unit_id: str):
        store = SQLiteStore()
        await _ensure_schema(store)
        row = await store.execute_read_one_async(
            "SELECT program, unit_id, name, metadata, online, registered_at, last_seen "
            "FROM fleet_units WHERE program=? AND unit_id=?",
            (program, unit_id),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Unit not found")
        try:
            row["metadata"] = json.loads(row.get("metadata") or "{}")
        except ValueError:
            row["metadata"] = {}
        return row

    @router.get("/units/{unit_id}/telemetry",
                dependencies=[Depends(require_role("admin"))])
    async def unit_telemetry(unit_id: str, limit: int = 100):
        store = SQLiteStore()
        await _ensure_schema(store)
        limit = max(1, min(limit, 1000))
        rows = await store.execute_read_async(
            "SELECT timestamp, payload FROM fleet_telemetry "
            "WHERE program=? AND unit_id=? ORDER BY id DESC LIMIT ?",
            (program, unit_id, limit),
        )
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"])
            except ValueError:
                payload = {}
            payload.setdefault("timestamp", r["timestamp"])
            out.append(payload)
        out.reverse()  # oldest → newest for charting
        return {"telemetry": out}

    @router.get("/units/{unit_id}/alerts",
                dependencies=[Depends(require_role("admin"))])
    async def unit_alerts(unit_id: str, limit: int = 50):
        store = SQLiteStore()
        await _ensure_schema(store)
        limit = max(1, min(limit, 500))
        rows = await store.execute_read_async(
            "SELECT id, timestamp, level, message FROM fleet_alerts "
            "WHERE program=? AND unit_id=? ORDER BY id DESC LIMIT ?",
            (program, unit_id, limit),
        )
        return {"alerts": rows}

    @router.get("/units/{unit_id}/commands",
                dependencies=[Depends(require_role("admin"))])
    async def unit_commands(unit_id: str, limit: int = 50):
        store = SQLiteStore()
        await _ensure_schema(store)
        limit = max(1, min(limit, 500))
        rows = await store.execute_read_async(
            "SELECT command_id, payload, status, issued_at, updated_at "
            "FROM fleet_commands WHERE program=? AND unit_id=? "
            "ORDER BY issued_at DESC LIMIT ?",
            (program, unit_id, limit),
        )
        for r in rows:
            try:
                r["payload"] = json.loads(r["payload"])
            except ValueError:
                r["payload"] = {}
        return {"commands": rows}

    @router.post("/units/{unit_id}/alerts/{alert_id}/ack",
                 dependencies=[Depends(require_role("admin"))])
    async def ack_alert(unit_id: str, alert_id: int):
        store = SQLiteStore()
        await _ensure_schema(store)
        await store.execute_write_async(
            "DELETE FROM fleet_alerts WHERE program=? AND unit_id=? AND id=?",
            (program, unit_id, alert_id),
        )
        return {"status": "ok"}

    @router.post("/units/{unit_id}/rotate-token",
                 dependencies=[Depends(require_role("admin"))])
    async def rotate_token(unit_id: str):
        store = SQLiteStore()
        await _ensure_schema(store)
        unit = await store.execute_read_one_async(
            "SELECT unit_id FROM fleet_units WHERE program=? AND unit_id=?",
            (program, unit_id),
        )
        if not unit:
            raise HTTPException(status_code=404, detail="Unit not found")
        new_token = uuid.uuid4().hex + uuid.uuid4().hex
        # Persist only the hash; return the plaintext to the admin once, here.
        await store.execute_write_async(
            "UPDATE fleet_units SET unit_token=? WHERE program=? AND unit_id=?",
            (hash_token(new_token), program, unit_id),
        )
        return {"unit_id": unit_id, "unit_token": new_token}

    @router.delete("/units/{unit_id}", dependencies=[Depends(require_role("admin"))])
    async def delete_unit(unit_id: str):
        store = SQLiteStore()
        await _ensure_schema(store)
        from core.fleet_simulator import stop_sim
        await stop_sim(unit_id)
        await store.execute_write_async(
            "DELETE FROM fleet_units WHERE program=? AND unit_id=?",
            (program, unit_id),
        )
        return {"status": "ok"}

    # ---- Simulator (admin) — spin up a fake unit you can watch live ----

    @router.post("/units/simulate",
                 dependencies=[Depends(require_role("admin"))])
    async def simulate_unit(body: SimulateBody = SimulateBody()):
        store = SQLiteStore()
        await _ensure_schema(store)
        unit_id = "sim-" + uuid.uuid4().hex[:8]
        unit_token = uuid.uuid4().hex + uuid.uuid4().hex
        name = (body.name or "").strip() or f"Sim {program.capitalize()} {unit_id[-4:]}"
        await store.execute_write_async(
            "INSERT INTO fleet_units "
            "(program, unit_id, name, unit_token, metadata, online, registered_at, last_seen) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            (program, unit_id, name, unit_token,
             json.dumps({"simulated": True}), _now(), _now()),
        )
        from core.fleet_simulator import start_sim
        await start_sim(program, unit_id)
        logger.info("Fleet %s: started simulated unit %s", program, unit_id)
        return {"unit_id": unit_id, "name": name, "simulated": True}

    @router.delete("/units/{unit_id}/simulate",
                   dependencies=[Depends(require_role("admin"))])
    async def stop_simulated_unit(unit_id: str):
        from core.fleet_simulator import stop_sim
        await stop_sim(unit_id)
        store = SQLiteStore()
        await _ensure_schema(store)
        await store.execute_write_async(
            "DELETE FROM fleet_units WHERE program=? AND unit_id=?",
            (program, unit_id),
        )
        return {"status": "ok"}

    @router.post("/units/{unit_id}/command",
                 dependencies=[Depends(require_role("admin"))])
    async def queue_command(unit_id: str, body: CommandBody):
        store = SQLiteStore()
        await _ensure_schema(store)
        unit = await store.execute_read_one_async(
            "SELECT unit_id FROM fleet_units WHERE program=? AND unit_id=?",
            (program, unit_id),
        )
        if not unit:
            raise HTTPException(status_code=404, detail="Unit not found")
        command_id = uuid.uuid4().hex
        payload = json.dumps({"command": body.command, "params": body.params or {}})
        await store.execute_write_async(
            "INSERT INTO fleet_commands (command_id, program, unit_id, payload, issued_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (command_id, program, unit_id, payload, _now()),
        )
        return {"command_id": command_id}

    # ---- Device surface ----

    @router.post("/register")
    async def register(body: RegisterBody,
                       x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        await _verify_unit(store, program, body.unit_id, x_unit_token)
        await store.execute_write_async(
            "UPDATE fleet_units SET online=1, last_seen=?, metadata=? "
            "WHERE program=? AND unit_id=?",
            (_now(), json.dumps(body.metadata or {}), program, body.unit_id),
        )
        return {"status": "ok"}

    @router.post("/heartbeat")
    async def heartbeat(body: HeartbeatBody,
                        x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        await _verify_unit(store, program, body.unit_id, x_unit_token)
        await store.execute_write_async(
            "UPDATE fleet_units SET online=1, last_seen=? WHERE program=? AND unit_id=?",
            (_now(), program, body.unit_id),
        )
        return {"status": "ok"}

    @router.post("/telemetry")
    async def telemetry(body: TelemetryBody,
                        x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        await _verify_unit(store, program, body.unit_id, x_unit_token)
        if len(body.snapshots) > _MAX_TELEMETRY_BATCH:
            raise HTTPException(status_code=413,
                                detail=f"Batch size limit exceeded (max {_MAX_TELEMETRY_BATCH})")
        now = _now()
        for snap in body.snapshots:
            ts = str(snap.get("timestamp") or now)
            await store.execute_write_async(
                "INSERT INTO fleet_telemetry (program, unit_id, timestamp, payload) "
                "VALUES (?, ?, ?, ?)",
                (program, body.unit_id, ts, json.dumps(snap)),
            )
        await store.execute_write_async(
            "UPDATE fleet_units SET online=1, last_seen=? WHERE program=? AND unit_id=?",
            (now, program, body.unit_id),
        )
        return {"status": "ok", "stored": len(body.snapshots)}

    @router.post("/alerts")
    async def alert(body: AlertBody,
                    x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        await _verify_unit(store, program, body.unit_id, x_unit_token)
        await store.execute_write_async(
            "INSERT INTO fleet_alerts (program, unit_id, timestamp, level, message) "
            "VALUES (?, ?, ?, ?, ?)",
            (program, body.unit_id, _now(), body.level, body.message[:2000]),
        )
        logger.warning("Fleet %s alert from %s [%s]: %s",
                       program, body.unit_id, body.level, body.message[:200])
        from core.initiative import InitiativeEvent, get_initiative_engine
        await get_initiative_engine().submit(InitiativeEvent(
            kind="device_alert",
            title=f"{program.capitalize()} unit {body.unit_id}",
            message=body.message[:300],
            severity="critical" if body.level.lower() in ("critical", "emergency") else "warning",
            key=f"{program}:{body.unit_id}:{body.level}",
        ))
        return {"status": "ok"}

    @router.get("/commands")
    async def poll_commands(unit_id: str,
                            x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        await _verify_unit(store, program, unit_id, x_unit_token)
        row = await store.execute_read_one_async(
            "SELECT command_id, payload, issued_at FROM fleet_commands "
            "WHERE program=? AND unit_id=? AND status='pending' "
            "ORDER BY issued_at ASC LIMIT 1",
            (program, unit_id),
        )
        if not row:
            return Response(status_code=204)
        return {
            "command_id": row["command_id"],
            "issued_at": row["issued_at"],
            **json.loads(row["payload"]),
        }

    @router.post("/commands/{command_id}/ack")
    async def ack_command(command_id: str, body: AckBody,
                          x_unit_token: Optional[str] = Header(default=None)):
        store = SQLiteStore()
        await _ensure_schema(store)
        cmd = await store.execute_read_one_async(
            "SELECT unit_id FROM fleet_commands WHERE program=? AND command_id=?",
            (program, command_id),
        )
        if not cmd:
            raise HTTPException(status_code=404, detail="Command not found")
        await _verify_unit(store, program, cmd["unit_id"], x_unit_token)
        status = body.status if body.status in _ACK_STATUSES else "acknowledged"
        await store.execute_write_async(
            "UPDATE fleet_commands SET status=?, updated_at=? WHERE command_id=?",
            (status, _now(), command_id),
        )
        return {"status": "ok"}

    return router


fleet_routers = [build_fleet_router(p) for p in FLEET_PROGRAMS]
