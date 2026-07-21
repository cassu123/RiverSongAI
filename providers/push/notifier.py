"""
providers/push/notifier.py

Q4#16 — central push fan-out helper.

Two entry points:
  notify_user(store, user_id, title, body)  — push to one user.
  notify_admins(store, title, body)         — push to every active admin.

Both fan out across Web Push (via send_push), ntfy.sh (via send_ntfy), and
Apprise (via apprise_provider.push) in parallel channels, honour their
respective settings flags, and clean up expired (HTTP 410) Web Push
subscriptions automatically. Per-subscription Web Push sends run via
asyncio.gather to keep tail latency from compounding when an admin has
multiple devices or when fanning out to multiple admins. Errors never
propagate — callers can fire-and-forget.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from config.settings import get_settings
from providers.push.sender import send_push
from providers.push.ntfy import send_ntfy
from providers.push.fcm import send_fcm, is_configured as fcm_is_configured

logger = logging.getLogger(__name__)


async def _send_one_webpush(sub_json: str, title: str, body: str, icon: str, url: str = None):
    """Wrap send_push so transient exceptions don't tear down asyncio.gather.

    Returns a tri-state: True (delivered), False (410 Gone — delete the sub),
    None (transient/unknown — neither count nor delete). Splitting these
    cleanly avoids inflating delivery metrics on transport errors.
    """
    try:
        ok = await send_push(sub_json, title=title, body=body, icon=icon, url=url)
    except Exception as exc:
        logger.warning("notify: send_push raised: %s", exc)
        return None
    return bool(ok)


async def _send_one_fcm(token: str, title: str, body: str):
    """Same tri-state contract as _send_one_webpush. FCM 4xx → prune token."""
    try:
        return await send_fcm(token, title=title, body=body)
    except Exception as exc:
        logger.warning("notify: send_fcm raised: %s", exc)
        return None


async def _send_ntfy_silent(user_id: str, title: str, body: str) -> None:
    try:
        await send_ntfy(user_id=user_id, title=title, body=body)
    except Exception as exc:
        logger.warning("notify: ntfy raised for %s: %s", user_id, exc)


async def _send_apprise_silent(title: str, body: str) -> None:
    try:
        from providers.push.apprise_provider import push as apprise_push
        await apprise_push(title=title, body=body)
    except Exception as exc:
        logger.warning("notify: apprise raised: %s", exc)


def _apprise_configured() -> bool:
    import os
    return bool((os.environ.get("APPRISE_URLS") or "").strip())


async def notify_user(
    store,
    user_id: str,
    title: str,
    body: str,
    icon: Optional[str] = None,
    url: Optional[str] = None,
    priority: str = "normal",
) -> int:
    """
    Push to every active subscription belonging to `user_id`.

    Returns the number of Web Push subscriptions that successfully received
    the notification. ntfy and Apprise outcomes are not counted (their
    delivery is opaque to River — the topic/channel owner sees it on
    their device).
    """
    settings = get_settings()
    delivered = 0
    icon_url = icon or "/icon-192.png"

    if getattr(settings, "push_notifications_enabled", False):
        try:
            subs = await store.get_push_subscriptions(user_id)
        except Exception as exc:
            logger.warning(
                "notify_user: store lookup failed for %s: %s",
                user_id,
                exc)
            subs = []
        if subs:
            results = await asyncio.gather(
                *[_send_one_webpush(s, title, body, icon_url, url) for s in subs],
                return_exceptions=False,
            )
            to_delete: list[str] = []
            for sub_json, outcome in zip(subs, results):
                if outcome is True:
                    delivered += 1
                elif outcome is False:
                    # Explicit 410 Gone — sub expired, prune it.
                    try:
                        endpoint = json.loads(sub_json).get("endpoint")
                        if endpoint:
                            to_delete.append(endpoint)
                    except Exception:
                        pass
                # outcome is None → transient; neither count nor delete.
            if to_delete:
                await asyncio.gather(
                    *[store.delete_push_subscription(user_id, ep)
                      for ep in to_delete],
                    return_exceptions=True,
                )

    if fcm_is_configured():
        try:
            tokens = await store.get_fcm_tokens(user_id)
        except Exception as exc:
            logger.warning(
                "notify_user: fcm token lookup failed for %s: %s",
                user_id, exc,
            )
            tokens = []
        if tokens:
            fcm_results = await asyncio.gather(
                *[_send_one_fcm(t, title, body) for t in tokens],
                return_exceptions=False,
            )
            to_delete_tokens: list[str] = []
            for tok, outcome in zip(tokens, fcm_results):
                if outcome is True:
                    delivered += 1
                elif outcome is False:
                    to_delete_tokens.append(tok)
            if to_delete_tokens:
                await asyncio.gather(
                    *[store.delete_fcm_token(user_id, tok)
                      for tok in to_delete_tokens],
                    return_exceptions=True,
                )

    extra_channels = []
    if getattr(settings, "ntfy_enabled", False):
        extra_channels.append(_send_ntfy_silent(user_id, title, body))
    if _apprise_configured():
        extra_channels.append(_send_apprise_silent(title, body))
    if extra_channels:
        await asyncio.gather(*extra_channels, return_exceptions=False)

    return delivered


async def notify_admins(
    store,
    title: str,
    body: str,
    icon: Optional[str] = None,
) -> int:
    """
    Push to every active admin in parallel.
    Returns the total delivered Web Push count across all admins.
    """
    try:
        users = await store.list_users()
    except Exception as exc:
        logger.warning("notify_admins: list_users failed: %s", exc)
        return 0
    active_admins = [
        u for u in users
        if u.get("role") == "admin"
        and u.get("is_approved")
        and not u.get("is_suspended")
    ]
    if not active_admins:
        return 0
    counts = await asyncio.gather(
        *[notify_user(store, u["id"], title, body, icon=icon)
          for u in active_admins],
        return_exceptions=False,
    )
    return sum(counts)
