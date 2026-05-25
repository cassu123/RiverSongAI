# providers/finance/firefly.py
from __future__ import annotations
import logging, os, time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE  = os.getenv("FIREFLY_URL", "http://localhost:8082")
_TOKEN = os.getenv("FIREFLY_TOKEN", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}

def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {_TOKEN}"
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip("/") + "/api/v1", headers=headers, timeout=10)

async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Firefly token missing, returning None")
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
            logger.warning("Firefly %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data

async def summary() -> dict | None:
    """Retrieve financial summary."""
    return await _get("/summary/basic")

async def transactions(start: str, end: str) -> list[dict]:
    """Retrieve transactions within a date range."""
    data = await _get("/transactions", params={"start": start, "end": end})
    return data.get("data", []) if data else []

async def accounts() -> list[dict]:
    """Retrieve list of accounts."""
    data = await _get("/accounts")
    return data.get("data", []) if data else []
