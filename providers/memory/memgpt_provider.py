# providers/memory/memgpt_provider.py
from __future__ import annotations
import logging, os, time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE  = os.getenv("MEMGPT_URL", "http://localhost:8283")
_TOKEN = os.getenv("MEMGPT_TOKEN", "") # Admin token
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}

def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {_TOKEN}" if _TOKEN else ""
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip("/") + "/api", headers=headers, timeout=10)

async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        return None
    async with _client() as c:
        try:
            r = await c.get(path, params=params or {})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("MemGPT %s failed: %s", path, exc)
            return None

async def recall(user_id: str, query: str) -> list[str]:
    """
    Search archival memory in MemGPT.
    """
    if not _TOKEN:
        return []
    
    # MemGPT usually groups memory by agent/user.
    # For now, we assume a one-to-one mapping or a shared archival search.
    # This is a placeholder for the actual MemGPT archival search API.
    async with _client() as c:
        try:
            # Placeholder for archival search
            # r = await c.post(f"/agents/{user_id}/archival", json={"query": query})
            # r.raise_for_status()
            # return [res["text"] for res in r.json().get("results", [])]
            return []
        except Exception as exc:
            logger.warning("MemGPT recall failed: %s", exc)
            return []

async def archive_text(user_id: str, text: str):
    """
    Push text into MemGPT's archival memory.
    """
    if not _TOKEN:
        return
    async with _client() as c:
        try:
            # Placeholder for archival insertion
            # await c.post(f"/agents/{user_id}/archival", json={"text": text})
            pass
        except Exception as exc:
            logger.warning("MemGPT archiving failed: %s", exc)
