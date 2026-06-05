# providers/culinary/tandoor.py
from __future__ import annotations
import logging
import os
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("TANDOOR_URL", "http://localhost:8085")
_TOKEN = os.getenv("TANDOOR_TOKEN", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {_TOKEN}"
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip(
        "/") + "/api", headers=headers, timeout=10)


async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Tandoor token missing, returning None")
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
            logger.warning("Tandoor %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data


async def search_recipes(q: str) -> list[dict]:
    """Search for recipes in Tandoor."""
    data = await _get("/recipe/", params={"search": q})
    return data.get("results", []) if data else []


async def recipe(recipe_id: int) -> dict | None:
    """Retrieve recipe details."""
    return await _get(f"/recipe/{recipe_id}/")


async def import_url(url: str) -> dict | None:
    """Import a recipe from a URL."""
    if not _TOKEN:
        return None
    async with _client() as c:
        try:
            r = await c.post("/recipe/import-url/", json={"url": url})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("Tandoor import_url failed: %s", exc)
            return None
