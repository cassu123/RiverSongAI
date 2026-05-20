"""
api/routes/n8n_webhooks.py

Webhook endpoint for n8n to call River Song AI.
Allows n8n workflows to trigger internal River Song actions.
"""

from __future__ import annotations

import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from config.settings import get_settings
from core.limiter import limiter
from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from providers.automation.n8n_client import build_n8n_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks/n8n", tags=["automation"])


async def _require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload["sub"]

@router.post("")
@limiter.limit(get_settings().rate_limit_webhook_n8n)
async def n8n_webhook_receiver(
    request: Request,
    x_n8n_secret: Optional[str] = Header(None, alias="X-N8N-Secret"),
):
    """
    Receives incoming webhooks from n8n.
    Validates against N8N_WEBHOOK_SECRET.
    """
    settings = get_settings()
    if settings.n8n_webhook_secret and x_n8n_secret != settings.n8n_webhook_secret:
        raise HTTPException(status_code=401, detail="Invalid webhook secret.")

    payload = await request.json()
    logger.info("Received n8n webhook: %s", payload)
    
    # Logic to route the payload to internal systems (e.g., smart home, notifications)
    # This is a placeholder for dynamic routing
    action = payload.get("action")
    if action == "notify":
        message = payload.get("message", "n8n notification")
        logger.info("n8n notification: %s", message)
        # TODO: Trigger internal notification system
    
    return {"ok": True, "message": "Webhook received"}

@router.get("/status")
async def n8n_status(admin_id: str = Depends(_require_admin)):
    """Returns the availability and URL of the n8n instance."""
    client = build_n8n_client()
    available = await client.is_available()
    return {
        "n8n_available": available,
        "n8n_url": client.url,
        "n8n_enabled": client.enabled
    }

@router.get("/workflows")
async def n8n_workflows(admin_id: str = Depends(_require_admin)):
    """Lists available n8n workflows."""
    client = build_n8n_client()
    workflows = await client.list_workflows()
    return {"workflows": workflows}
