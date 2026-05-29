"""
api/routes/vector_fleet.py

Fleet API for the River Vector autonomous mower system.

Two endpoint classes:
  • Mower-facing  (/api/vector/register|command|status|telemetry|alert|event)
    Called by river-vector's RiverSongClient.  No user auth — the mower
    identifies itself via the X-Unit-ID header.  RiverSong is optional from
    the mower's perspective; these endpoints return sensible defaults even
    when the mower reconnects after a gap.

  • UI-facing (/api/vector/units, /api/vector/units/{id}/command)
    Called by the dashboard.  Require a normal user JWT.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vector", tags=["vector-fleet"])

# ---------------------------------------------------------------------------
# Module-level fleet state
# Keyed by unit_id.  Lives in process memory; lightweight and sufficient
# because RiverSong is a view/control layer — not the source of truth.
# ---------------------------------------------------------------------------

_FLEET: Dict[str, Dict[str, Any]] = {}

_MAX_ALERTS = 50
_MAX_EVENTS = 100


def _unit(unit_id: str) -> Dict[str, Any]:
    """Return or create the in-memory state bucket for a unit."""
    if unit_id not in _FLEET:
        _FLEET[unit_id] = {
            "unit_id": unit_id,
            "registered": False,
            "registration": {},
            "last_status": None,
            "last_telemetry": None,
            "command_queue": [],
            "recent_alerts": deque(maxlen=_MAX_ALERTS),
            "recent_events": deque(maxlen=_MAX_EVENTS),
            "last_seen": None,
            "first_seen": time.time(),
        }
    return _FLEET[unit_id]


def get_fleet_state() -> Dict[str, Dict[str, Any]]:
    """Public accessor used by the mow_command tool executor."""
    return _FLEET


def queue_command(unit_id: str, command: str, payload: Dict[str, Any] | None = None) -> bool:
    """
    Queue a command for the mower to pick up on its next poll.
    Returns False if the unit has never been seen.
    """
    if unit_id not in _FLEET and not any(_FLEET):
        return False
    # If caller passes no unit_id but there is exactly one unit, use it.
    if unit_id not in _FLEET:
        unit_id = next(iter(_FLEET))
    state = _unit(unit_id)
    state["command_queue"].append({
        "command": command,
        "payload": payload or {},
        "queued_at": time.time(),
    })
    logger.info("Queued command '%s' for unit '%s'.", command, unit_id)
    return True


def get_first_unit_id() -> Optional[str]:
    """Return the first registered unit_id, or None."""
    for uid, state in _FLEET.items():
        if state.get("registered"):
            return uid
    return next(iter(_FLEET), None)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _unit_id_from_header(x_unit_id: Optional[str] = Header(default=None)) -> str:
    if not x_unit_id:
        raise HTTPException(status_code=400, detail="X-Unit-ID header required.")
    return x_unit_id


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RegisterBody(BaseModel):
    unit_id: str
    unit_name: str = ""
    platform_type: str = "unknown"
    unit_config: Dict[str, Any] = {}   # full voyager.json config blob


class StatusBody(BaseModel):
    mode: str = "UNKNOWN"
    session: str = "UNKNOWN"
    faults: List[str] = []


class TelemetryBody(BaseModel):
    timestamp: float = 0.0
    gps: Dict[str, Any] = {}
    battery: Dict[str, Any] = {}
    fuel_pct: Optional[float] = None
    temperature: Optional[float] = None
    rpm: Optional[float] = None
    imu: Dict[str, Any] = {}
    ultrasonics: Dict[str, Any] = {}
    session: Dict[str, Any] = {}


class AlertBody(BaseModel):
    severity: str = "WARNING"
    message: str = ""
    data: Dict[str, Any] = {}


class EventBody(BaseModel):
    event: str
    data: Dict[str, Any] = {}


class UICommandBody(BaseModel):
    command: str
    payload: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Mower-facing endpoints  (no user auth)
# ---------------------------------------------------------------------------

@router.post("/register", status_code=200)
async def register_unit(body: RegisterBody, request: Request):
    """
    Called by river-vector on boot.  Persists registration to SQLite and
    refreshes in-memory state.
    """
    state = _unit(body.unit_id)
    state["registered"] = True
    state["registration"] = body.model_dump()
    state["last_seen"] = time.time()

    # Persist to SQLite so we survive a RiverSong restart.
    try:
        store = request.app.state.memory_manager._store
        await store.upsert_vector_unit(
            unit_id=body.unit_id,
            unit_name=body.unit_name,
            platform_type=body.platform_type,
            config_json=str(body.model_dump()),
        )
    except Exception as exc:
        logger.warning("vector register: SQLite upsert failed: %s", exc)

    logger.info("Unit '%s' (%s) registered.", body.unit_id, body.unit_name)
    return {"status": "registered", "unit_id": body.unit_id}


@router.get("/command/{unit_id}")
async def poll_command(unit_id: str, x_unit_id: str = Depends(_unit_id_from_header)):
    """
    Polled by river-vector at 10 Hz.  Pops and returns the next queued
    command, or {"command": null} if nothing is pending.
    """
    state = _unit(unit_id)
    state["last_seen"] = time.time()

    if state["command_queue"]:
        entry = state["command_queue"].pop(0)
        logger.info("Dispatching command '%s' to unit '%s'.", entry["command"], unit_id)
        return {"command": entry["command"], "payload": entry.get("payload", {})}

    return {"command": None}


@router.post("/status")
async def receive_status(
    body: StatusBody,
    x_unit_id: str = Depends(_unit_id_from_header),
):
    state = _unit(x_unit_id)
    state["last_status"] = {**body.model_dump(), "received_at": time.time()}
    state["last_seen"] = time.time()
    return {"ok": True}


@router.post("/telemetry")
async def receive_telemetry(
    body: TelemetryBody,
    x_unit_id: str = Depends(_unit_id_from_header),
):
    state = _unit(x_unit_id)
    state["last_telemetry"] = {**body.model_dump(), "received_at": time.time()}
    state["last_seen"] = time.time()
    return {"ok": True}


@router.post("/alert")
async def receive_alert(
    body: AlertBody,
    x_unit_id: str = Depends(_unit_id_from_header),
):
    state = _unit(x_unit_id)
    state["recent_alerts"].append({**body.model_dump(), "ts": time.time()})
    state["last_seen"] = time.time()
    logger.warning("Alert from '%s' [%s]: %s", x_unit_id, body.severity, body.message)
    return {"ok": True}


@router.post("/event")
async def receive_event(
    body: EventBody,
    x_unit_id: str = Depends(_unit_id_from_header),
):
    state = _unit(x_unit_id)
    state["recent_events"].append({**body.model_dump(), "ts": time.time()})
    state["last_seen"] = time.time()
    return {"ok": True}


# ---------------------------------------------------------------------------
# UI-facing endpoints  (require user JWT)
# ---------------------------------------------------------------------------

def _serialize_unit(state: Dict[str, Any]) -> Dict[str, Any]:
    last_seen = state.get("last_seen")
    seconds_ago = round(time.time() - last_seen) if last_seen else None
    online = seconds_ago is not None and seconds_ago < 30

    return {
        "unit_id": state["unit_id"],
        "registered": state["registered"],
        "unit_name": state["registration"].get("unit_name", state["unit_id"]),
        "platform_type": state["registration"].get("platform_type", "unknown"),
        "online": online,
        "last_seen_seconds_ago": seconds_ago,
        "last_status": state.get("last_status"),
        "last_telemetry": state.get("last_telemetry"),
        "pending_commands": len(state.get("command_queue", [])),
        "recent_alerts": list(state.get("recent_alerts", []))[-10:],
        "recent_events": list(state.get("recent_events", []))[-20:],
        "first_seen": state.get("first_seen"),
    }


@router.get("/units")
async def list_units(
    request: Request,
    user_id: str = Depends(_require_user),
):
    """Return all known units with their current state."""
    # Hydrate from SQLite on first call so units survive restarts.
    if not _FLEET:
        try:
            store = request.app.state.memory_manager._store
            db_units = await store.get_vector_units()
            for row in db_units:
                state = _unit(row["unit_id"])
                if not state["registered"]:
                    state["registered"] = True
                    state["registration"] = {
                        "unit_id": row["unit_id"],
                        "unit_name": row["unit_name"],
                        "platform_type": row["platform_type"],
                    }
        except Exception as exc:
            logger.warning("vector list_units: SQLite load failed: %s", exc)

    return [_serialize_unit(s) for s in _FLEET.values()]


@router.get("/units/{unit_id}")
async def get_unit(
    unit_id: str,
    user_id: str = Depends(_require_user),
):
    """Return full state for one unit."""
    if unit_id not in _FLEET:
        raise HTTPException(status_code=404, detail="Unit not found.")
    return _serialize_unit(_FLEET[unit_id])


@router.post("/units/{unit_id}/command", status_code=202)
async def send_ui_command(
    unit_id: str,
    body: UICommandBody,
    user_id: str = Depends(_require_user),
):
    """Queue a command from the dashboard or chat tool."""
    valid = {"mow_start", "mow_stop", "return_home", "estop", "estop_reset"}
    if body.command not in valid:
        raise HTTPException(status_code=400, detail=f"Unknown command '{body.command}'.")

    # Accept command even if unit isn't currently online — it'll pick it up
    # on reconnect.
    state = _unit(unit_id)
    state["command_queue"].append({
        "command": body.command,
        "payload": body.payload,
        "queued_at": time.time(),
        "queued_by": user_id,
    })
    logger.info("UI command '%s' queued for '%s' by user '%s'.", body.command, unit_id, user_id)
    return {"queued": True, "command": body.command, "unit_id": unit_id}
