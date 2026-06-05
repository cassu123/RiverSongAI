"""
api/routes/google.py

Endpoints for Google Service Integration (Calendar, Gmail, etc.).
This is separate from Google Authentication (Login).
"""

from __future__ import annotations

import logging
import asyncio
import httpx
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
    request: Request,
    code: str = Query(...),
    state: str = Query(...),  # state contains our user_id
):
    """
    Exchange the authorization code for tokens and save them.
    Also links the Google identity to the user account if not already linked.
    """
    user_id = state
    auth = _get_google_auth()
    # Reconstruct the redirect_uri from the current URL (strip query params).
    # Google does not echo redirect_uri back; it must match what was registered.
    redirect_uri = str(request.url).split("?")[0]
    try:
        creds = auth.fetch_token_from_code(user_id=user_id, code=code, redirect_uri=redirect_uri)
        
        # Link the identity so "Login with Google" also works
        try:
            async with httpx.AsyncClient() as http:
                resp = await http.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {creds.token}"},
                )
                if resp.status_code == 200:
                    profile = resp.json()
                    store = request.app.state.memory_manager._store
                    await store.link_google_account(user_id, profile["id"], profile["email"])
                    logger.info("Linked Google identity %s to user %s during service connection", profile["email"], user_id)
        except Exception as link_exc:
            logger.warning("Failed to link Google identity for user %s: %s", user_id, link_exc)

        # Redirect back to the frontend Google page
        return RedirectResponse(url="/google")
    except Exception as exc:
        logger.error("Google auth callback failed for user %s: %s", user_id, exc)
        # On error, we might want to redirect with an error param
        return RedirectResponse(url=f"/google?error={exc}")


@router.get("/status")
async def get_status(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """
    Check if the user has a valid Google token stored.
    """
    user_id = await _require_user(authorization)
    auth = _get_google_auth()
    try:
        creds = auth.get_credentials(user_id)
        
        # Also check if identity is linked in DB
        store = request.app.state.memory_manager._store
        user = await store.get_user_by_id(user_id)
        google_email = user.get("google_email") if user else None

        return {
            "connected": True,
            "email": google_email,
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


@router.get("/gmail/triage")
async def get_gmail_triage(
    max_results: int = 10,
    authorization: Optional[str] = Header(default=None),
):
    """
    Q2#8 — Gmail triage. Returns unread messages annotated with urgency,
    tags, summary, and an optional drafted reply for HIGH-urgency mail.

    Flag-gated by settings.gmail_triage_enabled; returns 404 when off.
    """
    from config.settings import get_settings as _gs
    if not getattr(_gs(), "gmail_triage_enabled", False):
        raise HTTPException(status_code=404, detail="Gmail triage is disabled.")

    user_id = await _require_user(authorization)
    from core.email_triage import triage_inbox
    try:
        enriched = await triage_inbox(user_id, max_results=max_results)
        return {"messages": enriched}
    except Exception as exc:
        logger.error("Triage failed for %s: %s", user_id, exc)
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


@router.get("/music/home")
async def get_music_home():
    """
    Returns trending tracks for the dashboard widget.
    Auth: None required for public charts.
    """
    from providers.google.youtube_music import YouTubeMusicProvider
    provider = YouTubeMusicProvider()
    try:
        tracks = await provider.get_charts(country="US")
        if not tracks:
            return {"success": True, "data": [], "message": "No charts available."}
        return {"success": True, "data": tracks}
    except Exception as exc:
        logger.error("Failed to fetch music charts: %s", exc)
        raise HTTPException(status_code=502, detail="Unable to fetch music charts.")


@router.post("/music/play/{video_id}")
async def music_play(video_id: str):
    from providers.google.youtube_music import YouTubeMusicProvider
    provider = YouTubeMusicProvider()
    # Playback in the background so we can respond immediately
    asyncio.create_task(provider.play_video_id(video_id))
    return {"ok": True}
