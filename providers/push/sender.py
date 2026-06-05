"""
providers/push/sender.py
Sends Web Push notifications via pywebpush.
"""
import json
import logging
import asyncio
from pywebpush import webpush, WebPushException
from config.settings import get_settings

logger = logging.getLogger(__name__)


async def send_push(subscription_json: str, title: str, body: str,
                    icon: str = "/favicon.ico") -> bool:
    """
    Send a single push notification.
    Returns True on success, False if subscription is gone (caller should delete).
    Raises RuntimeError for config errors.
    """
    s = get_settings()
    if not s.push_notifications_enabled:
        return False
    if not s.vapid_private_key or not s.vapid_public_key:
        raise RuntimeError(
            "Push notifications require VAPID_PRIVATE_KEY and "
            "VAPID_PUBLIC_KEY in .env. Generate them with pywebpush."
        )

    subscription = json.loads(subscription_json)
    payload = json.dumps({"title": title, "body": body, "icon": icon})

    try:
        await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=s.vapid_private_key,
                vapid_claims={
                    "sub": s.vapid_claims_email,
                    "aud": subscription["endpoint"].rsplit("/", 1)[0],
                },
            )
        )
        return True
    except WebPushException as exc:
        if exc.response is not None and exc.response.status_code == 410:
            logger.info("Push subscription expired (410): %s", exc)
            return False  # caller deletes it
        logger.error("Push send failed: %s", exc)
        return True  # don't delete — may be transient
