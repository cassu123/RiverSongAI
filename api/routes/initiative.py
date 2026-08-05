"""
api/routes/initiative.py

External intake + observability for the Initiative Engine.

POST /api/initiative/event   — inject a custom event (admin JWT, or the
                               daemon internal secret so n8n workflows and
                               local scripts can make River speak)
GET  /api/initiative/recent  — last 100 events with delivery decisions
                               (admin; for the Settings/debug UI)
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from config.settings import get_settings
from core.auth import decode_token
from core.initiative import InitiativeEvent, get_initiative_engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/initiative", tags=["initiative"])


async def _require_admin_or_internal(authorization: Optional[str]) -> str:
    """Accept an admin JWT or the daemon internal secret (for n8n/scripts)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    token = authorization.removeprefix("Bearer ").strip()
    if token == get_settings().daemon_internal_secret:
        return "internal"
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload.get("sub") or "admin"


class EventBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(default="", max_length=1000)
    severity: str = "info"
    kind: str = "custom"
    key: str = ""
    user_id: Optional[str] = None


@router.post("/event")
async def submit_event(
    body: EventBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin_or_internal(authorization)
    result = await get_initiative_engine().submit(InitiativeEvent(
        kind=body.kind or "custom",
        title=body.title,
        message=body.message,
        severity=body.severity,
        key=body.key,
        user_id=body.user_id,
    ))
    return result


@router.get("/recent")
async def recent_events(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    await _require_admin_or_internal(authorization)
    return {"events": get_initiative_engine().recent()}
