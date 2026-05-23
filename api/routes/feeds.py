"""
api/routes/feeds.py

Feed endpoints for news, weather, sports, and stocks.
Refactored to use FeedService for modular logic.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from core.auth import decode_token
from core.errors import bad_request, forbidden, not_found, unauthorized
from api.services.feed_service import FeedService
from providers.feeds.news import (
    NEWS_SOURCES, NEWS_SOURCE_CATEGORIES,
    SPORTS_RSS_SOURCES, SPORTS_RSS_CATEGORIES,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feeds", tags=["feeds"])


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


def _store(request: Request):
    mm = getattr(request.app.state, "memory_manager", None)
    if mm is None:
        raise HTTPException(status_code=503, detail="Memory manager not available.")
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
    sports_news_sources: list = []
    sports_favorite_leagues: list = ["nba", "nfl", "mlb"]
    stock_tickers: list = []
    weather_alerts_enabled: bool = True
    refresh_news_min: int = 30
    refresh_weather_min: int = 30
    refresh_sports_min: int = 60
    refresh_stocks_min: int = 60
    feed_news_enabled: bool = True
    feed_weather_enabled: bool = True
    feed_sports_enabled: bool = True
    feed_stocks_enabled: bool = True
    feed_flights_enabled: bool = True


@router.get("/preferences")
async def get_preferences(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_preferences(_store(request), user_id)


@router.put("/preferences")
async def save_preferences(
    body: PrefsUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    await FeedService.save_preferences(_store(request), user_id, body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------

@router.get("/news/sources")
async def get_news_sources():
    """Return curated RSS sources for the News tab (sports categories excluded)."""
    return {"sources": NEWS_SOURCES, "categories": NEWS_SOURCE_CATEGORIES}


@router.get("/sports/news/sources")
async def get_sports_news_sources():
    """Return sports RSS source catalogue for the Sports tab."""
    return {"sources": SPORTS_RSS_SOURCES, "categories": SPORTS_RSS_CATEGORIES}


@router.get("/news")
async def get_news(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_news(_store(request), user_id)


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

@router.get("/weather")
async def get_weather(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_weather(_store(request), user_id)


@router.get("/weather/alerts")
async def get_weather_alerts(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_weather_alerts(_store(request), user_id)


# ---------------------------------------------------------------------------
# Sports
# ---------------------------------------------------------------------------

from providers.feeds.sports import (
    get_leagues, get_teams, get_scoreboard,
    get_standings as espn_get_standings,
    get_schedule, get_boxscore,
)

@router.get("/sports/leagues")
async def list_leagues():
    """Return list of supported leagues from the ESPN registry."""
    return await get_leagues()

@router.get("/sports/teams/{league_id}")
async def list_teams(league_id: str):
    """Return all teams in a specific league via ESPN."""
    return await get_teams(league_id)

@router.get("/sports/scoreboard/{league_id}")
async def scoreboard(league_id: str):
    """Return live scores and today's schedule for a league via ESPN."""
    return await get_scoreboard(league_id)

@router.get("/sports/espn-standings/{league_id}")
async def espn_standings(league_id: str):
    """Return league standings table via ESPN."""
    return await espn_get_standings(league_id)

@router.get("/sports/schedule/{league_id}/{team_id}")
async def team_schedule(league_id: str, team_id: str):
    """Return upcoming games for a specific team via ESPN."""
    return await get_schedule(team_id, league_id)

@router.get("/sports/boxscore/{league_id}/{event_id}")
async def event_boxscore(league_id: str, event_id: str):
    """Return detailed game summary/plays for an event via ESPN."""
    return await get_boxscore(event_id, league_id)

@router.get("/sports/news")
async def get_sports_news(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Fetch sports headline articles from RSS feeds for the Sports tab."""
    user_id = await _require_user(authorization)
    return await FeedService.get_sports_news(_store(request), user_id, SPORTS_RSS_SOURCES)


@router.get("/sports/standings")
async def get_standings(league_id: str = Query(...), season: str = Query(default="")):
    """Fetch league standings table from TheSportsDB."""
    return await FeedService.get_sports_standings(league_id, season)


@router.get("/sports/search")
async def sports_search(q: str = Query(..., min_length=2)):
    """Search teams by name via TheSportsDB."""
    return await FeedService.search_sports_teams(q)


@router.get("/sports/event-stats")
async def get_event_stats(event_id: str = Query(...)):
    """Fetch detailed statistics for a specific event."""
    return await FeedService.get_sports_event_stats(event_id)


@router.get("/sports")
async def get_sports(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_sports_feed(_store(request), user_id)


# ---------------------------------------------------------------------------
# Stocks
# ---------------------------------------------------------------------------

@router.get("/stocks/news/{ticker}")
async def get_stock_news(ticker: str):
    """Fetch recent company news for a ticker via Finnhub."""
    return await FeedService.get_stock_news(ticker)


@router.get("/stocks/search")
async def stocks_search(q: str = Query(..., min_length=1)):
    return await FeedService.search_stocks(q)


@router.get("/stocks/chart")
async def get_stock_chart(ticker: str = Query(...)):
    return await FeedService.get_stock_chart(ticker)


@router.get("/stocks")
async def get_stocks(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_stocks(_store(request), user_id)


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------

@router.get("/flights")
async def get_flights(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = await _require_user(authorization)
    return await FeedService.get_flights(_store(request), user_id)
