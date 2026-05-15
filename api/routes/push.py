"""
api/routes/push.py

Web Push notification endpoints.
"""

from __future__ import annotations

import logging
import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings
from providers.push.sender import send_push

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/push", tags=["push"])


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503, detail="Memory manager not available.")
    return mm._store


class SubscribeBody(BaseModel):
    subscription: dict


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Returns the VAPID public key for frontend subscription."""
    settings = get_settings()
    if not settings.push_notifications_enabled:
        return {"public_key": None}
    return {"public_key": settings.vapid_public_key}


@router.post("/subscribe")
async def subscribe(
    body: SubscribeBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Save a new push subscription for the current user."""
    user_id = await _require_user(authorization)
    store = _store(request)
    
    await store.save_push_subscription(user_id, json.dumps(body.subscription))
    return {"status": "subscribed"}


@router.delete("/unsubscribe")
async def unsubscribe(
    body: UnsubscribeBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Remove a push subscription by endpoint."""
    user_id = await _require_user(authorization)
    store = _store(request)
    
    await store.delete_push_subscription(user_id, body.endpoint)
    return {"status": "unsubscribed"}


@router.post("/test")
async def test_push(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Send a test push notification to all of the user's subscriptions."""
    user_id = await _require_user(authorization)
    store = _store(request)
    
    subscriptions = await store.get_push_subscriptions(user_id)
    sent_count = 0
    
    for sub_json in subscriptions:
        success = await send_push(
            sub_json,
            title="Hello, sweetie.",
            body="River Song push notifications are working."
        )
        if not success:
            # 410 Gone — subscription expired
            sub = json.loads(sub_json)
            await store.delete_push_subscription(user_id, sub["endpoint"])
        else:
            sent_count += 1
            
    return {"sent": sent_count}
