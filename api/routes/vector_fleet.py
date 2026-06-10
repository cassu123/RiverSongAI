"""
api/routes/vector_fleet.py
"""
from sse_starlette.sse import EventSourceResponse
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx
from croniter import croniter

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from core.auth import require_role
from config.settings import get_settings
from providers.memory.sqlite_store import SQLiteStore, _safe_cols

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vector", tags=["vector-fleet"])

# Global event maps for long polling and SSE
# unit_id -> asyncio.Event
_COMMAND_EVENTS: Dict[str, asyncio.Event] = {}
_TELEMETRY_EVENTS: Dict[str, asyncio.Event] = {}
_FLEET_UPDATE_EVENT = asyncio.Event()


def _get_command_event(unit_id: str) -> asyncio.Event:
    if unit_id not in _COMMAND_EVENTS:
        _COMMAND_EVENTS[unit_id] = asyncio.Event()
    return _COMMAND_EVENTS[unit_id]


def _get_telemetry_event(unit_id: str) -> asyncio.Event:
    if unit_id not in _TELEMETRY_EVENTS:
        _TELEMETRY_EVENTS[unit_id] = asyncio.Event()
    return _TELEMETRY_EVENTS[unit_id]

# ---------------------------------------------------------------------------
# Auth helpers imported from core.auth
# ---------------------------------------------------------------------------


async def _verify_unit_token(
        unit_id: str, x_unit_token: Optional[str] = Header(default=None)):
    if not x_unit_token:
        raise HTTPException(status_code=401, detail="Missing X-Unit-Token")
    store = SQLiteStore()
    unit = await store.get_vector_unit(unit_id)
    if not unit or unit.get("unit_token") != x_unit_token:
        raise HTTPException(status_code=401, detail="Invalid token")
    return unit

# ---------------------------------------------------------------------------
# Internal Endpoint for Daemons
# ---------------------------------------------------------------------------


@router.post("/internal/wake/{unit_id}")
async def internal_wake_queue(unit_id: str, request: Request):
    auth_header = request.headers.get("Authorization")
    settings = get_settings()
    expected = f"Bearer {settings.daemon_internal_secret}"
    if not auth_header or auth_header != expected:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    event = _get_command_event(unit_id)
    event.set()
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Mower-facing endpoints (§6.1)
# ---------------------------------------------------------------------------


class RegisterBody(BaseModel):
    unit_id: str
    firmware_version: Optional[str] = None
    boot_time: Optional[str] = None
    ip_address: Optional[str] = None
    connectivity_tier: str = "lan"


@router.post("/register")
async def register_unit(body: RegisterBody, request: Request):
    store = SQLiteStore()
    unit = await store.get_vector_unit(body.unit_id)
    if not unit:
        raise HTTPException(status_code=401, detail="Unit not claimed")

    x_unit_token = request.headers.get("X-Unit-Token")
    if not x_unit_token or x_unit_token != unit.get("unit_token"):
        raise HTTPException(status_code=401, detail="Invalid token")

    now = datetime.now(timezone.utc).isoformat()
    await store.update_vector_unit(body.unit_id, {
        "firmware_version": body.firmware_version,
        "last_ip": body.ip_address,
        "connectivity_tier": body.connectivity_tier,
        "last_seen": now,
        "online": 1
    })
    return {"status": "ok"}


@router.get("/config/{unit_id}")
async def get_config(unit_id: str, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(unit_id, x_unit_token)
    store = SQLiteStore()
    unit = await store.get_vector_unit(unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    revision_row = await store.execute_read_one_async("SELECT revision FROM vector_config_revisions WHERE unit_id=?", (unit_id,))
    revision = revision_row["revision"] if revision_row else 1

    hardware = json.loads(unit.get("hardware") or "{}")
    safety_floors = json.loads(unit.get("safety_floors") or "{}")
    home_position = json.loads(unit.get("home_position") or "{}")

    prog = await store.execute_read_one_async("SELECT * FROM vector_programs WHERE assigned_unit_id=?", (unit_id,))
    assigned_program = None
    if prog:
        zone_ids = json.loads(prog["zone_ids"] or "[]")
        zones = []
        for zid in zone_ids:
            z = await store.execute_read_one_async("SELECT * FROM vector_zones WHERE zone_id=?", (zid,))
            if z:
                zones.append({
                    "zone_id": z["zone_id"],
                    "name": z["name"],
                    "boundary": json.loads(z["boundary"] or "[]"),
                    "no_go_areas": json.loads(z["no_go_areas"] or "[]"),
                    "area_sqm": z["area_sqm"]
                })
        assigned_program = {
            "program_id": prog["program_id"],
            "name": prog["name"],
            "pattern": prog["pattern"],
            "direction_deg": prog["direction_deg"],
            "overlap_pct": prog["overlap_pct"],
            "obstacle_clearance_m": prog["obstacle_clearance_m"],
            "edge_distance_m": prog["edge_distance_m"],
            "speed_profile": prog["speed_profile"],
            "zones": zones
        }

    absolute_floors = {
        "min_obstacle_clearance_m": 0.10,
        "min_imu_tilt_cutoff_deg": 10.0,
        "max_imu_tilt_cutoff_deg": 25.0,
        "min_watchdog_timeout_ms": 250,
        "max_watchdog_timeout_ms": 2000
    }

    config = {
        "unit_id": unit_id,
        "name": unit["name"],
        "config_version": revision,
        "hardware": hardware,
        "safety_floors": safety_floors,
        "home_position": home_position,
        "assigned_program": assigned_program,
        "absolute_floors": absolute_floors
    }

    return JSONResponse(config, headers={"X-Config-Version": str(revision)})


@router.get("/command/stream/{unit_id}")
async def command_stream(
        unit_id: str, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(unit_id, x_unit_token)
    store = SQLiteStore()

    revision_row = await store.execute_read_one_async("SELECT revision FROM vector_config_revisions WHERE unit_id=?", (unit_id,))
    revision = revision_row["revision"] if revision_row else 1
    headers = {"X-Config-Version": str(revision)}

    cmd = await store.get_oldest_pending_command(unit_id)
    if cmd:
        await store.update_command_status(cmd["command_id"], "dispatched")
        return JSONResponse(dict(cmd), headers=headers)

    event = _get_command_event(unit_id)
    event.clear()

    try:
        await asyncio.wait_for(event.wait(), timeout=30.0)
        cmd = await store.get_oldest_pending_command(unit_id)
        if cmd:
            await store.update_command_status(cmd["command_id"], "dispatched")
            return JSONResponse(dict(cmd), headers=headers)
    except asyncio.TimeoutError:
        pass

    return Response(status_code=204, headers=headers)


class AckBody(BaseModel):
    status: str


@router.post("/command/{command_id}/ack")
async def command_ack(command_id: str, body: AckBody,
                      x_unit_token: str = Header(default=None)):
    store = SQLiteStore()
    cmd = await store.execute_read_one_async("SELECT unit_id FROM vector_commands WHERE command_id=?", (command_id,))
    if not cmd:
        raise HTTPException(404)
    await _verify_unit_token(cmd["unit_id"], x_unit_token)

    status = body.status if body.status in [
        "acknowledged", "rejected"] else "acknowledged"
    await store.update_command_status(command_id, status)
    return {"status": "ok"}


class ResultBody(BaseModel):
    status: str
    result: Optional[str] = None


@router.post("/command/{command_id}/complete")
async def command_complete(
        command_id: str, body: ResultBody, x_unit_token: str = Header(default=None)):
    store = SQLiteStore()
    cmd = await store.execute_read_one_async("SELECT unit_id FROM vector_commands WHERE command_id=?", (command_id,))
    if not cmd:
        raise HTTPException(404)
    await _verify_unit_token(cmd["unit_id"], x_unit_token)

    sql = "UPDATE vector_commands SET status=?, completed_at=?, result=? WHERE command_id=?"
    await store.execute_write_async(sql, (body.status, datetime.now(timezone.utc).isoformat(), body.result, command_id))
    return {"status": "ok"}


class StatusBody(BaseModel):
    unit_id: str
    operating_mode: Optional[str] = None
    session_state: Optional[str] = None


@router.post("/status")
async def post_status(body: StatusBody,
                      x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    await store.update_vector_unit(body.unit_id, {
        "operating_mode": body.operating_mode,
        "session_state": body.session_state,
        "last_seen": now
    })
    _get_telemetry_event(body.unit_id).set()
    _get_telemetry_event(body.unit_id).clear()
    _FLEET_UPDATE_EVENT.set()
    _FLEET_UPDATE_EVENT.clear()
    return {"status": "ok"}


class SessionStartBody(BaseModel):
    unit_id: str
    program_id: Optional[str] = None
    config_version: int
    started_at: str


@router.post("/session/start")
async def session_start(body: SessionStartBody,
                        x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    session_id = uuid.uuid4().hex
    sql = """
    INSERT INTO vector_sessions (session_id, unit_id, program_id, config_version, started_at, status)
    VALUES (?, ?, ?, ?, ?, 'active')
    """
    await store.execute_write_async(sql, (session_id, body.unit_id, body.program_id, body.config_version, body.started_at))
    return {"session_id": session_id}


class SessionEndBody(BaseModel):
    unit_id: str
    session_id: str
    ended_at: str
    status: str
    area_mowed_sqm: Optional[float] = None
    battery_used_pct: Optional[float] = None
    fuel_used_pct: Optional[float] = None
    abort_reason: Optional[str] = None


@router.post("/session/end")
async def session_end(body: SessionEndBody,
                      x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    sql = """
    UPDATE vector_sessions
    SET ended_at=?, status=?, area_mowed_sqm=?, battery_used_pct=?, fuel_used_pct=?, abort_reason=?
    WHERE session_id=? AND unit_id=?
    """
    await store.execute_write_async(sql, (body.ended_at, body.status, body.area_mowed_sqm, body.battery_used_pct, body.fuel_used_pct, body.abort_reason, body.session_id, body.unit_id))
    return {"status": "ok"}

_TEACH_WAYPOINTS: dict[tuple[str, str], list] = {}


class TeachBody(BaseModel):
    unit_id: str
    zone_name: str
    waypoints: List[Dict[str, float]]
    finalize: bool


@router.post("/zones/teach")
async def zones_teach(body: TeachBody,
                      x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    key = (body.unit_id, body.zone_name)
    if key not in _TEACH_WAYPOINTS:
        _TEACH_WAYPOINTS[key] = []
    _TEACH_WAYPOINTS[key].extend(body.waypoints)

    if body.finalize:
        store = SQLiteStore()
        zone_id = uuid.uuid4().hex
        boundary = _TEACH_WAYPOINTS.pop(key, [])
        now = datetime.now(timezone.utc).isoformat()

        # simple area calculation approximation
        area_sqm = len(boundary) * 0.1

        sql = """
        INSERT INTO vector_zones (zone_id, name, created_by, created_at, updated_at, boundary, no_go_areas, area_sqm, capture_method)
        VALUES (?, ?, 'system', ?, ?, ?, '[]', ?, 'taught')
        """
        await store.execute_write_async(sql, (zone_id, body.zone_name, now, now, json.dumps(boundary), area_sqm))
        return {"status": "ok", "zone_id": zone_id}

    return {"status": "ok"}


class TelemetrySnapshot(BaseModel):
    timestamp: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    heading_deg: Optional[float] = None
    speed_kmh: Optional[float] = None
    battery_v: Optional[float] = None
    battery_pct: Optional[float] = None
    fuel_pct: Optional[float] = None
    engine_rpm: Optional[int] = None
    temp_c: Optional[float] = None
    operating_mode: Optional[str] = None
    progress_pct: Optional[float] = None
    active_faults: Optional[List[str]] = None
    connectivity_tier: Optional[str] = None


class TelemetryBatchBody(BaseModel):
    unit_id: str
    snapshots: List[TelemetrySnapshot]


@router.post("/telemetry")
async def post_telemetry(body: TelemetryBatchBody,
                         x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    if len(body.snapshots) > 50:
        raise HTTPException(status_code=413,
                            detail="Batch size limit exceeded (max 50)")

    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()

    latest_mode = None
    latest_faults = None
    latest_tier = None

    for snap in body.snapshots:
        fields = snap.model_dump()
        fields["unit_id"] = body.unit_id
        if fields["active_faults"] is not None:
            fields["active_faults"] = json.dumps(fields["active_faults"])
        await store.insert_telemetry(fields)

        if fields.get("operating_mode") is not None:
            latest_mode = fields["operating_mode"]
        if fields.get("active_faults") is not None:
            latest_faults = fields["active_faults"]
        if fields.get("connectivity_tier") is not None:
            latest_tier = fields["connectivity_tier"]

    await store.update_vector_unit(body.unit_id, {
        "last_seen": now,
        "operating_mode": latest_mode,
        "active_faults": latest_faults,
        "connectivity_tier": latest_tier
    })

    _get_telemetry_event(body.unit_id).set()
    _get_telemetry_event(body.unit_id).clear()
    _FLEET_UPDATE_EVENT.set()
    _FLEET_UPDATE_EVENT.clear()

    return {"status": "ok"}


class AlertBody(BaseModel):
    unit_id: str
    session_id: Optional[str] = None
    level: str
    title: str
    message: Optional[str] = None
    fault_code: Optional[str] = None


@router.post("/alert")
async def post_alert(body: AlertBody,
                     x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    fields = body.model_dump()
    fields["timestamp"] = now
    await store.insert_alert(fields)

    if body.level.lower() == "critical":
        try:
            from providers.push.notifier import notify_user
            admin_users = await store.execute_read_async(
                "SELECT id FROM users WHERE role IN ('admin', 'operator')"
            )
            # Fan out in parallel across admins + their devices via
            # notify_user.
            import asyncio as _asyncio
            await _asyncio.gather(
                *[
                    notify_user(
                        store, u["id"],
                        title="Critical Fleet Alert",
                        body=f"{body.title}: {body.message}",
                    )
                    for u in admin_users
                ],
                return_exceptions=True,
            )
        except Exception as e:
            logger.error(f"Push notification failed: {e}")

    return {"status": "ok"}


class EventBody(BaseModel):
    unit_id: str
    session_id: str
    event: str
    data: Dict[str, Any] = {}


@router.post("/event")
async def post_event(body: EventBody,
                     x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    await store.insert_session_event(body.session_id, body.unit_id, body.event, json.dumps(body.data))
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# UI-facing endpoints (§6.2)
# ---------------------------------------------------------------------------


@router.get("/units",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def list_units():
    return await SQLiteStore().get_vector_units()


@router.get("/units/discovered", dependencies=[Depends(require_role("admin"))])
async def list_discovered():
    try:
        from daemons.registry import call_daemon
        res = await call_daemon("vector_discovery", "get_discovered")
        return res.get("discovered", [])
    except Exception as e:
        logger.error(f"Failed to fetch discovered units: {e}")
        return []


class ClaimBody(BaseModel):
    claim_code: str


@router.post("/units/{unit_id}/claim",
             dependencies=[Depends(require_role("admin"))])
async def claim_unit(unit_id: str, body: ClaimBody):
    # 1. Lookup IP from mDNS
    try:
        from daemons.registry import call_daemon
        res = await call_daemon("vector_discovery", "get_discovered")
        discovered = res.get("discovered", [])
    except Exception:
        raise HTTPException(status_code=500, detail="Discovery daemon offline")

    target_ip = None
    for d in discovered:
        if d.get("unit_id") == unit_id:
            target_ip = d.get("ip_address")
            break

    if not target_ip:
        raise HTTPException(status_code=404, detail="Unit not found on LAN")

    # 2. Generate token
    import secrets
    import base64
    raw_token = secrets.token_bytes(32)
    unit_token = base64.b64encode(raw_token).decode('utf-8')

    # 3. Call device
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"http://{target_ip}:8765/verify-claim",
                json={"claim_code": body.claim_code, "unit_token": unit_token}
            )
            if resp.status_code != 200 or resp.json().get("status") != "claimed":
                raise HTTPException(
                    status_code=400,
                    detail="Device rejected claim code")
    except httpx.RequestError:
        raise HTTPException(status_code=502,
                            detail="Failed to reach device claim server")

    # 4. Insert into DB
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    # insert_vector_unit needs unit_id, name, platform, unit_token,
    # registered_at, claimed_at
    await store.insert_vector_unit(
        unit_id=unit_id,
        name="New Unit",
        platform="unknown",
        unit_token=unit_token,
        registered_at=now,
        claimed_at=now
    )
    # init config revision
    await store.execute_write_async("INSERT INTO vector_config_revisions (unit_id, revision, updated_at) VALUES (?, 1, ?)", (unit_id, now))

    return {"status": "claimed", "unit_id": unit_id}


@router.get("/units/{id}",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit(id: str):
    unit = await SQLiteStore().get_vector_unit(id)
    if not unit:
        raise HTTPException(404)
    return unit


@router.get("/units/{id}/stream")
async def unit_sse_stream(id: str, request: Request, user: dict = Depends(
        require_role("operator", "viewer"))):
    store = SQLiteStore()
    event = _get_telemetry_event(id)

    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                await asyncio.wait_for(event.wait(), timeout=15.0)
                tel = await store.execute_read_one_async("SELECT * FROM vector_telemetry WHERE unit_id=? ORDER BY timestamp DESC LIMIT 1", (id,))
                if tel:
                    yield f"data: {json.dumps(tel)}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def queue_command(unit_id: str, action: str, params: dict):
    cmd_id = uuid.uuid4().hex
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    sql = "INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, action, params) VALUES (?, ?, 'system', ?, ?, ?)"
    # A background task could execute this, but since queue_command is
    # synchronous right now, we do a fire-and-forget
    asyncio.create_task(store.execute_write_async(
        sql, (cmd_id, unit_id, now, action, json.dumps(params))))
    _get_command_event(unit_id).set()


@router.get("/zones",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_zones():
    return await SQLiteStore().get_zones()


@router.get("/programs",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_programs():
    return await SQLiteStore().get_programs()


@router.get("/schedules",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_schedules():
    return await SQLiteStore().get_schedules()


@router.get("/sessions",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_sessions():
    return await SQLiteStore().get_sessions()


class CommandBody(BaseModel):
    action: str
    params: Dict[str, Any] = {}
    idempotency_key: Optional[str] = None


@router.post("/units/{unit_id}/command",
             dependencies=[Depends(require_role("operator", "admin"))])
async def post_command(unit_id: str, body: CommandBody, request: Request):
    store = SQLiteStore()
    user = getattr(request.state, "user", None)
    user_id = user["sub"] if user else "system"

    if body.idempotency_key:
        cmd = await store.execute_read_one_async("SELECT * FROM vector_commands WHERE unit_id=? AND idempotency_key=?", (unit_id, body.idempotency_key))
        if cmd:
            return {"command_id": cmd["command_id"]}

    cmd_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    # 30s ttl
    ttl_seconds = 30

    sql = """
    INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, idempotency_key, action, params, status, ttl_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    """
    await store.execute_write_async(sql, (cmd_id, unit_id, user_id, now, body.idempotency_key, body.action, json.dumps(body.params), ttl_seconds))

    from api.routes.vector_fleet import _get_command_event
    _get_command_event(unit_id).set()
    _get_command_event(unit_id).clear()

    return {"command_id": cmd_id}


class UnitPatchBody(BaseModel):
    name: Optional[str] = None
    platform: Optional[str] = None
    timezone: Optional[str] = None
    hardware: Optional[Dict[str, Any]] = None
    safety_floors: Optional[Dict[str, Any]] = None
    home_position: Optional[Dict[str, Any]] = None


@router.patch("/units/{id}",
              dependencies=[Depends(require_role("operator", "admin"))])
async def patch_unit(id: str, body: UnitPatchBody):
    store = SQLiteStore()
    unit = await store.get_vector_unit(id)
    if not unit:
        raise HTTPException(404)

    updates = {}
    bump = False
    if body.name is not None:
        updates["name"] = body.name
    if body.platform is not None:
        updates["platform"] = body.platform
    if body.timezone is not None:
        updates["timezone"] = body.timezone
    if body.hardware is not None:
        updates["hardware"] = json.dumps(body.hardware)
        bump = True
    if body.safety_floors is not None:
        absolute_floors = {"min_obstacle_clearance_m": 0.10}
        if body.safety_floors.get(
                "min_obstacle_clearance_m", 1.0) < absolute_floors["min_obstacle_clearance_m"]:
            raise HTTPException(
                400, detail="Safety floor min_obstacle_clearance_m too low")
        updates["safety_floors"] = json.dumps(body.safety_floors)
        bump = True
    if body.home_position is not None:
        updates["home_position"] = json.dumps(body.home_position)
        bump = True

    if updates:
        await store.update_vector_unit(id, updates)
    if bump:
        revision_row = await store.execute_read_one_async("SELECT revision FROM vector_config_revisions WHERE unit_id=?", (id,))
        new_rev = (revision_row["revision"] + 1) if revision_row else 1
        now = datetime.now(timezone.utc).isoformat()
        await store.execute_write_async(
            "INSERT INTO vector_config_revisions (unit_id, revision, updated_at) VALUES (?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET revision=?, updated_at=?",
            (id, new_rev, now, new_rev, now)
        )

        # Queue push config command
        cmd_id = uuid.uuid4().hex
        cmd_sql = """
        INSERT INTO vector_commands (command_id, unit_id, issued_by, action, params, status, issued_at)
        VALUES (?, ?, 'system', 'pull_config', '{}', 'pending', ?)
        """
        await store.execute_write_async(cmd_sql, (cmd_id, id, now))

        from api.routes.vector_fleet import _get_command_event
        _get_command_event(id).set()
        _get_command_event(id).clear()

    return {"status": "ok"}


@router.delete("/units/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_unit(id: str):
    store = SQLiteStore()
    await store.execute_write_async("DELETE FROM vector_units WHERE unit_id=?", (id,))
    return {"status": "ok"}


@router.get("/units/stream",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def fleet_stream(request: Request):
    async def event_generator():
        store = SQLiteStore()
        # Send initial state immediately
        units = await store.get_vector_units()
        yield {"event": "update", "data": json.dumps(units)}

        while True:
            if await request.is_disconnected():
                break

            try:
                await asyncio.wait_for(_FLEET_UPDATE_EVENT.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                # Keep-alive ping
                yield {"event": "ping", "data": "{}"}
                continue

            units = await store.get_vector_units()
            yield {"event": "update", "data": json.dumps(units)}

            # Debounce rapid updates
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@router.post("/units/{id}/rotate-token",
             dependencies=[Depends(require_role("admin"))])
async def rotate_token(id: str):
    import secrets
    import base64
    store = SQLiteStore()
    new_token = base64.urlsafe_b64encode(
        secrets.token_bytes(32)).decode("utf-8").rstrip("=")
    await store.execute_write_async("UPDATE vector_units SET unit_token=? WHERE unit_id=?", (new_token, id))
    return {"status": "ok", "unit_token": new_token}


@router.get("/units/{id}/telemetry",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_telemetry(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_telemetry WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))


@router.get("/units/{id}/alerts",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_alerts(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_alerts WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))


@router.post("/units/{id}/alerts/{alert_id}/ack")
async def ack_unit_alert(id: str, alert_id: int, user: dict = Depends(
        require_role("operator", "admin"))):
    user_id = user["sub"]
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async("UPDATE vector_alerts SET acknowledged=1, acknowledged_at=?, acknowledged_by=? WHERE id=? AND unit_id=?", (now, user_id, alert_id, id))
    return {"status": "ok"}


@router.get("/units/{id}/events",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_events(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_session_events WHERE unit_id=? ORDER BY timestamp DESC LIMIT ?", (id, limit))


@router.get("/units/{id}/sessions",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_sessions(id: str, limit: int = 100):
    store = SQLiteStore()
    return await store.execute_read_async("SELECT * FROM vector_sessions WHERE unit_id=? ORDER BY started_at DESC LIMIT ?", (id, limit))


@router.get("/units/{id}/camera/{camera_name}/snapshot",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit_snapshot(id: str, camera_name: str):
    raise HTTPException(status_code=404, detail="Snapshot not found")


@router.get("/sessions/{id}",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_session(id: str):
    store = SQLiteStore()
    session = await store.execute_read_one_async("SELECT * FROM vector_sessions WHERE session_id=?", (id,))
    if not session:
        raise HTTPException(404)
    events = await store.execute_read_async("SELECT * FROM vector_session_events WHERE session_id=? ORDER BY timestamp DESC LIMIT 100", (id,))
    telemetry = await store.execute_read_async("SELECT * FROM vector_telemetry WHERE unit_id=? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC", (session["unit_id"], session["started_at"], session.get("ended_at") or datetime.now(timezone.utc).isoformat()))
    sampled = []
    last_time = None
    for t in telemetry:
        ts = datetime.fromisoformat(t["timestamp"])
        if last_time is None or (ts - last_time).total_seconds() >= 30:
            sampled.append(t)
            last_time = ts
    session["events"] = events
    session["telemetry"] = sampled
    return session


class ZoneBody(BaseModel):
    name: str
    boundary: List[List[float]]
    no_go_areas: List[List[List[float]]] = []
    area_sqm: float
    capture_method: str = "drawn"


@router.post("/zones")
async def create_zone(body: ZoneBody, user: dict = Depends(
        require_role("operator", "admin"))):
    user_id = user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    store = SQLiteStore()
    zone_id = uuid.uuid4().hex
    await store.execute_write_async("INSERT INTO vector_zones (zone_id, name, created_by, created_at, updated_at, boundary, no_go_areas, area_sqm, capture_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (zone_id, body.name, user_id, now, now, json.dumps(body.boundary), json.dumps(body.no_go_areas), body.area_sqm, body.capture_method))
    return {"zone_id": zone_id}


@router.get("/zones/{id}",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_zone(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_zones WHERE zone_id=?", (id,))
    if not res:
        raise HTTPException(404)
    return res


@router.patch("/zones/{id}",
              dependencies=[Depends(require_role("operator", "admin"))])
async def patch_zone(id: str, body: dict):
    updates = {
        k: json.dumps(v) if isinstance(
            v,
            list) else v for k,
        v in body.items() if k in [
            "name",
            "boundary",
            "no_go_areas",
            "area_sqm",
            "capture_method"]}
    if not updates:
        return {"status": "ok"}
    cols = ", ".join([f"{k}=?" for k in _safe_cols(updates.keys())])
    params = list(updates.values()) + [id]
    await SQLiteStore().execute_write_async(f"UPDATE vector_zones SET {cols} WHERE zone_id=?", tuple(params))
    return {"status": "ok"}


@router.delete("/zones/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_zone(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_zones WHERE zone_id=?", (id,))
    return {"status": "ok"}


class ProgramBody(BaseModel):
    name: str
    assigned_unit_id: Optional[str] = None
    zone_ids: List[str]
    pattern: str = "stripes"
    direction_deg: float = 0
    overlap_pct: float = 10
    obstacle_clearance_m: float = 0.3
    edge_distance_m: float = 0.15
    speed_profile: str = "normal"


@router.post("/programs",
             dependencies=[Depends(require_role("operator", "admin"))])
async def create_program(body: ProgramBody):
    store = SQLiteStore()
    if body.assigned_unit_id:
        unit = await store.get_vector_unit(body.assigned_unit_id)
        if unit:
            sf = json.loads(unit.get("safety_floors", "{}") or "{}")
            if body.obstacle_clearance_m < sf.get(
                    "min_obstacle_clearance_m", 0.10):
                raise HTTPException(
                    400, "obstacle_clearance_m violates unit safety floor")
    pid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async("INSERT INTO vector_programs (program_id, name, assigned_unit_id, zone_ids, pattern, direction_deg, overlap_pct, obstacle_clearance_m, edge_distance_m, speed_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (pid, body.name, body.assigned_unit_id, json.dumps(body.zone_ids), body.pattern, body.direction_deg, body.overlap_pct, body.obstacle_clearance_m, body.edge_distance_m, body.speed_profile, now, now))
    return {"program_id": pid}


@router.get("/programs/{id}",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_program(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not res:
        raise HTTPException(404)
    return res


@router.patch("/programs/{id}",
              dependencies=[Depends(require_role("operator", "admin"))])
async def patch_program(id: str, body: dict):
    store = SQLiteStore()
    prog = await store.execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not prog:
        raise HTTPException(404)
    assigned_unit_id = body.get("assigned_unit_id", prog["assigned_unit_id"])
    obstacle_clearance_m = body.get(
        "obstacle_clearance_m",
        prog["obstacle_clearance_m"])
    if assigned_unit_id:
        unit = await store.get_vector_unit(assigned_unit_id)
        if unit:
            sf = json.loads(unit.get("safety_floors", "{}") or "{}")
            if obstacle_clearance_m < sf.get("min_obstacle_clearance_m", 0.10):
                raise HTTPException(
                    400, "obstacle_clearance_m violates unit safety floor")
    updates = {
        k: json.dumps(v) if isinstance(
            v,
            list) else v for k,
        v in body.items() if k in [
            "name",
            "assigned_unit_id",
            "zone_ids",
            "pattern",
            "direction_deg",
            "overlap_pct",
            "obstacle_clearance_m",
            "edge_distance_m",
            "speed_profile"]}
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        cols = ", ".join([f"{k}=?" for k in _safe_cols(updates.keys())])
        params = list(updates.values()) + [id]
        await store.execute_write_async(f"UPDATE vector_programs SET {cols} WHERE program_id=?", tuple(params))
        if assigned_unit_id:
            await store.bump_config_revision(assigned_unit_id)
            from api.routes.vector_fleet import _get_command_event
            _get_command_event(assigned_unit_id).set()
            _get_command_event(assigned_unit_id).clear()
    return {"status": "ok"}


@router.delete("/programs/{id}", dependencies=[Depends(require_role("admin"))])
async def delete_program(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_programs WHERE program_id=?", (id,))
    return {"status": "ok"}


@router.post("/programs/{id}/run")
async def run_program(id: str, user: dict = Depends(
        require_role("operator", "admin"))):
    user_id = user["sub"]
    store = SQLiteStore()
    prog = await store.execute_read_one_async("SELECT * FROM vector_programs WHERE program_id=?", (id,))
    if not prog or not prog["assigned_unit_id"]:
        raise HTTPException(400, "Program not found or has no assigned unit")

    cmd_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    await store.execute_write_async(
        "INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, action, params, status, ttl_seconds) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        (cmd_id, prog["assigned_unit_id"], user_id, now, "mow_start", "{}", 30)
    )
    from api.routes.vector_fleet import _get_command_event
    _get_command_event(prog["assigned_unit_id"]).set()
    _get_command_event(prog["assigned_unit_id"]).clear()
    return {"command_id": cmd_id}


class ScheduleBody(BaseModel):
    name: str
    program_id: str
    cron_utc: str
    timezone_display: str = "UTC"
    missed_run_policy: str = "skip"
    enabled: int = 1


@router.post("/schedules",
             dependencies=[Depends(require_role("operator", "admin"))])
async def create_schedule(body: ScheduleBody):
    sid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    first_run = croniter(body.cron_utc, now).get_next(datetime).isoformat()
    await SQLiteStore().execute_write_async("INSERT INTO vector_schedules (schedule_id, name, program_id, cron_utc, timezone_display, missed_run_policy, enabled, created_at, next_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (sid, body.name, body.program_id, body.cron_utc, body.timezone_display, body.missed_run_policy, body.enabled, now.isoformat(), first_run))
    return {"schedule_id": sid}


@router.get("/schedules/{id}",
            dependencies=[Depends(require_role("operator", "viewer"))])
async def get_schedule(id: str):
    res = await SQLiteStore().execute_read_one_async("SELECT * FROM vector_schedules WHERE schedule_id=?", (id,))
    if not res:
        raise HTTPException(404)
    return res


@router.patch("/schedules/{id}",
              dependencies=[Depends(require_role("operator", "admin"))])
async def patch_schedule(id: str, body: dict):
    updates = {
        k: v for k,
        v in body.items() if k in [
            "name",
            "program_id",
            "cron_utc",
            "timezone_display",
            "missed_run_policy",
            "enabled"]}
    if updates:
        if "cron_utc" in updates:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            updates["next_run"] = croniter(
                updates["cron_utc"], now).get_next(datetime).isoformat()
        cols = ", ".join([f"{k}=?" for k in _safe_cols(updates.keys())])
        params = list(updates.values()) + [id]
        await SQLiteStore().execute_write_async(f"UPDATE vector_schedules SET {cols} WHERE schedule_id=?", tuple(params))
    return {"status": "ok"}


@router.delete("/schedules/{id}",
               dependencies=[Depends(require_role("admin"))])
async def delete_schedule(id: str):
    await SQLiteStore().execute_write_async("DELETE FROM vector_schedules WHERE schedule_id=?", (id,))
    return {"status": "ok"}


def get_fleet_state() -> dict:
    return {}


def get_first_unit_id() -> str:
    return "unit-1"
