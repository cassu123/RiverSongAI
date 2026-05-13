"""
api/routes/daemons.py

Endpoints for daemon infrastructure management.
Handles heartbeats, status registry, and internal task routing.
"""

from __future__ import annotations

import logging
from typing import Optional, Any, Dict

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings
from daemons.registry import call_daemon

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/daemon", tags=["daemons"])


def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    """Validate Bearer token and ensure the user has the 'admin' role."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    token = authorization.removeprefix("Bearer ")
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
        
    return payload["sub"]


class HeartbeatBody(BaseModel):
    name: str
    status: str
    port: int


class TaskBody(BaseModel):
    action: str
    payload: Dict[str, Any] = {}


@router.post("/heartbeat")
async def record_heartbeat(
    body: HeartbeatBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Heartbeat endpoint called by background daemons.
    Authenticated via a shared internal secret.
    """
    settings = get_settings()
    expected = f"Bearer {settings.daemon_internal_secret}"
    
    if authorization != expected:
        logger.warning("Unauthorized heartbeat attempt for daemon '%s'", body.name)
        raise HTTPException(status_code=403, detail="Invalid internal secret.")

    registry = getattr(request.app.state, "daemon_registry", None)
    if not registry:
        raise HTTPException(status_code=503, detail="Daemon registry not initialized.")

    registry.record_heartbeat(body.name, body.port, body.status)
    return {"ok": True}


@router.get("/status")
async def get_daemons_status(
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    """
    Returns the current state of all daemons in the registry.
    Admin-only.
    """
    registry = getattr(request.app.state, "daemon_registry", None)
    if not registry:
        return {"daemons": {}}
    
    return {"daemons": registry.get_all()}


@router.post("/{daemon_name}/task")
async def proxy_daemon_task(
    daemon_name: str,
    body: TaskBody,
    request: Request,
    admin_id: str = Depends(_require_admin),
):
    """
    Proxies a task request to a specific background daemon.
    Admin-only.
    """
    result = await call_daemon(daemon_name, body.action, body.payload)
    return result
