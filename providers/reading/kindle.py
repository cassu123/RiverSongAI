# =============================================================================
# providers/reading/kindle.py
#
# Kindle library interface for River Song AI.
#
# Multi-user design:
#   Reuses the Audible auth file (data/audible/{user_id}.json) since Kindle
#   and Audible share the same Amazon account. If the user has connected
#   Audible, Kindle works automatically with no second login.
#
#   Auth file path can be overridden by KINDLE_AUTH_BASE_PATH; it defaults
#   to AUDIBLE_AUTH_BASE_PATH so one login covers both services.
#
# What it provides:
#   - Full Kindle library sorted by recent purchase / addition
#   - Title, author, ASIN, cover URL, reading progress
#
# Authentication:
#   Uses the `audible` library to load stored Amazon OAuth credentials, then
#   calls the Kindle Cloud Reader library endpoint with the access token.
#
# Dependencies:
#   audible>=0.9.0  (already required for Audible provider)
#   httpx>=0.27.0   (already in requirements.txt)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import List

import httpx

logger = logging.getLogger(__name__)

_KCR_BASE = "https://read.amazon.com"

try:
    import audible
    _AUDIBLE_AVAILABLE = True
except ImportError:
    _AUDIBLE_AVAILABLE = False


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class KindleBook:
    asin: str
    title: str
    authors: List[str]
    cover_url: str = ""
    percent_complete: float = -1.0   # 0-100; -1 if unknown
    is_sample: bool = False


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class KindleProvider:
    """
    Interface to the user's Kindle library.

    Shares auth storage with AudibleProvider (same Amazon account).
    Auth file path is configurable so both can point at the same directory.
    """

    def __init__(self, auth_base_path: str, country_code: str = "us") -> None:
        self._auth_base = auth_base_path
        self._country_code = country_code.lower()
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="kindle")

    def _auth_file_for(self, user_id: str) -> str:
        return os.path.join(self._auth_base, f"{user_id}.json")

    def _get_access_token(self, user_id: str) -> str:
        """Load Amazon OAuth credentials and return a current access token."""
        if not _AUDIBLE_AVAILABLE:
            raise RuntimeError(
                "audible package not installed. Run: pip install audible")
        path = self._auth_file_for(user_id)
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"No Amazon auth found for user '{user_id}'. "
                "Connect Audible first — Kindle shares the same Amazon account."
            )
        auth = audible.Authenticator.from_file(path)
        return auth.access_token

    def _sync_get_library(self, user_id: str, limit: int) -> List[KindleBook]:
        token = self._get_access_token(user_id)
        # Kindle Cloud Reader library endpoint
        url = f"{_KCR_BASE}/kindle-library"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "KindleCloudReader/1.0",
        }
        params = {
            "sortType": "recency",
            "isExtendedMYK": "false",
            "startIndex": "0",
            "batchSize": str(min(limit, 50)),
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()

        books = []
        for item in data.get("itemsList", []):
            if item.get("productTypeName") not in ("EBOOK", "COMICS"):
                continue
            asin = item.get("asin", "")
            title = item.get("title", "Unknown")
            # Authors come as a list of dicts or a single string depending on
            # edition
            raw_authors = item.get("authors") or []
            if isinstance(raw_authors, list):
                authors = [
                    a.get(
                        "name",
                        a) if isinstance(
                        a,
                        dict) else str(a) for a in raw_authors]
            else:
                authors = [str(raw_authors)]
            cover_url = (
                item.get("productImage", "")
                or (f"https://images-na.ssl-images-amazon.com/images/P/{asin}.01.LZZZZZZZ.jpg" if asin else "")
            )
            percent = -1.0
            progress = item.get("readingStatus") or {}
            pos = progress.get("percentRead")
            if pos is not None:
                try:
                    percent = float(pos)
                except (TypeError, ValueError):
                    pass
            books.append(KindleBook(
                asin=asin,
                title=title,
                authors=authors,
                cover_url=cover_url,
                percent_complete=percent,
                is_sample=item.get("isSample", False),
            ))
        return books

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def get_library(self, user_id: str,
                          limit: int = 50) -> List[KindleBook]:
        """Return up to *limit* Kindle books for this user."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor, self._sync_get_library, user_id, limit
        )

    def is_connected(self, user_id: str) -> bool:
        return os.path.exists(self._auth_file_for(user_id))


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_kindle_provider(settings=None) -> KindleProvider:
    if settings is None:
        from config.settings import get_settings
        settings = get_settings()
    # Default to the same directory as Audible — same auth file, same Amazon
    # account
    auth_base = getattr(
        settings,
        "kindle_auth_base_path",
        settings.audible_auth_base_path)
    return KindleProvider(auth_base_path=auth_base,
                          country_code=settings.audible_country_code)
