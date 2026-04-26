"""
api/routes/reading.py

Reading hub endpoints.

GET    /api/reading/shelf                    -- list shelf (optional ?service= &status=)
POST   /api/reading/shelf                    -- add a book
PATCH  /api/reading/shelf/{book_id}          -- update a book
DELETE /api/reading/shelf/{book_id}          -- remove a book
GET    /api/reading/stats                    -- shelf summary counts
GET    /api/reading/connections              -- which services are connected for this user
GET    /api/reading/libby/loans              -- live Libby loans
GET    /api/reading/libby/holds              -- live Libby holds
POST   /api/reading/connect/libby/start     -- create chip, return pairing instructions
POST   /api/reading/connect/libby/complete  -- clone chip with 8-digit Libby code
DELETE /api/reading/connect/libby           -- disconnect Libby (delete chip file)
POST   /api/reading/connect/audible         -- register Audible device (email + password)
DELETE /api/reading/connect/audible         -- disconnect Audible (delete auth file)
POST   /api/reading/sync/kindle             -- fetch Kindle library → add to shelf
POST   /api/reading/import/csv              -- import CSV (Goodreads / Kobo / Play Books)
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import uuid
from typing import Optional

import httpx
from fastapi import File, Form, UploadFile
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.auth import decode_token
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reading", tags=["reading"])

VALID_SERVICES = {"kindle", "google_play", "audible", "libby", "kobo", "apple_books", "other"}
VALID_STATUSES = {"reading", "finished", "want_to_read", "dnf"}

# Module-level provider singleton — built once, reused across requests
_libby_provider = None


def _get_libby():
    global _libby_provider
    if _libby_provider is None:
        from providers.reading.libby import build_libby_provider
        _libby_provider = build_libby_provider()
    return _libby_provider


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503, detail="Memory manager not available.")
    return mm._store


def _serialize_book(book: dict) -> dict:
    """Strip internal fields before sending to client."""
    return {k: v for k, v in book.items() if k != "user_id"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class BookCreate(BaseModel):
    service: str
    title: str
    author: str = ""
    cover_url: str = ""
    progress_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    status: str = "reading"
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: str = ""
    launch_url: str = ""


class BookUpdate(BaseModel):
    service: Optional[str] = None
    title: Optional[str] = None
    author: Optional[str] = None
    cover_url: Optional[str] = None
    progress_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    status: Optional[str] = None
    # Use -1 as sentinel to explicitly clear a rating
    rating: Optional[int] = Field(default=None, ge=-1, le=5)
    notes: Optional[str] = None
    launch_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Shelf endpoints
# ---------------------------------------------------------------------------

@router.get("/shelf")
async def list_shelf(
    request: Request,
    service: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)

    if service and service not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail=f"Invalid service filter.")
    if status and status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status filter.")

    store = _store(request)
    books = await store.list_shelf(user_id, service=service, status=status)
    return [_serialize_book(b) for b in books]


@router.get("/stats")
async def shelf_stats(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Return per-status and per-service counts without sending all book data."""
    user_id = _require_user(authorization)
    store = _store(request)
    books = await store.list_shelf(user_id)

    status_counts = {s: 0 for s in VALID_STATUSES}
    service_counts = {s: 0 for s in VALID_SERVICES}

    for b in books:
        st = b.get("status", "")
        sv = b.get("service", "")
        if st in status_counts:
            status_counts[st] += 1
        if sv in service_counts:
            service_counts[sv] += 1

    return {
        "total": len(books),
        "by_status": status_counts,
        "by_service": service_counts,
    }


@router.post("/shelf", status_code=201)
async def add_book(
    body: BookCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)

    if body.service not in VALID_SERVICES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid service. Must be one of: {', '.join(sorted(VALID_SERVICES))}"
        )
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}"
        )

    store = _store(request)
    book = await store.create_book({
        "user_id":      user_id,
        "service":      body.service,
        "title":        body.title.strip(),
        "author":       body.author.strip(),
        "cover_url":    body.cover_url.strip(),
        "progress_pct": body.progress_pct,
        "status":       body.status,
        "rating":       body.rating,
        "notes":        body.notes.strip(),
        "launch_url":   body.launch_url.strip(),
    })
    return _serialize_book(book)


@router.patch("/shelf/{book_id}")
async def update_book(
    book_id: str,
    body: BookUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)

    fields = body.model_dump(exclude_unset=True)

    if "service" in fields and fields["service"] not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail="Invalid service.")
    if "status" in fields and fields["status"] not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status.")

    # Sentinel: rating=-1 means clear the rating
    if fields.get("rating") == -1:
        fields["rating"] = None

    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")

    store = _store(request)
    book = await store.update_book(book_id, user_id, fields)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found.")
    return _serialize_book(book)


@router.delete("/shelf/{book_id}", status_code=204)
async def delete_book(
    book_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    deleted = await store.delete_book(book_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Book not found.")


# ---------------------------------------------------------------------------
# Libby live endpoints
# ---------------------------------------------------------------------------

@router.get("/libby/loans")
async def libby_loans(
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    try:
        provider = _get_libby()
        loans = await provider.get_loans(user_id)
        return [
            {
                "title":            l.title,
                "author":           l.author,
                "format_id":        l.format_id,
                "expires":          l.expires,
                "days_remaining":   l.days_remaining,
                "percent_complete": l.percent_complete,
                "cover_url":        l.cover_url,
            }
            for l in loans
        ]
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Libby not set up. Run: python -m providers.reading.libby --setup"
        )
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        logger.error("Libby loans fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby. Check your connection.")


@router.get("/libby/holds")
async def libby_holds(
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    try:
        provider = _get_libby()
        holds = await provider.get_holds(user_id)
        return [
            {
                "title":               h.title,
                "author":              h.author,
                "format_id":           h.format_id,
                "queue_position":      h.queue_position,
                "queue_size":          h.queue_size,
                "estimated_wait_days": h.estimated_wait_days,
                "cover_url":           h.cover_url,
            }
            for h in holds
        ]
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Libby not set up. Run: python -m providers.reading.libby --setup"
        )
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        logger.error("Libby holds fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby. Check your connection.")


# ---------------------------------------------------------------------------
# Connection status
# ---------------------------------------------------------------------------

def _libby_chip_path(user_id: str) -> str:
    settings = get_settings()
    return os.path.join(settings.libby_chip_base_path, f"{user_id}.json")


def _audible_auth_path(user_id: str) -> str:
    settings = get_settings()
    return os.path.join(settings.audible_auth_base_path, f"{user_id}.json")


@router.get("/connections")
async def get_connections(
    authorization: Optional[str] = Header(default=None),
):
    """Return which services are linked for this user."""
    user_id = _require_user(authorization)
    audible_connected = os.path.exists(_audible_auth_path(user_id))
    return {
        "libby":   os.path.exists(_libby_chip_path(user_id)),
        "audible": audible_connected,
        # Kindle shares the Audible auth file (same Amazon account)
        "kindle":  audible_connected,
    }


# ---------------------------------------------------------------------------
# Libby connect / disconnect
# ---------------------------------------------------------------------------

_SENTRY_BASE = "https://sentry.overdrive.com"
_LIBBY_HEADERS = {
    "User-Agent": "Libby/10.0.0 Android/14",
    "X-Client-Platform": "android",
    "X-Client-Version": "10.0.0",
    "Accept": "application/json",
    "Content-Type": "application/json",
}

# In-progress chips keyed by (user_id, chip_uuid) — cleared on complete or expiry
_pending_chips: dict[str, str] = {}


@router.post("/connect/libby/start")
async def libby_connect_start(
    authorization: Optional[str] = Header(default=None),
):
    """
    Step 1 of Libby pairing.  Creates a new chip UUID on OverDrive's Sentry API
    and returns it alongside pairing instructions.  The chip is stored in memory
    until /complete is called.
    """
    user_id = _require_user(authorization)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{_SENTRY_BASE}/chip", headers=_LIBBY_HEADERS, json={})
            resp.raise_for_status()
            data = resp.json()
        chip = (
            data.get("identity", {}).get("chip")
            or data.get("chip")
        )
        if not chip:
            raise ValueError(f"Sentry response missing chip UUID: {data}")
    except Exception as exc:
        logger.error("Libby chip creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby. Check your internet connection.")

    _pending_chips[user_id] = chip
    return {
        "chip": chip,
        "instructions": (
            "Open the Libby app → tap the person icon → "
            "Manage Cards → Add a Library Card — OR — "
            "Settings (gear icon) → Copy to Another Device → "
            "'This is the sending device'. "
            "An 8-digit code will appear. Enter it below."
        ),
    }


class LibbyCompleteBody(BaseModel):
    code: str


@router.post("/connect/libby/complete")
async def libby_connect_complete(
    body: LibbyCompleteBody,
    authorization: Optional[str] = Header(default=None),
):
    """Step 2: clone the pending chip using the 8-digit code from the Libby app."""
    user_id = _require_user(authorization)
    chip = _pending_chips.get(user_id)
    if not chip:
        raise HTTPException(
            status_code=400,
            detail="No pending Libby pairing found. Start the flow again."
        )

    code = body.code.strip().replace(" ", "").replace("-", "")
    if not code.isdigit() or len(code) != 8:
        raise HTTPException(status_code=422, detail="Code must be exactly 8 digits.")

    try:
        auth_headers = {**_LIBBY_HEADERS, "Authorization": f"Bearer {chip}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.put(
                f"{_SENTRY_BASE}/chip/clone",
                headers=auth_headers,
                json={"code": code},
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (400, 401, 403):
            raise HTTPException(status_code=422, detail="Invalid or expired code. Check the code and try again.")
        logger.error("Libby chip clone failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby.")
    except Exception as exc:
        logger.error("Libby chip clone error: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby.")

    # Save chip file
    settings = get_settings()
    chip_dir = settings.libby_chip_base_path
    os.makedirs(chip_dir, exist_ok=True)
    chip_path = _libby_chip_path(user_id)
    tmp = chip_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"chip": chip, "user_id": user_id}, fh, indent=2)
    os.replace(tmp, chip_path)

    _pending_chips.pop(user_id, None)
    logger.info("Libby chip saved for user '%s'", user_id)
    return {"connected": True}


@router.delete("/connect/libby", status_code=204)
async def libby_disconnect(
    authorization: Optional[str] = Header(default=None),
):
    """Remove the stored Libby chip for this user."""
    user_id = _require_user(authorization)
    path = _libby_chip_path(user_id)
    if os.path.exists(path):
        os.remove(path)
    _pending_chips.pop(user_id, None)


# ---------------------------------------------------------------------------
# Audible connect / disconnect
# ---------------------------------------------------------------------------

class AudibleConnectBody(BaseModel):
    email: str
    password: str
    country_code: str = "us"


@router.post("/connect/audible")
async def audible_connect(
    body: AudibleConnectBody,
    authorization: Optional[str] = Header(default=None),
):
    """Register River Song as an Audible device using the user's Amazon credentials."""
    user_id = _require_user(authorization)

    try:
        import audible  # noqa: PLC0415
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="audible package not installed on this server. Run: pip install audible"
        )

    import asyncio

    def _do_login():
        auth = audible.Authenticator.from_login(
            username=body.email,
            password=body.password,
            locale=body.country_code.lower(),
            with_username=False,
        )
        settings = get_settings()
        auth_dir = settings.audible_auth_base_path
        os.makedirs(auth_dir, exist_ok=True)
        auth.to_file(_audible_auth_path(user_id))

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _do_login)
    except Exception as exc:
        err = str(exc).lower()
        if "captcha" in err:
            raise HTTPException(
                status_code=422,
                detail="Amazon requires a CAPTCHA for this login. Try again later or use a different network."
            )
        if "otp" in err or "2-step" in err or "two-step" in err:
            raise HTTPException(
                status_code=422,
                detail="Your Amazon account has 2-step verification enabled. Disable it temporarily for setup, then re-enable it."
            )
        logger.error("Audible login failed for user '%s': %s", user_id, exc)
        raise HTTPException(status_code=401, detail=f"Login failed: {exc}")

    logger.info("Audible auth saved for user '%s'", user_id)
    return {"connected": True}


@router.delete("/connect/audible", status_code=204)
async def audible_disconnect(
    authorization: Optional[str] = Header(default=None),
):
    """Remove the stored Audible auth for this user."""
    user_id = _require_user(authorization)
    path = _audible_auth_path(user_id)
    if os.path.exists(path):
        os.remove(path)


# ---------------------------------------------------------------------------
# Kindle sync  (reuses Audible auth — same Amazon account)
# ---------------------------------------------------------------------------

_kindle_provider = None


def _get_kindle():
    global _kindle_provider
    if _kindle_provider is None:
        from providers.reading.kindle import build_kindle_provider
        _kindle_provider = build_kindle_provider()
    return _kindle_provider


@router.post("/sync/kindle")
async def sync_kindle(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Fetch the user's Kindle library and upsert books into the shelf.
    Returns counts of added vs already-present books.
    """
    user_id = _require_user(authorization)
    try:
        provider = _get_kindle()
        books = await provider.get_library(user_id, limit=100)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Kindle not set up. Connect your Audible/Amazon account first."
        )
    except Exception as exc:
        logger.error("Kindle sync failed for '%s': %s", user_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not reach the Kindle library: {exc}")

    store = _store(request)
    existing = await store.list_shelf(user_id, service="kindle")
    existing_titles = {b["title"].lower() for b in existing}

    added = 0
    skipped = 0
    for book in books:
        if book.is_sample:
            continue
        if book.title.lower() in existing_titles:
            skipped += 1
            continue
        author = book.authors[0] if book.authors else ""
        launch_url = f"https://read.amazon.com/?asin={book.asin}" if book.asin else ""
        await store.create_book({
            "user_id":      user_id,
            "service":      "kindle",
            "title":        book.title,
            "author":       author,
            "cover_url":    book.cover_url,
            "progress_pct": max(book.percent_complete, 0) if book.percent_complete >= 0 else 0,
            "status":       "reading" if book.percent_complete > 0 else "want_to_read",
            "rating":       None,
            "notes":        "",
            "launch_url":   launch_url,
        })
        added += 1

    return {"added": added, "skipped": skipped, "total": len(books)}


# ---------------------------------------------------------------------------
# CSV import  (Goodreads / Kobo / Google Play Takeout)
# ---------------------------------------------------------------------------

# Goodreads CSV columns that matter:
#   Title, Author, Additional Authors, My Rating, Average Rating, Publisher,
#   Number of Pages, Year Published, Original Publication Year, Date Read,
#   Date Added, Bookshelves, Exclusive Shelf, My Review, Spoiler, Private Notes,
#   Read Count, Owned Copies
#
# Google Play Books Takeout CSV:
#   Title, Authors, ISBN, Publisher, Published Date, Added Date,
#   Reading Status, Progress (%), Rating

_CSV_SERVICE_LABELS = {
    "goodreads":    "goodreads",
    "kobo":         "kobo",
    "google_play":  "google_play",
    "apple_books":  "apple_books",
    "other":        "other",
}

_GOODREADS_STATUS_MAP = {
    "read":              "finished",
    "currently-reading": "reading",
    "to-read":           "want_to_read",
    "did-not-finish":    "dnf",
}

_PLAY_STATUS_MAP = {
    "HAVE_READ":        "finished",
    "READING":          "reading",
    "WANT_TO_READ":     "want_to_read",
    "DNF":              "dnf",
}


def _parse_goodreads_row(row: dict) -> Optional[dict]:
    title = (row.get("Title") or "").strip()
    if not title:
        return None
    author = (row.get("Author") or row.get("Author l-f") or "").strip()
    rating_raw = (row.get("My Rating") or "").strip()
    try:
        rating = int(rating_raw) if rating_raw and rating_raw != "0" else None
    except ValueError:
        rating = None
    shelf = (row.get("Exclusive Shelf") or "").strip().lower()
    status = _GOODREADS_STATUS_MAP.get(shelf, "want_to_read")
    return {"title": title, "author": author, "rating": rating, "status": status, "cover_url": "", "notes": "", "launch_url": ""}


def _parse_play_books_row(row: dict) -> Optional[dict]:
    title = (row.get("Title") or "").strip()
    if not title:
        return None
    author = (row.get("Authors") or "").strip()
    raw_status = (row.get("Reading Status") or "").strip().upper()
    status = _PLAY_STATUS_MAP.get(raw_status, "want_to_read")
    progress_raw = (row.get("Progress (%)") or row.get("Progress") or "").strip().rstrip("%")
    try:
        progress = float(progress_raw)
    except ValueError:
        progress = 0.0
    rating_raw = (row.get("Rating") or "").strip()
    try:
        rating = int(float(rating_raw)) if rating_raw else None
    except ValueError:
        rating = None
    return {"title": title, "author": author, "rating": rating, "status": status, "progress_pct": progress, "cover_url": "", "notes": "", "launch_url": ""}


def _detect_format(headers: list[str]) -> str:
    """Guess CSV format from column headers."""
    h = {c.strip().lower() for c in headers}
    if "exclusive shelf" in h or "bookshelves" in h:
        return "goodreads"
    if "reading status" in h and "progress (%)" in h:
        return "google_play"
    return "generic"


def _parse_generic_row(row: dict, service: str) -> Optional[dict]:
    """Best-effort parse for unknown CSV formats."""
    title = next((row[k].strip() for k in row if "title" in k.lower() and row[k].strip()), None)
    if not title:
        return None
    author = next((row[k].strip() for k in row if "author" in k.lower() and row[k].strip()), "")
    return {"title": title, "author": author, "rating": None, "status": "want_to_read", "cover_url": "", "notes": "", "launch_url": ""}


@router.post("/import/csv")
async def import_csv(
    request: Request,
    file: UploadFile = File(...),
    service: str = Form(default="other"),
    authorization: Optional[str] = Header(default=None),
):
    """
    Import books from a CSV export (Goodreads, Google Play Takeout, or generic).
    Duplicate titles (already on the shelf for this service) are skipped.
    """
    user_id = _require_user(authorization)
    mapped_service = service if service in VALID_SERVICES else "other"

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")   # handle BOM from Excel/macOS exports
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=422, detail="CSV file is empty or has no data rows.")

    fmt = _detect_format(reader.fieldnames or [])
    store = _store(request)
    existing = await store.list_shelf(user_id, service=mapped_service)
    existing_titles = {b["title"].lower() for b in existing}

    added = skipped = errors = 0
    for row in rows:
        try:
            if fmt == "goodreads":
                parsed = _parse_goodreads_row(row)
            elif fmt == "google_play":
                parsed = _parse_play_books_row(row)
            else:
                parsed = _parse_generic_row(row, mapped_service)

            if not parsed:
                continue
            if parsed["title"].lower() in existing_titles:
                skipped += 1
                continue

            await store.create_book({
                "user_id":      user_id,
                "service":      mapped_service,
                "title":        parsed["title"],
                "author":       parsed.get("author", ""),
                "cover_url":    parsed.get("cover_url", ""),
                "progress_pct": parsed.get("progress_pct", 0.0),
                "status":       parsed.get("status", "want_to_read"),
                "rating":       parsed.get("rating"),
                "notes":        parsed.get("notes", ""),
                "launch_url":   parsed.get("launch_url", ""),
            })
            added += 1
        except Exception as exc:
            logger.warning("CSV import row error: %s", exc)
            errors += 1

    return {"added": added, "skipped": skipped, "errors": errors, "format_detected": fmt}
