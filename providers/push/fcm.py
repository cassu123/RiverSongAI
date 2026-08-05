"""
providers/push/fcm.py

FCM (Firebase Cloud Messaging) push channel for the Capacitor Android wrap.

Web Push covers the browser. ntfy covers operator-side off-device alerts.
FCM is what the installed Android APK actually receives: when the user has
the river-song-frontend wrapped via Capacitor, the device subscribes to FCM
and posts the resulting token to /api/push/fcm/register. This module sends
the actual notifications using FCM's HTTP v1 API with a service-account JWT.

Return contract — Optional[bool], same tri-state as send_push:
    True   → delivered
    False  → token rejected by FCM (UNREGISTERED / SENDER_ID_MISMATCH /
             4xx in general); caller should prune the token from storage
    None   → transient (network error, 5xx, quota); leave the token alone

Flag-off, missing config, or missing google-auth → returns False (caller
should still NOT prune on False here; only prune on a real 4xx delivery
attempt). To distinguish "skipped" from "rejected", inspect
`is_configured()` first.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import httpx

from config.settings import get_settings

logger = logging.getLogger(__name__)

_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_FCM_URL_TMPL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

# Module-level credentials cache. google-auth handles its own refresh once we
# hand it a Request, so as long as we keep the Credentials instance alive the
# access token is reused until it expires (~1 hour).
_credentials = None


def is_configured() -> bool:
    settings = get_settings()
    if not getattr(settings, "fcm_enabled", False):
        return False
    if not getattr(settings, "fcm_project_id", ""):
        return False
    path = getattr(settings, "fcm_service_account_path", "")
    return bool(path) and os.path.isfile(path)


def _load_credentials():
    """Load + cache service-account credentials. Returns None if google-auth
    is missing or the service-account file can't be read."""
    global _credentials
    if _credentials is not None:
        return _credentials
    settings = get_settings()
    try:
        from google.oauth2 import service_account
    except Exception as exc:
        logger.warning("fcm: google-auth not installed: %s", exc)
        return None
    try:
        _credentials = service_account.Credentials.from_service_account_file(
            settings.fcm_service_account_path,
            scopes=[_FCM_SCOPE],
        )
    except Exception as exc:
        logger.warning(
            "fcm: failed to load service-account at %s: %s",
            settings.fcm_service_account_path, exc,
        )
        return None
    return _credentials


def _get_access_token() -> Optional[str]:
    """Refresh + return a bearer token, synchronously. Call inside
    asyncio.to_thread() — google-auth uses blocking requests."""
    creds = _load_credentials()
    if creds is None:
        return None
    try:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
    except Exception as exc:
        logger.warning("fcm: token refresh failed: %s", exc)
        return None
    return creds.token


async def send_fcm(
    token: str,
    title: str,
    body: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> Optional[bool]:
    """Send a single FCM notification. See module docstring for return semantics."""
    if not is_configured():
        return False
    settings = get_settings()

    access_token = await asyncio.to_thread(_get_access_token)
    if not access_token:
        return None

    url = _FCM_URL_TMPL.format(project_id=settings.fcm_project_id)
    payload = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
        }
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }

    owns_client = client is None
    try:
        c = client or httpx.AsyncClient(timeout=8.0)
        try:
            resp = await c.post(url, json=payload, headers=headers)
        finally:
            if owns_client:
                await c.aclose()
    except Exception as exc:
        logger.warning("fcm send failed for token %s…: %s", token[:12], exc)
        return None

    if 200 <= resp.status_code < 300:
        return True
    if 400 <= resp.status_code < 500:
        # 4xx — token is bad (UNREGISTERED / SENDER_ID_MISMATCH / etc).
        # Caller should prune.
        logger.info(
            "fcm rejected token %s… (%s): %s",
            token[:12], resp.status_code, resp.text[:200],
        )
        return False
    # 5xx — transient. Leave the token alone.
    logger.warning(
        "fcm transient error for token %s… (%s): %s",
        token[:12], resp.status_code, resp.text[:200],
    )
    return None
