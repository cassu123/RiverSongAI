"""
api/services/feed_service.py

Service layer for information feeds (news, weather, sports, stocks).
Handles logic and data aggregation, keeping route handlers thin.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from config.settings import get_settings
from providers.feeds.news import fetch_articles
from providers.feeds.weather import fetch_weather, fetch_nws_alerts
from providers.feeds.sports import (
    search_teams, fetch_teams_feed, fetch_standings, fetch_event_stats
)
from providers.feeds.stocks import (
    fetch_quotes, fetch_chart, search_symbols,
    fetch_finnhub_quotes, fetch_finnhub_news,
)

logger = logging.getLogger(__name__)


class FeedService:
    @staticmethod
    async def get_preferences(store: Any, user_id: str) -> Dict[str, Any]:
        return await store.get_feed_preferences(user_id)

    @staticmethod
    async def save_preferences(store: Any, user_id: str, prefs: Dict[str, Any]) -> None:
        await store.save_feed_preferences(user_id, prefs)

    @staticmethod
    async def get_news(store: Any, user_id: str) -> List[Dict[str, Any]]:
        prefs = await store.get_feed_preferences(user_id)
        sources = prefs.get("news_sources") or []
        if not sources:
            return []

        settings = get_settings()
        return await fetch_articles(
            sources=sources,
            newsapi_key=settings.news_api_key,
            world_news_key=settings.world_news_api_key,
            apitube_key=settings.apitube_api_key,
            mediastack_key=settings.mediastack_api_key,
            limit_per_source=8,
        )

    @staticmethod
    async def get_weather(store: Any, user_id: str) -> Dict[str, Any]:
        prefs = await store.get_feed_preferences(user_id)
        page  = await store.get_page_settings(user_id)
        wx    = page.get("weather", {})

        lat = wx.get("lat") or prefs.get("weather_lat")
        lon = wx.get("lon") or prefs.get("weather_lon")
        if lat is None or lon is None:
            raise HTTPException(status_code=404, detail="No location saved.")

        raw_units = wx.get("units")
        if raw_units == "imperial":
            unit = "fahrenheit"
        elif raw_units == "metric":
            unit = "celsius"
        else:
            unit = prefs.get("weather_unit", "celsius")

        wind_unit = wx.get("wind_unit", "mph" if unit == "fahrenheit" else "kmh")

        try:
            return await fetch_weather(lat, lon, unit, wind_unit)
        except Exception as exc:
            logger.error("Weather fetch failed for user %s: %s", user_id, exc)
            raise HTTPException(status_code=502, detail=f"Weather fetch failed: {exc}")

    @staticmethod
    async def get_weather_alerts(store: Any, user_id: str) -> Dict[str, Any]:
        prefs = await store.get_feed_preferences(user_id)
        lat = prefs.get("weather_lat")
        lon = prefs.get("weather_lon")
        if lat is None or lon is None:
            raise HTTPException(status_code=404, detail="No location saved.")
        
        alerts = await fetch_nws_alerts(lat, lon)
        return {"alerts": alerts, "count": len(alerts)}

    @staticmethod
    async def get_sports_news(
        store: Any, 
        user_id: str, 
        fallback_sources: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        prefs = await store.get_feed_preferences(user_id)
        saved = prefs.get("sports_news_sources") or []
        sources = saved if saved else fallback_sources

        settings = get_settings()
        return await fetch_articles(
            sources=sources,
            newsapi_key=settings.news_api_key,
            limit_per_source=8,
        )

    @staticmethod
    async def get_sports_feed(store: Any, user_id: str) -> Dict[str, Any]:
        prefs = await store.get_feed_preferences(user_id)
        teams = [t for t in (prefs.get("sport_teams") or []) if t.get("id") and t.get("league_id")]
        if not teams:
            return {"results": [], "fixtures": []}

        return await fetch_teams_feed(teams)

    @staticmethod
    async def search_sports_teams(q: str) -> List[Dict[str, Any]]:
        return await search_teams(q)

    @staticmethod
    async def get_sports_standings(league_id: str, season: str = "") -> List[Dict[str, Any]]:
        return await fetch_standings(league_id, season)

    @staticmethod
    async def get_sports_event_stats(event_id: str) -> List[Dict[str, Any]]:
        return await fetch_event_stats(event_id)

    @staticmethod
    async def get_stock_news(ticker: str) -> List[Dict[str, Any]]:
        settings = get_settings()
        if not settings.finnhub_api_key:
            raise HTTPException(status_code=503, detail="FINNHUB_KEY not configured.")
        return await fetch_finnhub_news(ticker.upper(), settings.finnhub_api_key)

    @staticmethod
    async def search_stocks(q: str) -> List[Dict[str, Any]]:
        settings = get_settings()
        if not settings.alpha_vantage_api_key:
            raise HTTPException(status_code=503, detail="ALPHA_VANTAGE_KEY not configured.")
        return await search_symbols(q, settings.alpha_vantage_api_key)

    @staticmethod
    async def get_stock_chart(ticker: str) -> Dict[str, Any]:
        settings = get_settings()
        if not settings.alpha_vantage_api_key:
            raise HTTPException(status_code=503, detail="ALPHA_VANTAGE_KEY not configured.")
        
        data = await fetch_chart(ticker.upper(), settings.alpha_vantage_api_key)
        if not data:
            raise HTTPException(
                status_code=502, 
                detail=f"No chart data for {ticker}. API limit may be reached."
            )
        return data

    @staticmethod
    async def get_stocks(store: Any, user_id: str) -> List[Dict[str, Any]]:
        page    = await store.get_page_settings(user_id)
        tickers = page.get("markets", {}).get("watchlist")
        if not tickers:
            prefs   = await store.get_feed_preferences(user_id)
            tickers = prefs.get("stock_tickers") or []
        if not tickers:
            return []

        settings = get_settings()

        # Prefer Finnhub (higher rate limit, real-time)
        if settings.finnhub_api_key:
            quotes = await fetch_finnhub_quotes(tickers, settings.finnhub_api_key)
            if quotes:
                return quotes

        # Fallback: Alpha Vantage
        if settings.alpha_vantage_api_key:
            return await fetch_quotes(tickers, settings.alpha_vantage_api_key)

        raise HTTPException(
            status_code=503,
            detail="No stock data provider configured. Add FINNHUB_API_KEY or ALPHA_VANTAGE_API_KEY to .env."
        )

    @staticmethod
    async def get_flights(
        store: Any,
        user_id: str,
        lat_override: Optional[float] = None,
        lon_override: Optional[float] = None,
        radius_override: Optional[float] = None,
        filter_status: Optional[str] = None,
    ) -> Dict[str, Any]:
        page  = await store.get_page_settings(user_id)
        prefs = await store.get_feed_preferences(user_id)
        wx    = page.get("weather", {})
        fl    = page.get("flights", {})

        lat = lat_override or wx.get("lat") or prefs.get("weather_lat")
        lon = lon_override or wx.get("lon") or prefs.get("weather_lon")

        if lat is None or lon is None:
            config = await store.get_admin_config()
            lat = lat or config.get("location_lat")
            lon = lon or config.get("location_lon")

        if lat is None or lon is None:
            settings = get_settings()
            lat = lat or getattr(settings, "location_lat", None)
            lon = lon or getattr(settings, "location_lon", None)

        if lat is None or lon is None:
            raise HTTPException(status_code=404, detail="No location saved.")

        radius = radius_override or fl.get("radar_radius_deg", 0.5)
        from providers.feeds.flights import fetch_overhead
        flights = await fetch_overhead(lat, lon, radius_deg=radius)

        if filter_status == "airborne":
            flights = [f for f in flights if not f.get("on_ground")]
        elif filter_status == "ground":
            flights = [f for f in flights if f.get("on_ground")]

        return {"flights": flights, "lat": lat, "lon": lon}
