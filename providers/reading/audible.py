# =============================================================================
# providers/reading/audible.py
#
# Audible audiobook interface for River Song AI.
#
# Multi-user design:
#   Each user's auth is stored in a separate file under AUDIBLE_AUTH_BASE_PATH:
#     data/audible/{user_id}.json
#   All public async methods take user_id so concurrent requests for different
#   users never touch each other's credentials or executor state.
#
# Authentication:
#   Uses the `audible` Python library (pip install audible). First-time setup
#   registers River Song as a device on the user's Audible account and writes
#   the auth JSON. All subsequent calls reload from that file -- no re-login.
#
#   One-time setup per user:
#     python -m providers.reading.audible --setup --user-id primary_user
#
# Playback:
#   Interface-only. Resume opens the Audible web player for the correct ASIN
#   in the system browser. No audio content is downloaded or piped locally.
#
# Dependencies:
#   audible>=0.9.0    (pip install audible)
#
# Environment variables (via config/settings.py):
#   AUDIBLE_AUTH_BASE_PATH   -- Base directory for per-user auth files.
#   AUDIBLE_COUNTRY_CODE     -- Marketplace: us | uk | de | fr | es | it | jp | au | ca | in
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import os
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

try:
    import audible
    _AUDIBLE_AVAILABLE = True
except ImportError:
    _AUDIBLE_AVAILABLE = False
    logger.warning("audible package not installed. Run: pip install audible")


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class AudiobookEntry:
    asin: str
    title: str
    authors: List[str]
    narrators: List[str]
    duration_minutes: int
    percent_complete: float      # 0.0-100.0; -1.0 if not available
    cover_url: str = ""


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class AudibleProvider:
    """
    Interface to a user's Audible library.

    All blocking audible calls run in a dedicated ThreadPoolExecutor to avoid
    stalling the asyncio event loop. The audible library is entirely synchronous.

    This class is intended as a process-level singleton. Pass user_id to each
    method -- do not instantiate one provider per user.
    """

    def __init__(self, auth_base_path: str, country_code: str = "us") -> None:
        self._auth_base = auth_base_path
        self._country_code = country_code.lower()
        # Single executor shared across all users. audible calls are lightweight
        # network I/O so one thread is enough; raise max_workers for higher concurrency.
        self._executor = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="audible"
        )

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    def _auth_file_for(self, user_id: str) -> str:
        return os.path.join(self._auth_base, f"{user_id}.json")

    def _load_auth(self, user_id: str) -> "audible.Authenticator":
        if not _AUDIBLE_AVAILABLE:
            raise RuntimeError("audible package not installed. Run: pip install audible")
        path = self._auth_file_for(user_id)
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"No Audible auth found for user '{user_id}' at '{path}'. "
                "Run: python -m providers.reading.audible --setup "
                f"--user-id {user_id}"
            )
        return audible.Authenticator.from_file(path)

    def setup_auth(self, user_id: str, username: str, password: str) -> None:
        """
        Register River Song as an Audible device for the given user.
        Saves auth to {auth_base}/{user_id}.json.
        Called only by the --setup script.
        """
        if not _AUDIBLE_AVAILABLE:
            raise RuntimeError("audible package not installed. Run: pip install audible")
        auth = audible.Authenticator.from_login(
            username=username,
            password=password,
            locale=self._country_code,
            with_username=False,
        )
        os.makedirs(self._auth_base, exist_ok=True)
        auth.to_file(self._auth_file_for(user_id))
        logger.info("Audible auth saved for user '%s'", user_id)

    # ------------------------------------------------------------------
    # Sync helpers (run in executor)
    # ------------------------------------------------------------------

    def _sync_get_library(self, user_id: str, limit: int) -> List[AudiobookEntry]:
        auth = self._load_auth(user_id)
        with audible.Client(auth=auth) as client:
            resp = client.get(
                "library",
                num_results=limit,
                response_groups=(
                    "product_details,"
                    "product_attrs,"
                    "relationships,"
                    "listening_status"
                ),
                sort_by="-PurchaseDate",
            )
        return [self._parse_item(item) for item in resp.get("items", [])]

    def _sync_get_last_listened(self, user_id: str) -> Optional[AudiobookEntry]:
        auth = self._load_auth(user_id)
        with audible.Client(auth=auth) as client:
            resp = client.get(
                "library",
                num_results=50,
                response_groups="product_details,product_attrs,listening_status",
                sort_by="-LastHeard",
            )
        items = resp.get("items", [])
        return self._parse_item(items[0]) if items else None

    @staticmethod
    def _parse_item(item: dict) -> AudiobookEntry:
        authors = [a.get("name", "Unknown") for a in item.get("authors", [])]
        narrators = [n.get("name", "Unknown") for n in item.get("narrators", [])]

        percent = -1.0
        progress = item.get("listening_status") or {}
        pos = progress.get("last_position_heard") or {}
        duration = item.get("runtime_length_min", 0)
        pos_ms = pos.get("position_ms", 0) if isinstance(pos, dict) else 0
        if duration and pos_ms:
            percent = round(min((pos_ms / 60_000) / duration * 100, 100.0), 1)

        return AudiobookEntry(
            asin=item.get("asin", ""),
            title=item.get("title", "Unknown"),
            authors=authors or ["Unknown"],
            narrators=narrators or ["Unknown"],
            duration_minutes=duration,
            percent_complete=percent,
            cover_url=item.get("product_images", {}).get("500", ""),
        )

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def get_library(
        self, user_id: str, limit: int = 20
    ) -> List[AudiobookEntry]:
        """Return up to *limit* audiobooks for *user_id*, sorted by purchase date."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self._executor, self._sync_get_library, user_id, limit
        )

    async def get_last_listened(self, user_id: str) -> Optional[AudiobookEntry]:
        """Return the most recently played audiobook for *user_id*, or None."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self._executor, self._sync_get_last_listened, user_id
        )

    async def resume(
        self, user_id: str, asin: Optional[str] = None
    ) -> str:
        """
        Open the Audible web player for the user's last-listened book (or *asin*).

        Interface-only: opens the browser. No audio content is downloaded.
        Returns a TTS-ready confirmation string.
        """
        book: Optional[AudiobookEntry] = None

        if asin is None:
            try:
                book = await self.get_last_listened(user_id)
            except FileNotFoundError as exc:
                return str(exc)
            except Exception as exc:
                logger.error("Audible get_last_listened failed for '%s': %s", user_id, exc)
                return "I could not reach Audible right now. Check your connection and try again."

        if book is None and asin is None:
            return "I did not find any audiobooks in your Audible library."

        target = asin or (book.asin if book else None)
        if not target:
            return "I could not determine which audiobook to resume."

        url = f"https://www.audible.com/webplayer?asin={target}"
        try:
            webbrowser.open(url)
        except Exception as exc:
            logger.error("webbrowser.open failed: %s", exc)
            title = book.title if book else "your audiobook"
            return (
                f"I found {title} but could not open Audible automatically. "
                "Go to audible.com and resume it manually."
            )

        if book:
            progress = (
                f" You are {book.percent_complete:.0f}% through it."
                if book.percent_complete >= 0
                else ""
            )
            return f"Opening {book.title} in Audible.{progress}"
        return "Opening your audiobook in Audible."

    # ------------------------------------------------------------------
    # Speech formatting
    # ------------------------------------------------------------------

    @staticmethod
    def format_library_for_speech(
        books: List[AudiobookEntry], limit: int = 5
    ) -> str:
        if not books:
            return "Your Audible library appears to be empty."
        shown = books[:limit]
        lines = []
        for i, book in enumerate(shown, 1):
            author = book.authors[0] if book.authors else "Unknown"
            progress = (
                f", {book.percent_complete:.0f}% done"
                if book.percent_complete >= 0
                else ""
            )
            lines.append(f"{i}. {book.title} by {author}{progress}.")
        suffix = (
            f" You have {len(books) - limit} more."
            if len(books) > limit
            else ""
        )
        return "Your recent audiobooks: " + " ".join(lines) + suffix

    @staticmethod
    def format_book_for_speech(book: AudiobookEntry) -> str:
        author = book.authors[0] if book.authors else "Unknown"
        narrator = book.narrators[0] if book.narrators else "Unknown"
        progress = (
            f"You are {book.percent_complete:.0f}% through it."
            if book.percent_complete >= 0
            else "No progress data available."
        )
        h, m = divmod(book.duration_minutes, 60)
        duration = (
            f"{h} hour{'s' if h != 1 else ''} and {m} minute{'s' if m != 1 else ''}."
            if h
            else f"{m} minute{'s' if m != 1 else ''}."
        )
        return (
            f"{book.title} by {author}, narrated by {narrator}. "
            f"{duration} {progress}"
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_audible_provider(settings=None) -> AudibleProvider:
    if settings is None:
        from config.settings import get_settings
        settings = get_settings()
    return AudibleProvider(
        auth_base_path=settings.audible_auth_base_path,
        country_code=settings.audible_country_code,
    )


# ---------------------------------------------------------------------------
# One-time setup script: python -m providers.reading.audible --setup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import getpass
    import sys

    parser = argparse.ArgumentParser(
        description="Audible one-time device registration for River Song AI."
    )
    parser.add_argument("--setup", action="store_true", required=True)
    parser.add_argument(
        "--user-id",
        default="primary_user",
        help="User ID to register (default: primary_user).",
    )
    parser.add_argument(
        "--auth-base",
        default=os.environ.get("AUDIBLE_AUTH_BASE_PATH", "data/audible"),
        help="Base directory for auth files.",
    )
    parser.add_argument(
        "--country",
        default=os.environ.get("AUDIBLE_COUNTRY_CODE", "us"),
        help="Audible marketplace country code (default: us).",
    )
    args = parser.parse_args()

    if not _AUDIBLE_AVAILABLE:
        print("Error: audible package not installed. Run: pip install audible")
        sys.exit(1)

    print(f"Audible setup -- user: {args.user_id}, marketplace: {args.country.upper()}")
    print(f"Auth will be saved to: {args.auth_base}/{args.user_id}.json")
    print()

    email = input("Audible email: ").strip()
    password = getpass.getpass("Audible password: ")

    provider = AudibleProvider(auth_base_path=args.auth_base, country_code=args.country)
    try:
        provider.setup_auth(args.user_id, email, password)
        print(f"\nSetup complete. Auth saved to {args.auth_base}/{args.user_id}.json")
    except Exception as exc:
        print(f"Setup failed: {exc}")
        sys.exit(1)
