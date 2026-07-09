"""
api/routes/kova.py

River Kova — household chore robot fleet (repo: cassu123/river-kova).

Kova graduated from the generic satellite fleet on-ramp (fleet.py) to this
dedicated router because its robot-side client speaks a different contract
(see river-kova connectivity/api_client.py): the unit authenticates with a
bearer API key plus an X-Kova-Unit header carrying its robot_id, and the
robot_id is chosen by the unit's profile (kova_profile.json) rather than
generated at claim time.

Surface:
  Admin (JWT, admin role):
    POST   /api/kova/units/claim          {robot_id, name?} → {robot_id, api_key}
    GET    /api/kova/units                                  → {units: [...]}
    DELETE /api/kova/units/{robot_id}
    POST   /api/kova/units/{robot_id}/tasks {chore_type, room?, priority?}
                                                            → {task_id}
    GET    /api/kova/units/{robot_id}/alerts                → {alerts: [...]}
  Device (Bearer api_key + X-Kova-Unit):
    POST   /api/kova/units/register       {robot_id, timestamp}
    POST   /api/kova/units/deregister     {robot_id, timestamp}
    POST   /api/kova/heartbeat            {robot_id, state, safety_level,
                                           battery_pct, timestamp, ...extra}
    GET    /api/kova/units/{robot_id}/tasks                 → {tasks: [...]}
    POST   /api/kova/tasks/{task_id}/status {robot_id, status, message}
    POST   /api/kova/telemetry            {robot_id, timestamp, metrics}
    POST   /api/kova/alerts               {robot_id, level, message}

The latest heartbeat (state, safety_level, battery_pct) is stored on the
unit row so the dashboard's GET /units shows live fleet state. CRITICAL
alerts fan out as push notifications to admins, mirroring vector_fleet.
Voice chores reach a unit's queue through dispatch_chore(), called by the
kova_chores intent in core/intent_router.py.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from core.auth import require_role
from core.webhook_tokens import constant_time_match, hash_token
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kova", tags=["kova"])

# Mirrors ChoreType in river-kova core/constants.py.
CHORE_TYPES = {
    "VACUUM", "MOP", "FETCH", "ORGANIZE", "WIPE_SURFACE", "TAKE_OUT_TRASH",
    "LOAD_DISHWASHER", "UNLOAD_DISHWASHER", "LAUNDRY_TRANSFER", "CUSTOM",
}

# Mirrors TaskStatus in river-kova core/constants.py.
_TASK_STATUSES = {"IDLE", "QUEUED", "RUNNING", "PAUSED",
                  "COMPLETED", "FAILED", "ABORTED"}

_ALERT_SEVERITY = {"CRITICAL": "critical", "ERROR": "warning",
                   "WARN": "warning", "INFO": "info"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kova_units (
    robot_id       TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT '',
    api_key        TEXT NOT NULL,
    online         INTEGER NOT NULL DEFAULT 0,
    state          TEXT,
    safety_level   TEXT,
    battery_pct    REAL,
    heartbeat_extra TEXT NOT NULL DEFAULT '{}',
    heartbeat_ts   REAL,
    claimed_at     TEXT,
    registered_at  TEXT,
    last_seen      TEXT
);
CREATE TABLE IF NOT EXISTS kova_tasks (
    task_id      TEXT PRIMARY KEY,
    robot_id     TEXT NOT NULL,
    chore_type   TEXT NOT NULL,
    room         TEXT,
    priority     INTEGER NOT NULL DEFAULT 5,
    status       TEXT NOT NULL DEFAULT 'QUEUED',
    source       TEXT NOT NULL DEFAULT 'admin',
    requested_by TEXT,
    message      TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_kova_tasks_pending
    ON kova_tasks(robot_id, status, priority, created_at);
CREATE TABLE IF NOT EXISTS kova_telemetry (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    robot_id  TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metrics   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kova_telemetry_unit
    ON kova_telemetry(robot_id, timestamp);
CREATE TABLE IF NOT EXISTS kova_alerts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    robot_id  TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    level     TEXT NOT NULL DEFAULT 'INFO',
    message   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_kova_alerts_unit
    ON kova_alerts(robot_id, timestamp);
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


async def _verify_device(store: SQLiteStore,
                         x_kova_unit: Optional[str],
                         authorization: Optional[str]) -> dict:
    if not x_kova_unit:
        raise HTTPException(status_code=401, detail="Missing X-Kova-Unit")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    api_key = authorization.removeprefix("Bearer ")
    unit = await store.execute_read_one_async(
        "SELECT * FROM kova_units WHERE robot_id=?", (x_kova_unit,))
    # api_key column stores sha256(key); hash the presented key and compare in
    # constant time. Legacy plaintext rows fail here and must be re-claimed.
    if not unit or not constant_time_match(
            unit["api_key"], hash_token(api_key)):
        raise HTTPException(status_code=401, detail="Invalid unit credentials")
    return unit


def _require_unit_match(unit: dict, robot_id: str) -> None:
    if robot_id != unit["robot_id"]:
        raise HTTPException(status_code=403,
                            detail="robot_id does not match X-Kova-Unit")


async def dispatch_chore(chore_type: str,
                         room: Optional[str] = None,
                         priority: int = 5,
                         source: str = "admin",
                         requested_by: str = "",
                         robot_id: Optional[str] = None,
                         ) -> Tuple[Optional[str], Optional[dict]]:
    """
    Queue a chore for a Kova unit. Used by the admin task endpoint and the
    kova_chores voice intent (core/intent_router.py).

    Picks the target unit when robot_id is not given: online units first,
    then most recently seen. Returns (task_id, unit) or (None, None) when
    no unit is available.
    """
    if chore_type not in CHORE_TYPES:
        raise ValueError(f"Unknown chore type '{chore_type}'")
    store = SQLiteStore()
    await _ensure_schema(store)
    if robot_id:
        unit = await store.execute_read_one_async(
            "SELECT * FROM kova_units WHERE robot_id=?", (robot_id,))
    else:
        unit = await store.execute_read_one_async(
            "SELECT * FROM kova_units ORDER BY online DESC, last_seen DESC "
            "LIMIT 1", ())
    if not unit:
        return None, None

    task_id = str(uuid.uuid4())
    await store.execute_write_async(
        "INSERT INTO kova_tasks (task_id, robot_id, chore_type, room, "
        "priority, status, source, requested_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)",
        (task_id, unit["robot_id"], chore_type, room,
         max(1, min(10, priority)), source, requested_by, _now()),
    )
    logger.info("Kova: queued %s (room=%s, priority=%d) for %s via %s",
                chore_type, room, priority, unit["robot_id"], source)
    return task_id, unit


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ClaimBody(BaseModel):
    robot_id: str = Field(min_length=1, max_length=64,
                          pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(default="", max_length=120)


class RegisterBody(BaseModel):
    robot_id: str
    timestamp: Optional[float] = None


class HeartbeatBody(BaseModel):
    # The client merges arbitrary "extra" keys into the top-level payload.
    model_config = ConfigDict(extra="allow")

    robot_id: str
    state: str
    safety_level: str
    battery_pct: float
    timestamp: Optional[float] = None


class TaskStatusBody(BaseModel):
    robot_id: str
    status: str
    message: str = ""
    timestamp: Optional[float] = None


class TelemetryBody(BaseModel):
    robot_id: str
    timestamp: Optional[float] = None
    metrics: Dict[str, Any] = {}


class AlertBody(BaseModel):
    robot_id: str
    level: str = "INFO"
    message: str = ""
    timestamp: Optional[float] = None


class QueueTaskBody(BaseModel):
    chore_type: str
    room: Optional[str] = None
    priority: int = Field(default=5, ge=1, le=10)


# ---------------------------------------------------------------------------
# Admin surface (JWT)
# ---------------------------------------------------------------------------

@router.post("/units/claim", dependencies=[Depends(require_role("admin"))])
async def claim_unit(body: ClaimBody):
    store = SQLiteStore()
    await _ensure_schema(store)
    existing = await store.execute_read_one_async(
        "SELECT robot_id FROM kova_units WHERE robot_id=?", (body.robot_id,))
    if existing:
        raise HTTPException(status_code=409, detail="robot_id already claimed")
    api_key = uuid.uuid4().hex + uuid.uuid4().hex
    # Store only the hash; the plaintext key is returned to the admin once, here.
    await store.execute_write_async(
        "INSERT INTO kova_units (robot_id, name, api_key, claimed_at) "
        "VALUES (?, ?, ?, ?)",
        (body.robot_id, body.name or body.robot_id, hash_token(api_key), _now()),
    )
    logger.info("Kova: claimed unit %s (%s)", body.robot_id, body.name)
    return {"robot_id": body.robot_id, "api_key": api_key}


@router.get("/units", dependencies=[Depends(require_role("admin"))])
async def list_units():
    store = SQLiteStore()
    await _ensure_schema(store)
    rows = await store.execute_read_async(
        "SELECT robot_id, name, online, state, safety_level, battery_pct, "
        "heartbeat_extra, heartbeat_ts, claimed_at, registered_at, last_seen "
        "FROM kova_units ORDER BY claimed_at",
        (),
    )
    for r in rows:
        try:
            r["heartbeat_extra"] = json.loads(r.get("heartbeat_extra") or "{}")
        except ValueError:
            r["heartbeat_extra"] = {}
    return {"units": rows}


@router.delete("/units/{robot_id}",
               dependencies=[Depends(require_role("admin"))])
async def delete_unit(robot_id: str):
    store = SQLiteStore()
    await _ensure_schema(store)
    await store.execute_write_async(
        "DELETE FROM kova_units WHERE robot_id=?", (robot_id,))
    return {"status": "ok"}


@router.post("/units/{robot_id}/tasks",
             dependencies=[Depends(require_role("admin"))])
async def queue_task(robot_id: str, body: QueueTaskBody):
    chore_type = body.chore_type.upper()
    if chore_type not in CHORE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown chore_type. Valid: {sorted(CHORE_TYPES)}")
    task_id, unit = await dispatch_chore(
        chore_type, body.room, body.priority,
        source="admin", robot_id=robot_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return {"task_id": task_id}


@router.get("/units/{robot_id}/alerts",
            dependencies=[Depends(require_role("admin"))])
async def list_alerts(robot_id: str, limit: int = 50):
    store = SQLiteStore()
    await _ensure_schema(store)
    rows = await store.execute_read_async(
        "SELECT robot_id, timestamp, level, message FROM kova_alerts "
        "WHERE robot_id=? ORDER BY timestamp DESC LIMIT ?",
        (robot_id, max(1, min(limit, 500))),
    )
    return {"alerts": rows}


# ---------------------------------------------------------------------------
# Device surface (Bearer api_key + X-Kova-Unit)
# ---------------------------------------------------------------------------

@router.post("/units/register")
async def register_unit(body: RegisterBody,
                        x_kova_unit: Optional[str] = Header(default=None),
                        authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    now = _now()
    await store.execute_write_async(
        "UPDATE kova_units SET online=1, state='BOOTING', registered_at=?, "
        "last_seen=? WHERE robot_id=?",
        (now, now, body.robot_id),
    )
    logger.info("Kova: unit %s registered", body.robot_id)
    return {"status": "ok", "robot_id": body.robot_id}


@router.post("/units/deregister")
async def deregister_unit(body: RegisterBody,
                          x_kova_unit: Optional[str] = Header(default=None),
                          authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    await store.execute_write_async(
        "UPDATE kova_units SET online=0, state='SHUTDOWN', last_seen=? "
        "WHERE robot_id=?",
        (_now(), body.robot_id),
    )
    logger.info("Kova: unit %s deregistered", body.robot_id)
    return {"status": "ok"}


@router.post("/heartbeat")
async def heartbeat(body: HeartbeatBody,
                    x_kova_unit: Optional[str] = Header(default=None),
                    authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    await store.execute_write_async(
        "UPDATE kova_units SET online=1, state=?, safety_level=?, "
        "battery_pct=?, heartbeat_extra=?, heartbeat_ts=?, last_seen=? "
        "WHERE robot_id=?",
        (body.state, body.safety_level, body.battery_pct,
         json.dumps(body.model_extra or {}), body.timestamp, _now(),
         body.robot_id),
    )
    return {"status": "ok"}


@router.get("/units/{robot_id}/tasks")
async def poll_tasks(robot_id: str,
                     x_kova_unit: Optional[str] = Header(default=None),
                     authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, robot_id)
    rows = await store.execute_read_async(
        "SELECT task_id, chore_type, room, priority, source, requested_by, "
        "created_at FROM kova_tasks WHERE robot_id=? AND status='QUEUED' "
        "ORDER BY priority DESC, created_at ASC",
        (robot_id,),
    )
    now = _now()
    tasks = []
    for row in rows:
        await store.execute_write_async(
            "UPDATE kova_tasks SET status='SENT', updated_at=? "
            "WHERE task_id=?",
            (now, row["task_id"]),
        )
        # "id" matches the descriptor shape TaskManager.submit() builds on
        # the robot; task_id is kept alongside for explicit correlation.
        tasks.append({
            "id": row["task_id"],
            "task_id": row["task_id"],
            "chore_type": row["chore_type"],
            "room": row["room"],
            "priority": row["priority"],
            "source": row["source"],
            "requested_by": row["requested_by"],
            "created_at": row["created_at"],
        })
    await store.execute_write_async(
        "UPDATE kova_units SET online=1, last_seen=? WHERE robot_id=?",
        (now, robot_id),
    )
    return {"tasks": tasks}


@router.post("/tasks/{task_id}/status")
async def report_task_status(task_id: str, body: TaskStatusBody,
                             x_kova_unit: Optional[str] = Header(default=None),
                             authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    task = await store.execute_read_one_async(
        "SELECT robot_id FROM kova_tasks WHERE task_id=?", (task_id,))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["robot_id"] != unit["robot_id"]:
        raise HTTPException(status_code=403,
                            detail="Task belongs to another unit")
    status = body.status.upper()
    if status not in _TASK_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown status. Valid: {sorted(_TASK_STATUSES)}")
    await store.execute_write_async(
        "UPDATE kova_tasks SET status=?, message=?, updated_at=? "
        "WHERE task_id=?",
        (status, body.message[:1000], _now(), task_id),
    )
    return {"status": "ok"}


@router.post("/telemetry")
async def post_telemetry(body: TelemetryBody,
                         x_kova_unit: Optional[str] = Header(default=None),
                         authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    now = _now()
    await store.execute_write_async(
        "INSERT INTO kova_telemetry (robot_id, timestamp, metrics) "
        "VALUES (?, ?, ?)",
        (body.robot_id, now, json.dumps(body.metrics)),
    )
    await store.execute_write_async(
        "UPDATE kova_units SET online=1, last_seen=? WHERE robot_id=?",
        (now, body.robot_id),
    )
    return {"status": "ok"}


@router.post("/alerts")
async def post_alert(body: AlertBody,
                     x_kova_unit: Optional[str] = Header(default=None),
                     authorization: Optional[str] = Header(default=None)):
    store = SQLiteStore()
    await _ensure_schema(store)
    unit = await _verify_device(store, x_kova_unit, authorization)
    _require_unit_match(unit, body.robot_id)
    level = body.level.upper()
    await store.execute_write_async(
        "INSERT INTO kova_alerts (robot_id, timestamp, level, message) "
        "VALUES (?, ?, ?, ?)",
        (body.robot_id, _now(), level, body.message[:2000]),
    )
    logger.warning("Kova alert from %s [%s]: %s",
                   body.robot_id, level, body.message[:200])

    from core.initiative import InitiativeEvent, get_initiative_engine
    await get_initiative_engine().submit(InitiativeEvent(
        kind="device_alert",
        title=f"Kova unit {unit.get('name') or body.robot_id}",
        message=body.message[:300],
        severity=_ALERT_SEVERITY.get(level, "warning"),
        key=f"kova:{body.robot_id}:{level}",
    ))

    if level == "CRITICAL":
        try:
            from providers.push.notifier import notify_user
            admin_users = await store.execute_read_async(
                "SELECT id FROM users WHERE role IN ('admin', 'operator')")
            import asyncio as _asyncio
            await _asyncio.gather(
                *[
                    notify_user(
                        store, u["id"],
                        title=f"Kova CRITICAL: {unit.get('name') or body.robot_id}",
                        body=body.message[:500],
                    )
                    for u in admin_users
                ],
                return_exceptions=True,
            )
        except Exception as e:
            logger.error("Kova push notification failed: %s", e)

    return {"status": "ok"}
