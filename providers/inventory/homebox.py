# providers/inventory/homebox.py
from __future__ import annotations
import logging
import os
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("HOMEBOX_URL", "http://localhost:7745")
_TOKEN = os.getenv("HOMEBOX_TOKEN", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {_TOKEN}"
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip(
        "/") + "/api/v1", headers=headers, timeout=10)


async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Homebox token missing, returning None")
        return None
    key = f"GET {path} {params}"
    if (hit := _cache.get(key)) and time.monotonic() < hit[1]:
        return hit[0]
    async with _client() as c:
        try:
            r = await c.get(path, params=params or {})
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            logger.warning("Homebox %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data


async def find(query: str) -> list[dict]:
    """Find items in Homebox."""
    data = await _get("/items", params={"search": query})
    return data.get("items", []) if data else []
