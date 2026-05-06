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
# Preferences
# ---------------------------------------------------------------------------

class PrefsUpdate(BaseModel):
    news_sources: list = []
    weather_lat: Optional[float] = None
    weather_lon: Optional[float] = None
    weather_unit: str = "celsius"
    sport_teams: list = []
    sports_news_sources: list = []
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
    return await FeedService.get_preferences(_store(request), user_id)


@router.put("/preferences")
async def save_preferences(
    body: PrefsUpdate,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
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
    user_id = _require_user(authorization)
    return await FeedService.get_news(_store(request), user_id)


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

@router.get("/weather")
async def get_weather(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    return await FeedService.get_weather(_store(request), user_id)


@router.get("/weather/alerts")
async def get_weather_alerts(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
    return await FeedService.get_weather_alerts(_store(request), user_id)


# ---------------------------------------------------------------------------
# Sports
# ---------------------------------------------------------------------------

@router.get("/sports/news")
async def get_sports_news(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Fetch sports headline articles from RSS feeds for the Sports tab."""
    user_id = _require_user(authorization)
    return await FeedService.get_sports_news(_store(request), user_id, SPORTS_RSS_SOURCES)


@router.get("/sports/standings")
async def get_standings(league_id: str = Query(...), season: str = Query(default="")):
    """Fetch league standings table from TheSportsDB."""
    return await FeedService.get_sports_standings(league_id, season)


@router.get("/sports/search")
async def sports_search(q: str = Query(..., min_length=2)):
    """Search teams by name via TheSportsDB."""
    return await FeedService.search_sports_teams(q)


@router.get("/sports")
async def get_sports(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user(authorization)
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
    user_id = _require_user(authorization)
    return await FeedService.get_stocks(_store(request), user_id)
