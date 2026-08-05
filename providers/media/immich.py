# providers/media/immich.py
from __future__ import annotations
import logging
import os
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("IMMICH_URL", "http://localhost:2283")
_TOKEN = os.getenv("IMMICH_API_KEY", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "x-api-key": _TOKEN
    }
    return httpx.AsyncClient(base_url=_BASE, headers=headers, timeout=10)


async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Immich API key missing, returning None")
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
            logger.warning("Immich %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data


async def search_photos(query: str, limit: int = 50) -> list[dict]:
    """Search for photos in Immich."""
    return await _get("/api/search/photos", params={"searchTerm": query, "clip": "true"}) or []


async def get_photo(asset_id: str) -> dict | None:
    """Retrieve photo/asset metadata."""
    return await _get(f"/api/asset/assetById/{asset_id}")


async def albums() -> list[dict]:
    """Retrieve list of albums."""
    return await _get("/api/album") or []
