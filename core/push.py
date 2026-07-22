import logging
from providers.push.notifier import notify_user
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

async def send_push_notification(user_id: str, title: str, body: str, data: dict = None, dedupe_key: str = None):
    """
    Compatibility wrapper for send_push_notification.
    Routes to the new notify_user implementation.
    """
    url = None
    if data and "route" in data:
        url = data["route"]

    store = SQLiteStore()
    try:
        await notify_user(
            store=store,
            user_id=user_id,
            title=title,
            body=body,
            url=url
        )
    except Exception as e:
        logger.error(f"Error sending push: {e}")
