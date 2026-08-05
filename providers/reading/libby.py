# =============================================================================
# providers/reading/libby.py
#
# Libby / OverDrive library interface for River Song AI.
#
# What it provides:
#   - Current loans (borrowed ebooks and audiobooks) with expiry dates
#   - Holds queue with position and estimated wait
#   - Reading progress for active loans
#
# Multi-user design:
#   Each user's chip (device token) is stored in a separate file under
#   LIBBY_CHIP_BASE_PATH:
#     data/libby/{user_id}.json
#   All public async methods take user_id. No state is shared between users.
#
# Authentication (Libby chip system):
#   Libby authenticates devices via a "chip" -- a UUID issued by OverDrive's
#   Sentry API. The chip is created once and linked to the user's Libby account
#   using an 8-digit code from the Libby app. After linking, the chip is the
#   bearer token for all API calls.
#
#   One-time setup per user:
#     python -m providers.reading.libby --setup --user-id primary_user
#
#   In the Libby app:
#     Settings (gear icon) -> Copy to Another Device -> This is the sending device
#     An 8-digit code appears. Enter it when the setup script asks.
#
# API notes:
#   Base: https://sentry.overdrive.com
#   All requests use Authorization: Bearer {chip_uuid}
#   The /account/sync endpoint returns the full account state in one call.
#
# Dependencies:
#   httpx>=0.27.0  (already in requirements.txt)
#
# Environment variables (via config/settings.py):
#   LIBBY_CHIP_BASE_PATH  -- Base directory for per-user chip files.
# =============================================================================

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List

import httpx

logger = logging.getLogger(__name__)

_SENTRY_BASE = "https://sentry.overdrive.com"

# Mimic the Libby Android app so the API accepts our requests.
_HEADERS = {
    "User-Agent": "Libby/10.0.0 Android/14",
    "X-Client-Platform": "android",
    "X-Client-Version": "10.0.0",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class LibbyLoan:
    title: str
    author: str
    format_id: str          # e.g. "ebook-epub-adobe", "audiobook-mp3"
    expires: str            # ISO 8601 timestamp
    days_remaining: int
    percent_complete: float  # 0.0-100.0; -1.0 if not available
    cover_url: str = ""


@dataclass
class LibbyHold:
    title: str
    author: str
    format_id: str
    queue_position: int     # 1-indexed position in the holds queue
    queue_size: int         # total holds on this title
    estimated_wait_days: int
    cover_url: str = ""


# ---------------------------------------------------------------------------
# Chip storage
# ---------------------------------------------------------------------------

def _chip_file_for(base: str, user_id: str) -> str:
    return os.path.join(base, f"{user_id}.json")


def _load_chip(base: str, user_id: str) -> str:
    path = _chip_file_for(base, user_id)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No Libby chip found for user '{user_id}' at '{path}'. "
            "Run: python -m providers.reading.libby --setup "
            f"--user-id {user_id}"
        )
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    chip = data.get("chip")
    if not chip:
        raise ValueError(
            f"Chip file at '{path}' is malformed -- missing 'chip' key.")
    return chip


def _save_chip(base: str, user_id: str, chip: str) -> None:
    os.makedirs(base, exist_ok=True)
    path = _chip_file_for(base, user_id)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"chip": chip, "user_id": user_id}, fh, indent=2)
    os.replace(tmp, path)
    logger.info("Libby chip saved for user '%s' at '%s'", user_id, path)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _days_until(iso_timestamp: str) -> int:
    """Return the number of full days until the given ISO 8601 timestamp."""
    try:
        expires = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        delta = expires - datetime.now(tz=timezone.utc)
        return max(int(delta.total_seconds() // 86_400), 0)
    except (ValueError, AttributeError):
        return -1


def _parse_loan(raw: dict) -> LibbyLoan:
    title_obj = raw.get("title") or {}
    title = (
        title_obj.get("text")
        if isinstance(title_obj, dict)
        else str(title_obj)
    ) or "Unknown"
    author = raw.get("firstCreatorName", "Unknown")
    formats = raw.get("formats") or [{}]
    format_id = formats[0].get("id", "") if formats else ""
    expires = raw.get("expires", "")
    days = _days_until(expires) if expires else -1
    mark = raw.get("readingMark") or {}
    percent = float(mark.get("percent", -1.0)) if mark else -1.0
    covers = raw.get("covers") or {}
    cover_url = covers.get(
        "cover150Wide",
        {}).get(
        "href",
        "") if covers else ""
    return LibbyLoan(
        title=title,
        author=author,
        format_id=format_id,
        expires=expires,
        days_remaining=days,
        percent_complete=percent,
        cover_url=cover_url,
    )


def _parse_hold(raw: dict) -> LibbyHold:
    title_obj = raw.get("title") or {}
    title = (
        title_obj.get("text")
        if isinstance(title_obj, dict)
        else str(title_obj)
    ) or "Unknown"
    author = raw.get("firstCreatorName", "Unknown")
    formats = raw.get("formats") or [{}]
    format_id = formats[0].get("id", "") if formats else ""
    queue_position = int(raw.get("holdsPosition", 0))
    queue_size = int(raw.get("holdsCount", 0))
    wait = int(raw.get("estimatedWaitDays", -1))
    covers = raw.get("covers") or {}
    cover_url = covers.get(
        "cover150Wide",
        {}).get(
        "href",
        "") if covers else ""
    return LibbyHold(
        title=title,
        author=author,
        format_id=format_id,
        queue_position=queue_position,
        queue_size=queue_size,
        estimated_wait_days=wait,
        cover_url=cover_url,
    )


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class LibbyProvider:
    """
    Interface to a user's Libby/OverDrive account.

    Pass user_id to each method. Chip files live at
    {chip_base}/{user_id}.json and are loaded on every call so a chip
    re-registration takes effect immediately without restarting the server.
    """

    def __init__(self, chip_base_path: str) -> None:
        self._chip_base = chip_base_path

    # ------------------------------------------------------------------
    # Internal API call
    # ------------------------------------------------------------------

    async def _sync(self, chip: str) -> Dict[str, Any]:
        """
        Call the Sentry /account/sync endpoint and return the raw payload.
        Raises httpx.HTTPStatusError on non-2xx responses.
        """
        headers = {**_HEADERS, "Authorization": f"Bearer {chip}"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{_SENTRY_BASE}/account/sync",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def get_loans(self, user_id: str) -> List[LibbyLoan]:
        """Return all active loans for *user_id*."""
        chip = _load_chip(self._chip_base, user_id)
        try:
            data = await self._sync(chip)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise PermissionError(
                    f"Libby chip for '{user_id}' is invalid or expired. "
                    "Re-run setup: python -m providers.reading.libby --setup "
                    f"--user-id {user_id}"
                ) from exc
            raise
        return [_parse_loan(item) for item in data.get("loans", [])]

    async def get_holds(self, user_id: str) -> List[LibbyHold]:
        """Return all holds for *user_id*."""
        chip = _load_chip(self._chip_base, user_id)
        try:
            data = await self._sync(chip)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise PermissionError(
                    f"Libby chip for '{user_id}' is invalid or expired. "
                    "Re-run setup: python -m providers.reading.libby --setup "
                    f"--user-id {user_id}"
                ) from exc
            raise
        return [_parse_hold(item) for item in data.get("holds", [])]

    # ------------------------------------------------------------------
    # Speech formatting
    # ------------------------------------------------------------------

    @staticmethod
    def format_loans_for_speech(loans: List[LibbyLoan]) -> str:
        if not loans:
            return "You have no active loans from the library right now."
        lines = []
        for i, loan in enumerate(loans[:5], 1):
            author = loan.author
            due = (
                f"due in {
                    loan.days_remaining} day{
                    's' if loan.days_remaining != 1 else ''}"
                if loan.days_remaining >= 0
                else "expiry unknown"
            )
            progress = (
                f", {loan.percent_complete:.0f}% read"
                if loan.percent_complete >= 0
                else ""
            )
            lines.append(f"{i}. {loan.title} by {author}{progress}, {due}.")
        suffix = (
            f" And {len(loans) - 5} more."
            if len(loans) > 5
            else ""
        )
        return "Your library loans: " + " ".join(lines) + suffix

    @staticmethod
    def format_holds_for_speech(holds: List[LibbyHold]) -> str:
        if not holds:
            return "You have no holds at the library right now."
        lines = []
        for i, hold in enumerate(holds[:5], 1):
            position = (
                f"number {hold.queue_position} in line"
                if hold.queue_position > 0
                else "position unknown"
            )
            wait = (
                f", about {
                    hold.estimated_wait_days} day{
                    's' if hold.estimated_wait_days != 1 else ''} wait"
                if hold.estimated_wait_days >= 0
                else ""
            )
            lines.append(
                f"{i}. {
                    hold.title} by {
                    hold.author}, {position}{wait}.")
        suffix = (
            f" And {len(holds) - 5} more."
            if len(holds) > 5
            else ""
        )
        return "Your library holds: " + " ".join(lines) + suffix


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_libby_provider(settings=None) -> LibbyProvider:
    if settings is None:
        from config.settings import get_settings
        settings = get_settings()
    return LibbyProvider(chip_base_path=settings.libby_chip_base_path)


# ---------------------------------------------------------------------------
# One-time setup script: python -m providers.reading.libby --setup
# ---------------------------------------------------------------------------

async def _register_chip(user_id: str, chip_base: str) -> None:
    """Create a new Libby chip and link it to the user's account via setup code."""
    headers = {**_HEADERS}

    async with httpx.AsyncClient(timeout=20.0) as client:
        # Step 1: Create a new chip (device identity).
        resp = await client.post(
            f"{_SENTRY_BASE}/chip",
            headers=headers,
            json={},
        )
        resp.raise_for_status()
        data = resp.json()
        chip = (
            data.get("identity", {}).get("chip")
            or data.get("chip")
        )
        if not chip:
            raise RuntimeError(
                f"Chip creation response did not include a chip UUID. "
                f"Response: {data}"
            )

        print(f"\nNew chip created: {chip}")
        print(
            "\nIn the Libby app on your phone or tablet:\n"
            "  Settings (gear icon) -> Copy to Another Device\n"
            "  -> 'This is the sending device'\n"
            "  An 8-digit code will appear.\n"
        )
        code = input(
            "Enter the 8-digit code from Libby: ").strip().replace(" ", "")
        if not code.isdigit() or len(code) != 8:
            raise ValueError(f"Expected an 8-digit number, got: '{code}'")

        # Step 2: Clone the chip to link it to the existing Libby account.
        auth_headers = {**headers, "Authorization": f"Bearer {chip}"}
        clone_resp = await client.put(
            f"{_SENTRY_BASE}/chip/clone",
            headers=auth_headers,
            json={"code": code},
        )
        clone_resp.raise_for_status()

    _save_chip(chip_base, user_id, chip)
    print(
        f"\nSetup complete. Chip saved to {
            _chip_file_for(
                chip_base,
                user_id)}")


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Libby one-time chip registration for River Song AI."
    )
    parser.add_argument("--setup", action="store_true", required=True)
    parser.add_argument(
        "--user-id",
        default="primary_user",
        help="User ID to register (default: primary_user).",
    )
    parser.add_argument(
        "--chip-base",
        default=os.environ.get("LIBBY_CHIP_BASE_PATH", "data/libby"),
        help="Base directory for chip files.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(_register_chip(args.user_id, args.chip_base))
    except (KeyboardInterrupt, EOFError):
        print("\nSetup cancelled.")
        sys.exit(1)
    except Exception as exc:
        print(f"\nSetup failed: {exc}")
        sys.exit(1)
