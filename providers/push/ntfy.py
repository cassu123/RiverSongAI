"""
providers/push/ntfy.py

Q4#17 — ntfy.sh push channel.

Posts a notification to an ntfy topic over HTTP. Used as a parallel channel
alongside Web Push so off-device alerts arrive even when the recipient has
no registered service worker (mobile lock screen, etc).

Topic resolution order:
  1. Environment var NTFY_TOPIC_<USER_ID_UPPERCASE>
  2. settings.ntfy_default_topic

Returns False on flag-off, missing topic, or transport failure — callers
should never depend on push reaching its destination.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

from config.settings import get_settings

logger = logging.getLogger(__name__)


def _resolve_topic(user_id: str) -> Optional[str]:
    settings = get_settings()
    safe = "".join(c for c in user_id if c.isalnum() or c == "_").upper()
    if safe:
        env_topic = os.environ.get(f"NTFY_TOPIC_{safe}")
        if env_topic and env_topic.strip():
            return env_topic.strip()
    default = (getattr(settings, "ntfy_default_topic", "") or "").strip()
    return default or None


async def send_ntfy(
    user_id: str,
    title: str,
    body: str,
    priority: int = 3,
    tags: Optional[list[str]] = None,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Send a single ntfy notification. Returns True on 2xx, False otherwise."""
    settings = get_settings()
    if not getattr(settings, "ntfy_enabled", False):
        return False
    topic = _resolve_topic(user_id)
    if not topic:
        logger.debug("ntfy: no topic resolved for user %s; skipping", user_id)
        return False
    base = (settings.ntfy_base_url or "https://ntfy.sh").rstrip("/")
    url = f"{base}/{topic}"
    headers = {
        "Title": title,
        "Priority": str(priority),
    }
    if tags:
        headers["Tags"] = ",".join(tags)
    token = (settings.ntfy_auth_token or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    owns_client = client is None
    try:
        c = client or httpx.AsyncClient(timeout=5.0)
        try:
            resp = await c.post(url, content=body.encode("utf-8"), headers=headers)
        finally:
            if owns_client:
                await c.aclose()
        if resp.status_code >= 400:
            logger.warning("ntfy %s -> %s: %s", topic,
                           resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as exc:
        logger.warning("ntfy send failed for topic %s: %s", topic, exc)
        return False
