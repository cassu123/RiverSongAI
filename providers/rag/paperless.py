# providers/rag/paperless.py
from __future__ import annotations
import logging
import os
import time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("PAPERLESS_URL", "http://localhost:8010")
_TOKEN = os.getenv("PAPERLESS_TOKEN", "")
_CACHE_TTL = 30  # seconds for read-heavy endpoints
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Token {_TOKEN}" if _TOKEN else ""
    }
    return httpx.AsyncClient(base_url=_BASE, headers=headers, timeout=10)


async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("Paperless token missing, returning None")
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
            logger.warning("Paperless %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data


async def search(q: str) -> list[dict]:
    """Search for documents in Paperless."""
    data = await _get("/api/documents/", params={"query": q})
    if not data:
        return []
    return data.get("results", [])


async def get_document(doc_id: int) -> dict | None:
    """Retrieve document metadata."""
    return await _get(f"/api/documents/{doc_id}/")


async def download_pdf(doc_id: int) -> bytes | None:
    """Download the PDF content of a document."""
    if not _TOKEN:
        return None
    async with _client() as c:
        try:
            r = await c.get(f"/api/documents/{doc_id}/download/")
            r.raise_for_status()
            return r.content
        except Exception as exc:
            logger.warning("Paperless download %s failed: %s", doc_id, exc)
            return None
