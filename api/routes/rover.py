"""
api/routes/rover.py

Endpoints for ArduRover telemetry and control.
Integrates with daemon_mechanic for live robot status.
"""

from __future__ import annotations

import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, Header, HTTPException, Request, Depends
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings
from daemons.registry import call_daemon

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rover", tags=["rover"])

def _require_user(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]

def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload["sub"]

class CommandBody(BaseModel):
    action: str
    payload: Dict[str, Any] = {}

@router.post("/telemetry")
async def record_telemetry(
    request: Request,
    body: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    """
    Telemetry endpoint called by daemon_mechanic.
    Authenticated via a shared internal secret.
    """
    settings = get_settings()
    if authorization != f"Bearer {settings.daemon_internal_secret}":
        raise HTTPException(status_code=403, detail="Invalid internal secret.")

    request.app.state.rover_telemetry = body
    return {"ok": True}

@router.get("/telemetry")
async def get_telemetry(request: Request, user_id: str = Depends(_require_user)):
    """
    Returns the current cached rover telemetry.
    """
    telemetry = getattr(request.app.state, "rover_telemetry", {})
    if not telemetry:
        return {"status": "no_data"}
    return telemetry

@router.post("/command")
async def send_rover_command(
    body: CommandBody,
    admin_id: str = Depends(_require_admin),
):
    """
    Sends a command to the rover via daemon_mechanic.
    Admin-only.
    """
    valid_actions = {"arm", "disarm", "set_mode", "upload_mission"}
    if body.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action: {body.action}")

    result = await call_daemon("mechanic", body.action, body.payload)
    if not result:
        return {"error": "Mechanic daemon is not reachable"}
    
    return result

@router.get("/status")
async def get_rover_status(request: Request, user_id: str = Depends(_require_user)):
    """
    Returns high-level rover status and feature configuration.
    """
    settings = get_settings()
    registry = getattr(request.app.state, "daemon_registry", None)
    is_alive = registry.is_alive("mechanic") if registry else False
    
    telemetry = getattr(request.app.state, "rover_telemetry", {})
    summary = {
        "lat": telemetry.get("lat"),
        "lon": telemetry.get("lon"),
        "mode": telemetry.get("mode"),
        "armed": telemetry.get("armed"),
        "battery_pct": telemetry.get("battery_pct"),
    }
    
    return {
        "mechanic_enabled": settings.mechanic_enabled,
        "daemon_alive": is_alive,
        "telemetry_summary": summary
    }
