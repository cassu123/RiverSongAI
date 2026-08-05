# providers/push/apprise_provider.py
import asyncio
import logging
import os
import apprise

logger = logging.getLogger(__name__)

_APRISE: apprise.Apprise | None = None


def _get_client() -> apprise.Apprise:
    global _APRISE
    if _APRISE is None:
        _APRISE = apprise.Apprise()
        urls = (os.getenv("APPRISE_URLS") or "").split(",")
        for url in urls:
            url = url.strip()
            if url:
                _APRISE.add(url)
    return _APRISE


async def push(title: str, body: str, tag: str | None = None) -> bool:
    """
    Send a notification via Apprise to all configured URLs.
    """
    if not (os.getenv("APPRISE_URLS") or "").strip():
        logger.warning("APPRISE_URLS not configured")
        return False

    # Run sync model in a thread to keep the event loop responsive
    def _run():
        client = _get_client()
        return client.notify(title=title, body=body, tag=tag)

    return await asyncio.to_thread(_run)
