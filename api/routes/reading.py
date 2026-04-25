"""
api/routes/reading.py

Reading hub endpoints.

GET    /api/reading/shelf              -- list user's manual shelf
POST   /api/reading/shelf              -- add a book
PATCH  /api/reading/shelf/{book_id}    -- update a book (progress, status, etc.)
DELETE /api/reading/shelf/{book_id}    -- remove a book

GET    /api/reading/libby/loans        -- live Libby loans
GET    /api/reading/libby/holds        -- live Libby holds
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.auth import decode_token
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reading", tags=["reading"])

VALID_SERVICES = {"kindle", "google_play", "audible", "libby", "kobo", "apple_books", "other"}
VALID_STATUSES = {"reading", "finished", "want_to_read", "dnf"}


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
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None
    launch_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Shelf endpoints
# ---------------------------------------------------------------------------

@router.get("/shelf")
async def list_shelf(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    return await store.list_shelf(user_id)


@router.post("/shelf", status_code=201)
async def add_book(
    body: BookCreate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)

    if body.service not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail=f"Invalid service. Must be one of: {', '.join(sorted(VALID_SERVICES))}")
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}")

    store = _store(request)
    book = await store.create_book({
        "user_id":      user_id,
        "service":      body.service,
        "title":        body.title,
        "author":       body.author,
        "cover_url":    body.cover_url,
        "progress_pct": body.progress_pct,
        "status":       body.status,
        "rating":       body.rating,
        "notes":        body.notes,
        "launch_url":   body.launch_url,
    })
    return book


@router.patch("/shelf/{book_id}")
async def update_book(
    book_id: str,
    body: BookUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)

    fields = {k: v for k, v in body.model_dump().items() if v is not None}

    if "service" in fields and fields["service"] not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail=f"Invalid service.")
    if "status" in fields and fields["status"] not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status.")

    store = _store(request)
    book = await store.update_book(book_id, user_id, fields)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found.")
    return book


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
    settings = get_settings()

    try:
        from providers.reading.libby import build_libby_provider
        provider = build_libby_provider(settings)
        loans = await provider.get_loans(user_id)
        return [
            {
                "title":           l.title,
                "author":          l.author,
                "format_id":       l.format_id,
                "expires":         l.expires,
                "days_remaining":  l.days_remaining,
                "percent_complete": l.percent_complete,
                "cover_url":       l.cover_url,
            }
            for l in loans
        ]
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Libby not set up for this account. Run: python -m providers.reading.libby --setup"
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
    settings = get_settings()

    try:
        from providers.reading.libby import build_libby_provider
        provider = build_libby_provider(settings)
        holds = await provider.get_holds(user_id)
        return [
            {
                "title":                h.title,
                "author":               h.author,
                "format_id":            h.format_id,
                "queue_position":       h.queue_position,
                "queue_size":           h.queue_size,
                "estimated_wait_days":  h.estimated_wait_days,
                "cover_url":            h.cover_url,
            }
            for h in holds
        ]
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Libby not set up for this account. Run: python -m providers.reading.libby --setup"
        )
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        logger.error("Libby holds fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Libby. Check your connection.")
