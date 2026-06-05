"""
api/routes/shopify_auth.py

Shopify OAuth endpoints for connecting stores.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from core.auth import decode_token
from config.settings import get_settings
from providers.commerce.shopify_auth import ShopifyAuthProvider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shopify", tags=["commerce"])


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]


def _get_provider(request: Request):
    settings = get_settings()
    if not settings.shopify_api_key or not settings.shopify_api_secret:
        raise HTTPException(status_code=500,
                            detail="Shopify API keys not configured.")

    # In a real app, the redirect URI should be absolute
    redirect_uri = f"{request.base_url}api/shopify/auth/callback"
    return ShopifyAuthProvider(
        api_key=settings.shopify_api_key,
        api_secret=settings.shopify_api_secret,
        redirect_uri=redirect_uri
    )


@router.get("/auth/url")
async def get_shopify_auth_url(
    request: Request,
    shop: str = Query(...),
    authorization: Optional[str] = Header(default=None),
):
    """
    Step 1: Get the Shopify authorization URL.
    """
    user_id = await _require_user(authorization)
    provider = _get_provider(request)
    # Use user_id as state to verify on callback
    auth_url = provider.get_auth_url(shop, state=user_id)
    return {"auth_url": auth_url}


@router.get("/auth/callback")
async def shopify_auth_callback(
    request: Request,
    shop: str = Query(...),
    code: str = Query(...),
    state: str = Query(...),
    hmac: str = Query(...),
    timestamp: str = Query(...),
):
    """
    Step 2: Shopify redirects back here.
    Exchange code for access token and save to store.
    """
    user_id = state  # state is our user_id
    provider = _get_provider(request)

    # Verify HMAC
    params = dict(request.query_params)
    if not provider.verify_hmac(params):
        logger.warning(
            "Shopify auth callback HMAC verification failed for shop %s",
            shop)
        return RedirectResponse(url="/analytics?error=hmac_mismatch")

    try:
        creds = await provider.exchange_code(shop, code)

        # Save credentials to the user store
        store = request.app.state.memory_manager._store
        await store.upsert_analytics_platform(
            user_id,
            "shopify",
            enabled=True,
            api_key=creds.access_token,
            api_secret=shop,  # Store the shop domain in the secret field
            notes=f"OAuth Scopes: {creds.scope}"
        )

        logger.info(
            "Successfully connected Shopify store %s for user %s",
            shop,
            user_id)
        return RedirectResponse(url="/analytics?connected=shopify")
    except Exception as exc:
        logger.error("Shopify auth exchange failed: %s", exc)
        return RedirectResponse(url=f"/analytics?error={exc}")


@router.get("/status")
async def get_shopify_status(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Check if the user has a Shopify store connected.
    """
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    platforms = await store.get_analytics_platforms(user_id)

    shopify = next((p for p in platforms if p["platform"] == "shopify"), None)
    if shopify and shopify["enabled"]:
        return {
            "connected": True,
            "shop": shopify["api_secret"],  # We stored shop domain here
            "scopes": shopify["notes"]
        }
    return {"connected": False}


@router.delete("/auth")
async def disconnect_shopify(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Disable the user's Shopify store connection."""
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    await store.upsert_analytics_platform(user_id, "shopify", enabled=False)
    logger.info("Shopify disconnected for user %s", user_id)
    return {"ok": True}
