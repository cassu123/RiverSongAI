"""
api/routes/killswitch.py

Kill switch management endpoints.

GET  /api/killswitch          -- current active state
POST /api/killswitch/activate -- activate the kill switch
POST /api/killswitch/reset    -- reset with password
"""

from __future__ import annotations

import logging
from fastapi import APIRouter
from pydantic import BaseModel

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


@router.get("")
async def get_status():
    return {"active": is_kill_switch_active()}


@router.post("/activate")
async def activate(body: ActivateBody):
    activate_global_kill_switch(origin=body.origin)
    logger.critical("Kill switch activated via API (origin=%s).", body.origin)
    return {"active": True, "message": "Kill switch activated."}


@router.post("/reset")
async def reset(body: ResetBody):
    success = reset_global_kill_switch(body.password)
    if success:
        return {"success": True, "message": "Kill switch reset. Restart the server to resume."}
    return {"success": False, "message": "Incorrect password."}
