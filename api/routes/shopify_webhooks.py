"""
api/routes/shopify_webhooks.py

Webhook endpoint for Shopify.
"""

import asyncio
import hmac
import hashlib
import base64
import logging
from fastapi import APIRouter, Request, Header, HTTPException
from providers.commerce.shopify import ShopifySyncWrapper
from config.settings import get_settings
from core.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks/shopify", tags=["commerce"])


@router.post("/orders")
@limiter.limit(get_settings().rate_limit_webhook_shopify)
async def shopify_order_webhook(
    request: Request,
    x_shopify_hmac_sha256: str = Header(None, alias="X-Shopify-Hmac-SHA256")
):
    settings = get_settings()
    body = await request.body()

    # Verify signature if a secret is configured
    if settings.shopify_webhook_secret:
        if not x_shopify_hmac_sha256:
            logger.warning("Shopify webhook received without HMAC header.")
            raise HTTPException(
                status_code=401,
                detail="Missing HMAC signature")

        digest = hmac.new(
            settings.shopify_webhook_secret.encode('utf-8'),
            body,
            hashlib.sha256
        ).digest()
        computed_hmac = base64.b64encode(digest).decode('utf-8')

        if not hmac.compare_digest(computed_hmac, x_shopify_hmac_sha256):
            logger.warning("Shopify webhook HMAC mismatch.")
            raise HTTPException(
                status_code=401,
                detail="Invalid HMAC signature")

    payload = await request.json()
    # Fix: use data/commerce.db (the actual SQLAlchemy DB) instead of
    # commercial_inventory.db
    wrapper = ShopifySyncWrapper(
        db_path="data/commerce.db",
        workspace_id="default",
        user_id="system")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, wrapper.handle_order_created, payload)

    return {"status": "ok"}
