"""
api/routes/shopify_auth.py

Shopify OAuth endpoints for connecting stores.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from core.auth import decode_token
from config.settings import get_settings
from providers.commerce.shopify_auth import ShopifyAuthProvider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shopify", tags=["commerce"])

_SHOP_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


def _normalize_shop(shop: str) -> str:
    """Normalize and validate a shop domain. Raises 400 on anything that
    isn't a plain *.myshopify.com host — the domain is interpolated into
    OAuth URLs, so it must never be attacker-shaped."""
    shop = shop.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
    if not shop.endswith(".myshopify.com"):
        shop = f"{shop}.myshopify.com"
    if not _SHOP_DOMAIN_RE.match(shop):
        raise HTTPException(status_code=400, detail="Invalid shop domain.")
    return shop


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
    shop = _normalize_shop(shop)
    provider = _get_provider(request)
    # CSRF protection: one-time nonce bound server-side to the user, same
    # pattern as the Google flow. Never put the raw user_id in state.
    state_nonce = uuid.uuid4().hex
    store = request.app.state.memory_manager._store
    await store.put_oauth_nonce(state_nonce, user_id, "shopify", ttl_seconds=600)
    auth_url = provider.get_auth_url(shop, state=state_nonce)
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
    shop = _normalize_shop(shop)
    provider = _get_provider(request)

    # Verify HMAC
    params = dict(request.query_params)
    if not provider.verify_hmac(params):
        logger.warning(
            "Shopify auth callback HMAC verification failed for shop %s",
            shop)
        return RedirectResponse(url="/analytics?error=hmac_mismatch")

    store = request.app.state.memory_manager._store
    # Validate-and-consume the one-time state nonce; returns the bound user.
    user_id = await store.consume_oauth_nonce(state, "shopify")
    if not user_id:
        logger.warning("Shopify auth callback with invalid/expired state nonce")
        return RedirectResponse(url="/analytics?error=state_validation_failed")

    try:
        creds = await provider.exchange_code(shop, code)

        # Save credentials for the analytics consumers
        await store.upsert_analytics_platform(
            user_id,
            "shopify",
            enabled=True,
            api_key=creds.access_token,
            api_secret=shop,  # Store the shop domain in the secret field
            notes=f"OAuth Scopes: {creds.scope}"
        )

        # Also record it in user_integrations (encrypted) so the
        # Connected Accounts card on the profile page reflects the link.
        from api.routes.integrations import encrypt_token
        await store.upsert_user_integration(
            user_id=user_id,
            service="shopify",
            access_token=encrypt_token(creds.access_token),
            metadata={"store_name": shop},
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
    # Keep the profile page's Connected Accounts card in sync.
    await store.deactivate_user_integration(user_id, "shopify")
    logger.info("Shopify disconnected for user %s", user_id)
    return {"ok": True}
