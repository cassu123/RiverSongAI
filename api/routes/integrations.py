"""
api/routes/integrations.py

Unified admin surface for third-party service connection state, plus a
single Google OAuth flow that persists tokens into ``user_integrations``.

Auth model:
- /status, /{service}/disconnect, /{service}/store          → admin JWT
- /google/authorize                                          → caller JWT (any user; their own tokens)
- /google/callback                                           → no JWT (Google calls us); CSRF via stored OAuth state nonce

The Google OAuth flow here writes into the ``user_integrations`` table.
It is intentionally separate from ``providers/google/auth.py`` +
``api/routes/google.py``, which manage on-disk per-user token JSON used
by the Google Calendar / Gmail / Tasks / Maps providers. The two flows
serve different downstream consumers; do not collapse without first
migrating ``providers/google/*`` to read from the SQLite table.
"""

from fastapi import APIRouter, HTTPException, status, Request, Header
from fastapi.responses import RedirectResponse
from typing import Optional
from pydantic import BaseModel
import logging
import os
import json
import uuid
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from cryptography.fernet import Fernet

from config.settings import get_settings
from core.auth import decode_token
from core.errors import unauthorized, forbidden
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

async def _require_admin(request: Request,
                         authorization: Optional[str]) -> dict:
    """Validate a Bearer JWT and require admin role. Returns the full payload."""
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    if payload.get("role") != "admin":
        raise forbidden("Admin access required.")
    return payload


async def _require_user(authorization: Optional[str]) -> str:
    """Validate a Bearer JWT and return the user id. Used for /google/authorize."""
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized("Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise unauthorized("Invalid or expired token.")
    return payload.get("sub") or payload.get("id") or ""


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class IntegrationStatus(BaseModel):
    service: str
    connected: bool
    metadata: dict = {}


class IntegrationListResponse(BaseModel):
    integrations: dict  # {service_key: {connected, metadata}}


class IntegrationUpdateRequest(BaseModel):
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    metadata: Optional[dict] = None


# ---------------------------------------------------------------------------
# Token encryption
# ---------------------------------------------------------------------------

_KEY_FILE = Path("data") / ".token_encryption_key"


def _get_encryption_key() -> bytes:
    key = get_settings().token_encryption_key or os.getenv("TOKEN_ENCRYPTION_KEY", "")
    if not key and _KEY_FILE.exists():
        key = _KEY_FILE.read_text().strip()
    if not key:
        # Generate once and persist so encrypted tokens survive restarts.
        # Set TOKEN_ENCRYPTION_KEY in .env to manage the key explicitly.
        key = Fernet.generate_key().decode()
        _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _KEY_FILE.write_text(key)
        _KEY_FILE.chmod(0o600)
        logger.warning(
            "TOKEN_ENCRYPTION_KEY not set; generated a new key and saved it to %s. "
            "Move this value into .env as TOKEN_ENCRYPTION_KEY and back it up — "
            "losing it makes stored integration tokens unrecoverable.",
            _KEY_FILE,
        )
    try:
        Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not a valid Fernet key. Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        ) from exc
    return key.encode()


def encrypt_token(token: str) -> str:
    return Fernet(_get_encryption_key()).encrypt(token.encode()).decode()


def decrypt_token(encrypted_token: str) -> str:
    return Fernet(_get_encryption_key()).decrypt(
        encrypted_token.encode()).decode()


def _get_store(request: Request) -> SQLiteStore:
    return request.app.state.memory_manager._store


# ---------------------------------------------------------------------------
# Admin routes
# ---------------------------------------------------------------------------

@router.get("/status", response_model=IntegrationListResponse)
async def get_integration_status(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id") or "admin_user"
    store = _get_store(request)

    integrations = await store.get_user_integrations(user_id)
    available_services = [
        "google",
        "shopify",
        "amazon_sp_api",
        "walmart",
        "tiktok"]
    result = {}
    for service in available_services:
        integration = next(
            (i for i in integrations if i["service"] == service), None)
        if integration and integration.get("is_active"):
            result[service] = {
                "connected": True,
                "metadata": integration.get("metadata", {}),
            }
        else:
            result[service] = {"connected": False, "metadata": {}}
    return IntegrationListResponse(integrations=result)


@router.delete("/{service}/disconnect")
async def disconnect_service(
    service: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id") or "admin_user"
    store = _get_store(request)

    integration = await store.get_user_integration(user_id, service)
    if not integration or not integration.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active {service} integration found",
        )
    await store.deactivate_user_integration(user_id, service)
    if service == "shopify":
        # Shopify's OAuth callback also stores credentials in the analytics
        # platform table; revoke those too so analytics stops using them.
        await store.upsert_analytics_platform(user_id, "shopify", enabled=False)
    return {"message": f"Successfully disconnected {service}"}


@router.post("/{service}/store")
async def store_integration_tokens(
    service: str,
    token_data: IntegrationUpdateRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    payload = await _require_admin(request, authorization)
    user_id = payload.get("sub") or payload.get("id") or "admin_user"
    store = _get_store(request)

    access_token = encrypt_token(
        token_data.access_token) if token_data.access_token else None
    refresh_token = encrypt_token(
        token_data.refresh_token) if token_data.refresh_token else None
    expires_at = token_data.token_expires_at.isoformat(
    ) if token_data.token_expires_at else None

    await store.upsert_user_integration(
        user_id=user_id,
        service=service,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=expires_at,
        metadata=token_data.metadata,
    )
    return {"message": f"Successfully stored {service} tokens"}


# ---------------------------------------------------------------------------
# Google OAuth flow (CSRF-safe via persisted state nonce)
# ---------------------------------------------------------------------------

def _load_google_client() -> dict:
    settings = get_settings()
    from pathlib import Path
    path = Path(settings.google_client_secrets_path)
    if not path.exists():
        raise HTTPException(status_code=500,
                            detail="Google client secrets not configured.")
    data = json.loads(path.read_text())
    return data.get("web") or data.get("installed") or {}


@router.get("/google/authorize")
async def google_authorize(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Begin a Google OAuth flow for the calling user.

    Returns ``{"auth_url": ...}`` — the frontend fetches this with its JWT
    (a plain browser navigation can't send the Authorization header) and
    then redirects the window to the returned URL.
    """
    # Caller authentication: prefer Authorization header, fall back to cookie.
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    if not token:
        token = request.cookies.get("rs_token")
    if not token:
        raise unauthorized("Not authenticated.")

    payload = await decode_token(token)
    if not payload:
        raise unauthorized("Invalid or expired token.")
    user_id = payload.get("sub") or payload.get("id")
    if not user_id:
        raise unauthorized("Token missing subject claim.")

    from providers.google.auth import DEFAULT_SCOPES
    client = _load_google_client()
    client_id = client.get("client_id", "")
    auth_uri = client.get(
        "auth_uri",
        "https://accounts.google.com/o/oauth2/auth")

    # CSRF protection: generate a one-time nonce, persist it server-side bound
    # to (user_id, service), and pass ONLY the nonce in the OAuth state param.
    # The user_id is never trusted from the callback URL.
    state_nonce = uuid.uuid4().hex
    store = _get_store(request)
    await store.put_oauth_nonce(state_nonce, str(user_id), "google", ttl_seconds=600)

    redirect_uri = f"{
        request.url.scheme}://{
        request.url.netloc}/api/integrations/google/callback"
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(DEFAULT_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state_nonce,
    })
    return {"auth_url": f"{auth_uri}?{params}"}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: Optional[str] = None,
):
    if error:
        return RedirectResponse("/profile?error=google_auth_failed")
    if not state or not code:
        return RedirectResponse("/profile?error=invalid_state")

    store = _get_store(request)
    # Validate-and-consume the nonce. Returns the bound user_id or None.
    user_id = await store.consume_oauth_nonce(state, "google")
    if not user_id:
        return RedirectResponse("/profile?error=state_validation_failed")

    client = _load_google_client()
    redirect_uri = f"{
        request.url.scheme}://{
        request.url.netloc}/api/integrations/google/callback"
    token_uri = client.get("token_uri", "https://oauth2.googleapis.com/token")

    async with httpx.AsyncClient(timeout=10.0) as http:
        token_resp = await http.post(token_uri, data={
            "code": code,
            "client_id": client.get("client_id", ""),
            "client_secret": client.get("client_secret", ""),
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    if token_resp.status_code != 200:
        return RedirectResponse("/profile?error=token_exchange_failed")

    tokens = token_resp.json()
    access_token = encrypt_token(tokens.get("access_token", ""))
    refresh = tokens.get("refresh_token")
    refresh_token = encrypt_token(refresh) if refresh else None
    expires_in = tokens.get("expires_in", 3600)
    expires_at = (
        datetime.utcnow() +
        timedelta(
            seconds=expires_in)).isoformat()

    await store.upsert_user_integration(
        user_id=user_id,
        service="google",
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=expires_at,
        metadata={},
    )
    return RedirectResponse("/profile?connected=google")
