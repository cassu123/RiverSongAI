# =============================================================================
# providers/google/books.py
#
# Google Play Books library sync for River Song AI.
#
# Uses the Google Books API v1 with OAuth 2.0 credentials that have the
# https://www.googleapis.com/auth/books scope.  The token is stored
# separately from the main Google auth token (which only has openid/profile)
# because Books requires an additional consent step.
#
# Token storage: data/google_tokens/books_{user_id}.json
# =============================================================================

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

_BOOKS_API = "https://www.googleapis.com/books/v1"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_BOOKS_SCOPE = "https://www.googleapis.com/auth/books"

# Maps Google Books API reading positions to our statuses
_STATUS_MAP = {
    "HAVE_IT": "want_to_read",
    "READING": "reading",
    "READ": "finished",
}


@dataclass
class GoogleBook:
    title: str
    authors: List[str]
    cover_url: str
    status: str          # reading | finished | want_to_read
    progress_pct: float
    rating: Optional[int]
    volume_id: str
    info_link: str


def _token_path(user_id: str, base: str) -> str:
    return os.path.join(base, f"books_{user_id}.json")


def _load_token(user_id: str, base: str) -> Optional[dict]:
    path = _token_path(user_id, base)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_token(user_id: str, base: str, token_data: dict) -> None:
    os.makedirs(base, exist_ok=True)
    path = _token_path(user_id, base)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)
    os.replace(tmp, path)


async def _refresh_if_needed(token_data: dict, client_id: str, client_secret: str) -> dict:
    """Refresh the access token if expired. Returns updated token_data."""
    import time
    expires_at = token_data.get("expires_at", 0)
    if expires_at and time.time() < expires_at - 60:
        return token_data  # still valid

    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise PermissionError("Books token has no refresh_token — re-authorize.")

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_TOKEN_URI, data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        })
        resp.raise_for_status()
        new_tokens = resp.json()

    import time as _time
    token_data = {
        **token_data,
        "access_token": new_tokens["access_token"],
        "expires_at": _time.time() + new_tokens.get("expires_in", 3600),
    }
    # Google may return a new refresh_token on each refresh
    if "refresh_token" in new_tokens:
        token_data["refresh_token"] = new_tokens["refresh_token"]
    return token_data


class GoogleBooksProvider:
    def __init__(self, client_id: str, client_secret: str, token_storage_path: str):
        self._client_id     = client_id
        self._client_secret = client_secret
        self._storage       = token_storage_path

    def is_connected(self, user_id: str) -> bool:
        return _load_token(user_id, self._storage) is not None

    def save_token_from_callback(self, user_id: str, token_resp: dict) -> None:
        """Called after the OAuth callback exchanges code for tokens."""
        import time
        data = {
            "access_token":  token_resp["access_token"],
            "refresh_token": token_resp.get("refresh_token", ""),
            "expires_at":    time.time() + token_resp.get("expires_in", 3600),
            "scope":         token_resp.get("scope", _BOOKS_SCOPE),
        }
        _save_token(user_id, self._storage, data)

    def disconnect(self, user_id: str) -> None:
        path = _token_path(user_id, self._storage)
        if os.path.exists(path):
            os.remove(path)

    async def get_library(self, user_id: str) -> List[GoogleBook]:
        """Fetch all bookshelves and return a flat list of GoogleBook objects."""
        token_data = _load_token(user_id, self._storage)
        if not token_data:
            raise FileNotFoundError(f"No Books token for user '{user_id}'.")

        token_data = await _refresh_if_needed(token_data, self._client_id, self._client_secret)
        _save_token(user_id, self._storage, token_data)

        access_token = token_data["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        books: List[GoogleBook] = []
        seen_ids: set[str] = set()

        # Shelf IDs that have meaningful reading state:
        # 2=to-read, 3=reading-now, 4=have-read, 7=my-google-books, 0=favorites
        target_shelves = {
            2: "want_to_read",
            3: "reading",
            4: "finished",
        }

        async with httpx.AsyncClient(timeout=30, headers=headers) as client:
            for shelf_id, status in target_shelves.items():
                start_index = 0
                while True:
                    resp = await client.get(
                        f"{_BOOKS_API}/mylibrary/bookshelves/{shelf_id}/volumes",
                        params={"maxResults": 40, "startIndex": start_index, "projection": "full"},
                    )
                    if resp.status_code == 401:
                        raise PermissionError("Books access token rejected — re-authorize.")
                    if resp.status_code == 403:
                        raise PermissionError("Books API access denied. Make sure the Books API is enabled in your Google Cloud project.")
                    resp.raise_for_status()
                    data = resp.json()

                    items = data.get("items", [])
                    if not items:
                        break

                    for item in items:
                        vid = item.get("id", "")
                        if vid in seen_ids:
                            continue
                        seen_ids.add(vid)

                        info     = item.get("volumeInfo", {})
                        user_info = item.get("userInfo", {})
                        reading_pos = item.get("volumeInfo", {})

                        title   = info.get("title", "").strip()
                        if not title:
                            continue

                        authors = info.get("authors", [])

                        # Cover: prefer "extraLarge", fallback down
                        image_links = info.get("imageLinks", {})
                        cover = (
                            image_links.get("extraLarge")
                            or image_links.get("large")
                            or image_links.get("medium")
                            or image_links.get("thumbnail")
                            or ""
                        )
                        # Force HTTPS (Google returns http)
                        if cover.startswith("http://"):
                            cover = "https://" + cover[7:]

                        # Reading progress
                        progress_pct = 0.0
                        rpos = user_info.get("readingPosition")
                        if rpos:
                            pct_raw = rpos.get("percentRead")
                            if pct_raw is not None:
                                try:
                                    progress_pct = float(pct_raw)
                                except (TypeError, ValueError):
                                    pass

                        # Rating (Google stores 0-5, we keep 1-5 or None)
                        rating = None
                        raw_rating = user_info.get("rating")
                        if raw_rating:
                            try:
                                r = int(float(raw_rating))
                                if 1 <= r <= 5:
                                    rating = r
                            except (TypeError, ValueError):
                                pass

                        info_link = info.get("canonicalVolumeLink") or info.get("infoLink") or ""

                        books.append(GoogleBook(
                            title=title,
                            authors=authors,
                            cover_url=cover,
                            status=status,
                            progress_pct=progress_pct,
                            rating=rating,
                            volume_id=vid,
                            info_link=info_link,
                        ))

                    total = data.get("totalItems", 0)
                    start_index += len(items)
                    if start_index >= total:
                        break

        logger.info("Google Books: fetched %d books for user '%s'", len(books), user_id)
        return books


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_provider: Optional[GoogleBooksProvider] = None


def get_books_provider() -> GoogleBooksProvider:
    global _provider
    if _provider is None:
        from config.settings import get_settings
        s = get_settings()
        try:
            import json as _json
            from pathlib import Path
            secrets_path = Path(s.google_client_secrets_path)
            if not secrets_path.exists():
                raise FileNotFoundError(f"Google client secrets not found: {secrets_path}")
            secrets = _json.loads(secrets_path.read_text())
            client = secrets.get("web") or secrets.get("installed") or {}
            _provider = GoogleBooksProvider(
                client_id=client["client_id"],
                client_secret=client["client_secret"],
                token_storage_path=s.google_token_storage_path,
            )
        except Exception as exc:
            raise RuntimeError(f"Could not initialise Google Books provider: {exc}") from exc
    return _provider
