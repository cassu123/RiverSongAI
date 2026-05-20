"""
api/routes/google.py

Endpoints for Google Service Integration (Calendar, Gmail, etc.).
This is separate from Google Authentication (Login).
"""

from __future__ import annotations

import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from providers.google.auth import GoogleAuth
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/google", tags=["google"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _get_google_auth() -> GoogleAuth:
    settings = get_settings()
    return GoogleAuth(
        client_secrets_path=settings.google_client_secrets_path,
        token_storage_path=settings.google_token_storage_path,
    )


# ---------------------------------------------------------------------------
# Auth Flow
# ---------------------------------------------------------------------------

@router.get("/auth/url")
async def get_auth_url(
    redirect_uri: str = Query(...),
    authorization: Optional[str] = Header(default=None),
):
    """
    Generate the Google OAuth authorization URL for the web flow.
    We pass the user_id in the 'state' parameter to correlate the callback.
    """
    user_id = await _require_user(authorization)
    auth = _get_google_auth()
    # We use state to pass the user_id securely through the flow
    auth_url = auth.get_authorization_url(redirect_uri=redirect_uri, state=user_id)
    return {"auth_url": auth_url}


@router.get("/auth/callback")
async def auth_callback(
    code: str = Query(...),
    state: str = Query(...),  # state contains our user_id
    redirect_uri: str = Query(...),
):
    """
    Exchange the authorization code for tokens and save them.
    """
    user_id = state
    auth = _get_google_auth()
    try:
        auth.fetch_token_from_code(user_id=user_id, code=code, redirect_uri=redirect_uri)
        # Redirect back to the frontend Google page
        return RedirectResponse(url="/google")
    except Exception as exc:
        logger.error("Google auth callback failed for user %s: %s", user_id, exc)
        # On error, we might want to redirect with an error param
        return RedirectResponse(url=f"/google?error={exc}")


@router.get("/status")
async def get_status(
    authorization: Optional[str] = Header(default=None),
):
    """
    Check if the user has a valid Google token stored.
    """
    user_id = await _require_user(authorization)
    auth = _get_google_auth()
    try:
        creds = auth.get_credentials(user_id)
        # Attempt to get the email from the token if possible
        # credentials objects from from_authorized_user_info don't always have email
        # but we can try to find it in the stored file or just return True
        return {
            "connected": True,
            "expired": creds.expired,
            "scopes": creds.scopes,
        }
    except Exception:
        return {"connected": False}


@router.delete("/auth")
async def disconnect_google(
    authorization: Optional[str] = Header(default=None),
):
    """
    Delete the user's stored Google tokens.
    """
    user_id = await _require_user(authorization)
    auth = _get_google_auth()
    deleted = auth.delete_credentials(user_id)
    return {"ok": True, "deleted": deleted}


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

@router.get("/calendar/upcoming")
async def get_calendar_upcoming(
    days: int = 7,
    max_results: int = 10,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.google.calendar import GoogleCalendarProvider
    auth = _get_google_auth()
    provider = GoogleCalendarProvider(auth, user_id)
    try:
        events = await provider.get_upcoming_events(days_ahead=days, max_results=max_results)
        return {"events": events}
    except Exception as exc:
        logger.error("Failed to fetch calendar for %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Gmail
# ---------------------------------------------------------------------------

@router.get("/gmail/unread")
async def get_gmail_unread(
    max_results: int = 5,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.google.gmail import GmailProvider
    auth = _get_google_auth()
    provider = GmailProvider(auth, user_id)
    try:
        messages = await provider.get_unread_messages(max_results=max_results)
        return {"messages": messages}
    except Exception as exc:
        logger.error("Failed to fetch Gmail for %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

@router.get("/tasks")
async def get_google_tasks(
    tasklist: str = "@default",
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.google.tasks import build_tasks_provider
    provider = build_tasks_provider(user_id)
    try:
        tasks = await provider.get_tasks(tasklist_id=tasklist)
        return {"tasks": tasks}
    except Exception as exc:
        logger.error("Failed to fetch Google Tasks for %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Books
# ---------------------------------------------------------------------------

@router.get("/books/library")
async def get_google_books_library(
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    from providers.google.books import get_books_provider
    try:
        provider = get_books_provider()
        if not provider.is_connected(user_id):
            return {"connected": False}
        library = await provider.get_library(user_id)
        import dataclasses
        library_dicts = [dataclasses.asdict(b) for b in library]
        return {"connected": True, "library": library_dicts}
    except Exception as exc:
        logger.error("Failed to fetch Google Books for %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# YouTube Music
# ---------------------------------------------------------------------------

@router.get("/music/search")
async def music_search(
    q: str = Query(..., min_length=1),
    filter: str = "songs",
):
    from providers.google.youtube_music import YouTubeMusicProvider
    provider = YouTubeMusicProvider()
    try:
        results = await provider.search(query=q, filter_type=filter)
        return {"results": results}
    except Exception as exc:
        logger.error("Failed to search YouTube Music: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/music/play/{video_id}")
async def music_play(video_id: str):
    from providers.google.youtube_music import YouTubeMusicProvider
    provider = YouTubeMusicProvider()
    # Playback in the background so we can respond immediately
    asyncio.create_task(provider.play_video_id(video_id))
    return {"ok": True}
