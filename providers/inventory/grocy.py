# providers/inventory/grocy.py
from __future__ import annotations
import logging, os, time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE  = os.getenv("GROCY_URL", "http://localhost:9283")
_TOKEN = os.getenv("GROCY_API_KEY", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}

def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "GROCY-API-KEY": _TOKEN
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip("/") + "/api", headers=headers, timeout=10)

async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Grocy API key missing, returning None")
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
            logger.warning("Grocy %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data

async def stock() -> list[dict]:
    """Retrieve current stock."""
    return await _get("/stock") or []

async def shopping_list() -> list[dict]:
    """Retrieve shopping list."""
    return await _get("/objects/shopping_list") or []

async def add_to_shopping_list(product_id: int, qty: float = 1.0) -> bool:
    """Add a product to the shopping list."""
    if not _TOKEN:
        return False
    async with _client() as c:
        try:
            payload = {"product_id": product_id, "amount": qty}
            r = await c.post("/stock/shoppinglist/add-product", json=payload)
            r.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("Grocy add_to_shopping_list failed: %s", exc)
            return False

async def expiring(days: int = 5) -> list[dict]:
    """Retrieve products expiring within a certain number of days."""
    return await _get("/stock/volatile/expiring-soon") or []
