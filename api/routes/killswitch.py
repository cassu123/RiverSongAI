"""
api/routes/killswitch.py

Kill switch management endpoints.

GET  /api/killswitch          -- current active state
POST /api/killswitch/activate -- activate the kill switch
POST /api/killswitch/reset    -- reset with password
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Request
from pydantic import BaseModel

from typing import Optional

from fastapi import Header

from config.settings import get_settings
from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from core.kill_switch import (
    is_kill_switch_active,
    activate_global_kill_switch,
    reset_global_kill_switch,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/killswitch", tags=["killswitch"])


class ActivateBody(BaseModel):
    origin: str = "UI"


class ResetBody(BaseModel):
    password: str


async def _require_admin(authorization: Optional[str]) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin access required.")


@router.get("")
async def get_status(authorization: Optional[str] = Header(default=None)):
    await _require_admin(authorization)
    return {"active": is_kill_switch_active()}


@router.post("/activate")
async def activate(body: ActivateBody, request: Request, authorization: Optional[str] = Header(default=None)):
    await _require_admin(authorization)
    activate_global_kill_switch(origin=body.origin)
    safe_origin = body.origin.replace("\r", "").replace("\n", "").replace("\t", "")
    logger.critical("Kill switch activated via API (origin=%s).", safe_origin)

    settings = get_settings()
    if getattr(settings, "killswitch_push_enabled", False):
        mm = getattr(request.app.state, "memory_manager", None)
        if mm is not None:
            try:
                from providers.push.notifier import notify_admins
                await notify_admins(
                    mm._store,
                    title="River Song — Kill Switch ACTIVE",
                    body=f"Origin: {safe_origin}. Restart required to resume.",
                )
            except Exception as exc:
                logger.error("Kill-switch push fan-out failed: %s", exc)

    return {"active": True, "message": "Kill switch activated."}


@router.post("/reset")
async def reset(body: ResetBody, authorization: Optional[str] = Header(default=None)):
    await _require_admin(authorization)
    success = reset_global_kill_switch(body.password)
    if success:
        return {"success": True, "message": "Kill switch reset. Restart the server to resume."}
    return {"success": False, "message": "Incorrect password."}
