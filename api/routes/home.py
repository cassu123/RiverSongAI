"""
api/routes/home.py

Home Assistant proxy endpoints for the Home Node page.

GET  /api/home/status          -- HA configured + reachable check
GET  /api/home/devices         -- filtered state list (lights, switches, scenes, etc.)
POST /api/home/action          -- call a HA service (toggle, turn_on, turn_off, etc.)
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/home", tags=["home"])

VISIBLE_DOMAINS = {
    "light",
    "switch",
    "fan",
    "cover",
    "lock",
    "climate",
    "scene",
    "script",
    "input_boolean"}


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]


def _get_client():
    from providers.smart_home.home_assistant import HomeAssistantClient
    s = get_settings()
    return HomeAssistantClient(
        base_url=s.home_assistant_url, token=s.home_assistant_token)


def _is_configured() -> bool:
    s = get_settings()
    return bool(s.home_assistant_token and s.home_assistant_token.strip())


@router.get("/status")
async def get_status(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return {"configured": False, "reachable": False}
    try:
        client = _get_client()
        reachable = await client.ping()
        await client.close()
        return {"configured": True, "reachable": reachable}
    except Exception as e:
        logger.warning("HA ping failed: %s", e)
        return {"configured": True, "reachable": False}


@router.get("/devices")
async def get_devices(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return []
    try:
        client = _get_client()
        all_states = await client.get_all_states()
        await client.close()
        devices = []
        for s in all_states:
            domain = s["entity_id"].split(".")[0]
            if domain not in VISIBLE_DOMAINS:
                continue
            attrs = s.get("attributes", {})
            devices.append({
                "entity_id": s["entity_id"],
                "domain": domain,
                "state": s["state"],
                "name": attrs.get("friendly_name", s["entity_id"]),
                "brightness": attrs.get("brightness"),
                "temperature": attrs.get("temperature"),
                "current_temp": attrs.get("current_temperature"),
            })
        return devices
    except Exception as e:
        logger.error("HA get_devices failed: %s", e)
        return []


class ActionBody(BaseModel):
    entity_id: str
    action: str        # turn_on | turn_off | toggle | activate | lock | unlock
    brightness_pct: int | None = None
    temperature: float | None = None


@router.post("/action")
async def call_action(body: ActionBody,
                      authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return {"ok": False, "detail": "Home Assistant not configured."}
    try:
        client = _get_client()
        domain = body.entity_id.split(".")[0]
        service = body.action
        kwargs: dict = {"entity_id": body.entity_id}
        if body.brightness_pct is not None:
            kwargs["brightness_pct"] = body.brightness_pct
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if domain == "scene":
            service = "turn_on"
        await client.call_service(domain, service, **kwargs)
        await client.close()
        return {"ok": True}
    except Exception as e:
        logger.error("HA action failed: %s", e)
        return {"ok": False, "detail": str(e)}
