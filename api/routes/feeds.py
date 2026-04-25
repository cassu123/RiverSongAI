"""
api/routes/feeds.py

Feed endpoints for news, weather, sports, and stocks.

GET  /api/feeds/preferences          -- load user's feed config
PUT  /api/feeds/preferences          -- save user's feed config
GET  /api/feeds/news                 -- fetch news articles
GET  /api/feeds/news/sources         -- list curated RSS sources
GET  /api/feeds/weather              -- fetch current + forecast weather
GET  /api/feeds/sports               -- fetch results + fixtures for followed teams
GET  /api/feeds/sports/search        -- search teams by name
GET  /api/feeds/stocks               -- fetch stock quotes for watchlist
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from core.auth import decode_token
from config.settings import get_settings
from providers.feeds.news import fetch_articles, CURATED_SOURCES
from providers.feeds.weather import fetch_weather
from providers.feeds.sports import search_teams, fetch_teams_feed
from providers.feeds.stocks import fetch_quotes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feeds", tags=["feeds"])


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
        raise HTTPException(status_code=503, detail="Memory manager not available")
    return mm._store


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

class PrefsUpdate(BaseModel):
    news_sources: list = []
    weather_lat: Optional[float] = None
    weather_lon: Optional[float] = None
    weather_unit: str = "celsius"
    sport_teams: list = []
    stock_tickers: list = []
    refresh_news_min: int = 30
    refresh_weather_min: int = 30
    refresh_sports_min: int = 60
    refresh_stocks_min: int = 60


@router.get("/preferences")
async def get_preferences(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    prefs = await store.get_feed_preferences(user_id)
    return prefs


@router.put("/preferences")
async def save_preferences(
    body: PrefsUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    await store.save_feed_preferences(user_id, body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------

@router.get("/news/sources")
async def get_news_sources():
    """Return the full curated RSS source catalogue."""
    return CURATED_SOURCES


@router.get("/news")
async def get_news(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    prefs = await store.get_feed_preferences(user_id)

    sources = prefs.get("news_sources") or []
    if not sources:
        return []

    settings = get_settings()
    articles = await fetch_articles(
        sources=sources,
        newsapi_key=settings.news_api_key,
        limit_per_source=8,
    )
    return articles


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

@router.get("/weather")
async def get_weather(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    prefs = await store.get_feed_preferences(user_id)

    lat = prefs.get("weather_lat")
    lon = prefs.get("weather_lon")
    if lat is None or lon is None:
        raise HTTPException(status_code=404, detail="No location saved. Set your location in Feed Settings.")

    unit = prefs.get("weather_unit", "celsius")
    try:
        data = await fetch_weather(lat, lon, unit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Weather fetch failed: {exc}")
    return data


# ---------------------------------------------------------------------------
# Sports
# ---------------------------------------------------------------------------

@router.get("/sports/search")
async def sports_search(q: str = Query(..., min_length=2)):
    """Search teams by name via TheSportsDB."""
    teams = await search_teams(q)
    return teams


@router.get("/sports")
async def get_sports(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    prefs = await store.get_feed_preferences(user_id)

    teams = prefs.get("sport_teams") or []
    team_ids = [t["id"] for t in teams if t.get("id")]
    if not team_ids:
        return {"results": [], "fixtures": []}

    data = await fetch_teams_feed(team_ids)
    return data


# ---------------------------------------------------------------------------
# Stocks
# ---------------------------------------------------------------------------

@router.get("/stocks")
async def get_stocks(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    store = _store(request)
    prefs = await store.get_feed_preferences(user_id)

    tickers = prefs.get("stock_tickers") or []
    if not tickers:
        return []

    settings = get_settings()
    if not settings.alpha_vantage_api_key:
        raise HTTPException(status_code=503, detail="ALPHA_VANTAGE_KEY not configured.")

    quotes = await fetch_quotes(tickers, settings.alpha_vantage_api_key)
    return quotes
