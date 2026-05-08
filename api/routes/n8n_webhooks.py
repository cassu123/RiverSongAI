"""
api/routes/n8n_webhooks.py

Webhook endpoint for n8n to call River Song AI.
Allows n8n workflows to trigger internal River Song actions.
"""

from __future__ import annotations

import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, Header, HTTPException, Request
from config.settings import get_settings
from providers.automation.n8n_client import build_n8n_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks/n8n", tags=["automation"])

@router.post("")
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
async def n8n_status():
    """Returns the availability and URL of the n8n instance."""
    client = build_n8n_client()
    available = await client.is_available()
    return {
        "n8n_available": available,
        "n8n_url": client.url,
        "n8n_enabled": client.enabled
    }

@router.get("/workflows")
async def n8n_workflows():
    """Lists available n8n workflows."""
    client = build_n8n_client()
    workflows = await client.list_workflows()
    return {"workflows": workflows}
