"""
providers/push/notifier.py

Q4#16 — central push fan-out helper.

Two entry points:
  notify_user(store, user_id, title, body)  — push to one user.
  notify_admins(store, title, body)         — push to every active admin.

Both delegate to send_push (Web Push) and send_ntfy (ntfy.sh) in parallel
channels, honour their respective settings flags, and clean up expired
(HTTP 410) Web Push subscriptions automatically. Errors never propagate —
callers can fire-and-forget.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from config.settings import get_settings
from providers.push.sender import send_push
from providers.push.ntfy import send_ntfy

logger = logging.getLogger(__name__)


async def notify_user(
    store,
    user_id: str,
    title: str,
    body: str,
    icon: Optional[str] = None,
) -> int:
    """
    Push to every active subscription belonging to `user_id`.

    Returns the number of Web Push subscriptions that successfully received
    the notification. ntfy outcome is not counted (its delivery is opaque to
    River — the topic owner sees it on their device).
    """
    settings = get_settings()
    delivered = 0

    if getattr(settings, "push_notifications_enabled", False):
        try:
            subs = await store.get_push_subscriptions(user_id)
        except Exception as exc:
            logger.warning("notify_user: store lookup failed for %s: %s", user_id, exc)
            subs = []
        for sub_json in subs:
            try:
                ok = await send_push(
                    sub_json,
                    title=title,
                    body=body,
                    icon=icon or "/icon-192.png",
                )
            except Exception as exc:
                logger.warning("notify_user: send_push raised for %s: %s", user_id, exc)
                ok = True
            if ok:
                delivered += 1
            else:
                try:
                    endpoint = json.loads(sub_json).get("endpoint")
                    if endpoint:
                        await store.delete_push_subscription(user_id, endpoint)
                except Exception:
                    pass

    if getattr(settings, "ntfy_enabled", False):
        try:
            await send_ntfy(user_id=user_id, title=title, body=body)
        except Exception as exc:
            logger.warning("notify_user: ntfy raised for %s: %s", user_id, exc)

    return delivered


async def notify_admins(
    store,
    title: str,
    body: str,
    icon: Optional[str] = None,
) -> int:
    """
    Push to every active admin. Returns the total delivered Web Push count
    across all admins.
    """
    delivered = 0
    try:
        users = await store.list_users()
    except Exception as exc:
        logger.warning("notify_admins: list_users failed: %s", exc)
        return 0
    for u in users:
        if (
            u.get("role") == "admin"
            and u.get("is_approved")
            and not u.get("is_suspended")
        ):
            delivered += await notify_user(store, u["id"], title, body, icon=icon)
    return delivered
