"""
api/routes/context.py

Endpoints for receiving physical environment context updates.
Integrates Warden camera detections and Home Assistant sensor events.
"""

from __future__ import annotations

import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/context", tags=["context"])


class SensorEvent(BaseModel):
    source: str                     # "warden" | "home_assistant" | "manual"
    room: Optional[str] = None
    entity_id: str
    state: str
    attributes: Dict[str, Any] = {}
    timestamp: Optional[str] = None


def _authenticate_context_update(authorization: Optional[str]) -> bool:
    """
    Accepts either a valid user JWT or the daemon internal secret.
    """
    if not authorization:
        return False
    
    # Check internal secret (for daemons and HA webhooks)
    settings = get_settings()
    if authorization == f"Bearer {settings.daemon_internal_secret}":
        return True
    
    # Check user JWT (for manual updates)
    if authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
        payload = decode_token(token)
        if payload:
            return True
            
    return False


@router.post("/sensor_event")
async def receive_sensor_event(
    body: SensorEvent,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Receives sensor updates from Warden camera detections and Home Assistant.
    """
    if not _authenticate_context_update(authorization):
        raise HTTPException(status_code=403, detail="Unauthorized context update.")

    engine = getattr(request.app.state, "context_engine", None)
    if not engine:
        raise HTTPException(status_code=503, detail="Context engine not initialized.")

    if body.source == "warden":
        # state is expected to be person count
        persons = int(body.state) if body.state.isdigit() else 0
        activity = body.attributes.get("activity", "present")
        # heuristic if room is missing
        room = body.room or engine._extract_room(body.entity_id, body.attributes)
        if room:
            await engine.update_room(room, persons, activity)
    else:
        # Home Assistant or manual
        await engine.update_from_ha_sensor(body.entity_id, body.state, body.attributes)
        room = engine._extract_room(body.entity_id, body.attributes)

    return {"ok": True, "room": room}


@router.get("/rooms")
async def get_room_states(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Returns current room states for the frontend dashboard.
    Auth: Standard user JWT.
    """
    # Simple auth check: any valid user can view context
    if not authorization or not authorization.startswith("Bearer "):
         raise HTTPException(status_code=401, detail="Not authenticated.")
    
    token = authorization.removeprefix("Bearer ")
    if not decode_token(token):
        raise HTTPException(status_code=401, detail="Invalid token.")

    engine = getattr(request.app.state, "context_engine", None)
    if not engine:
        return {"rooms": {}}
    
    return {"rooms": engine.get_rooms()}
