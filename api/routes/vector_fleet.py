"""
api/routes/vector_fleet.py
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.auth import decode_token
from providers.memory.sqlite_store import SQLiteStore
from providers.push.sender import send_push

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vector", tags=["vector-fleet"])

# Global event maps for long polling and SSE
# unit_id -> asyncio.Event
_COMMAND_EVENTS: Dict[str, asyncio.Event] = {}
_TELEMETRY_EVENTS: Dict[str, asyncio.Event] = {}

def _get_command_event(unit_id: str) -> asyncio.Event:
    if unit_id not in _COMMAND_EVENTS:
        _COMMAND_EVENTS[unit_id] = asyncio.Event()
    return _COMMAND_EVENTS[unit_id]

def _get_telemetry_event(unit_id: str) -> asyncio.Event:
    if unit_id not in _TELEMETRY_EVENTS:
        _TELEMETRY_EVENTS[unit_id] = asyncio.Event()
    return _TELEMETRY_EVENTS[unit_id]

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload

def require_role(*roles: str):
    async def role_checker(user: dict = Depends(_require_user)):
        user_role = user.get("role", "user")
        if user_role == "admin":
            return user
        if user_role in roles:
            return user
        raise HTTPException(status_code=403, detail="Forbidden")
    return role_checker

async def _verify_unit_token(unit_id: str, x_unit_token: Optional[str] = Header(default=None)):
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
    event = _get_command_event(unit_id)
    event.set()
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Mower-facing endpoints (§6.1)
# ---------------------------------------------------------------------------

class RegisterBody(BaseModel):
    unit_id: str
    name: str = ""
    platform: str = "unknown"
    firmware_version: Optional[str] = None
    hardware: Dict[str, Any] = {}
    connectivity_tier: str = "lan"
    last_ip: Optional[str] = None

@router.post("/register")
async def register_unit(body: RegisterBody):
    store = SQLiteStore()
    unit = await store.get_vector_unit(body.unit_id)
    now = datetime.now(timezone.utc).isoformat()
    if not unit:
        import secrets
        token = secrets.token_hex(16)
        await store.insert_vector_unit(body.unit_id, body.name, body.platform, token, now, "")
        return {"status": "registered", "unit_token": token}
    else:
        await store.update_vector_unit(body.unit_id, {
            "firmware_version": body.firmware_version,
            "last_ip": body.last_ip,
            "connectivity_tier": body.connectivity_tier,
            "last_seen": now,
            "online": 1
        })
        return {"status": "ok", "unit_token": unit["unit_token"]}

@router.get("/command/stream/{unit_id}")
async def command_stream(unit_id: str, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(unit_id, x_unit_token)
    store = SQLiteStore()
    
    cmd = await store.get_oldest_pending_command(unit_id)
    if cmd:
        await store.update_command_status(cmd["command_id"], "dispatched")
        return {"command": cmd}
        
    event = _get_command_event(unit_id)
    event.clear()
    
    try:
        await asyncio.wait_for(event.wait(), timeout=50.0)
        cmd = await store.get_oldest_pending_command(unit_id)
        if cmd:
            await store.update_command_status(cmd["command_id"], "dispatched")
            return {"command": cmd}
    except asyncio.TimeoutError:
        return {"command": None}
    return {"command": None}

class AckBody(BaseModel):
    status: str

@router.post("/command/{command_id}/ack")
async def command_ack(command_id: str, body: AckBody, x_unit_token: str = Header(default=None)):
    store = SQLiteStore()
    cmd = await store.execute_read_one_async("SELECT unit_id FROM vector_commands WHERE command_id=?", (command_id,))
    if not cmd:
        raise HTTPException(404)
    await _verify_unit_token(cmd["unit_id"], x_unit_token)
    
    status = body.status if body.status in ["acknowledged", "rejected"] else "acknowledged"
    await store.update_command_status(command_id, status)
    return {"status": "ok"}

class ResultBody(BaseModel):
    status: str
    result: Optional[str] = None

@router.post("/command/{command_id}/result")
async def command_result(command_id: str, body: ResultBody, x_unit_token: str = Header(default=None)):
    store = SQLiteStore()
    cmd = await store.execute_read_one_async("SELECT unit_id FROM vector_commands WHERE command_id=?", (command_id,))
    if not cmd:
        raise HTTPException(404)
    await _verify_unit_token(cmd["unit_id"], x_unit_token)
    
    sql = "UPDATE vector_commands SET status=?, completed_at=?, result=? WHERE command_id=?"
    await store.execute_write_async(sql, (body.status, datetime.now(timezone.utc).isoformat(), body.result, command_id))
    return {"status": "ok"}

class TelemetryBody(BaseModel):
    unit_id: str
    session_id: Optional[str] = None
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

@router.post("/telemetry")
async def post_telemetry(body: TelemetryBody, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    fields = body.model_dump()
    if fields["active_faults"] is not None:
        fields["active_faults"] = json.dumps(fields["active_faults"])
    fields["timestamp"] = now
    await store.insert_telemetry(fields)
    
    await store.update_vector_unit(body.unit_id, {
        "last_seen": now,
        "operating_mode": body.operating_mode,
        "active_faults": fields["active_faults"],
        "connectivity_tier": body.connectivity_tier
    })
    
    _get_telemetry_event(body.unit_id).set()
    _get_telemetry_event(body.unit_id).clear()
    
    return {"status": "ok"}

class AlertBody(BaseModel):
    unit_id: str
    session_id: Optional[str] = None
    level: str
    title: str
    message: Optional[str] = None
    fault_code: Optional[str] = None

@router.post("/alert")
async def post_alert(body: AlertBody, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    fields = body.model_dump()
    fields["timestamp"] = now
    await store.insert_alert(fields)
    
    if body.level.lower() == "critical":
        try:
            admin_users = await store.execute_read_async("SELECT id FROM users WHERE role IN ('admin', 'operator')")
            for u in admin_users:
                subs = await store.get_push_subscriptions(u["id"])
                for sub in subs:
                    await send_push(sub, "Critical Fleet Alert", f"{body.title}: {body.message}")
        except Exception as e:
            logger.error(f"Push notification failed: {e}")

    return {"status": "ok"}

class EventBody(BaseModel):
    unit_id: str
    session_id: str
    event: str
    data: Dict[str, Any] = {}

@router.post("/event")
async def post_event(body: EventBody, x_unit_token: str = Header(default=None)):
    await _verify_unit_token(body.unit_id, x_unit_token)
    store = SQLiteStore()
    await store.insert_session_event(body.session_id, body.unit_id, body.event, json.dumps(body.data))
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# UI-facing endpoints (§6.2)
# ---------------------------------------------------------------------------

@router.get("/units", dependencies=[Depends(require_role("operator", "viewer"))])
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

@router.get("/units/{id}", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_unit(id: str):
    unit = await SQLiteStore().get_vector_unit(id)
    if not unit:
        raise HTTPException(404)
    return unit

@router.get("/units/{id}/stream")
async def unit_sse_stream(id: str, request: Request, user: dict = Depends(require_role("operator", "viewer"))):
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
    import uuid
    cmd_id = uuid.uuid4().hex
    store = SQLiteStore()
    now = datetime.now(timezone.utc).isoformat()
    sql = "INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, action, params) VALUES (?, ?, 'system', ?, ?, ?)"
    # A background task could execute this, but since queue_command is synchronous right now, we do a fire-and-forget
    asyncio.create_task(store.execute_write_async(sql, (cmd_id, unit_id, now, action, json.dumps(params))))
    _get_command_event(unit_id).set()

@router.get("/zones", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_zones():
    return await SQLiteStore().get_zones()

@router.get("/programs", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_programs():
    return await SQLiteStore().get_programs()

@router.get("/schedules", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_schedules():
    return await SQLiteStore().get_schedules()

@router.get("/sessions", dependencies=[Depends(require_role("operator", "viewer"))])
async def get_sessions():
    return await SQLiteStore().get_sessions()
