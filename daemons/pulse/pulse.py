"""
daemons/pulse/pulse.py

Pulse daemon — fetches ambient feeds on a tick and stores snapshots.

Sources:
  - News:    latest headline from providers.feeds.news (existing RSS layer)
  - Markets: ticker quote from providers.feeds.stocks (existing layer)
  - Flights: flights overhead from providers.feeds.flights (OpenSky free API)

Tick interval: settings.pulse_tick_seconds (default 300).
"""
import asyncio
import logging
import time

from daemons.base_daemon import BaseDaemon
from providers.feeds.news import fetch_articles, NEWS_SOURCES
from providers.feeds.stocks import fetch_quote, fetch_finnhub_quote
from providers.feeds.flights import fetch_overhead

logger = logging.getLogger(__name__)


class PulseDaemon(BaseDaemon):
    name = "pulse"

    async def _handle_task(self, action: str, payload: dict) -> dict:
        """Handle external task requests (e.g., force a refresh)."""
        if action == "refresh":
            await self._tick_once()
            return {"refreshed": True}
        return {"error": f"unknown action {action}"}

    async def _main_loop(self) -> None:
        if not self.settings.daemon_pulse_enabled:
            logger.info("Pulse: disabled in settings. Idle loop started.")
            while self._running:
                await asyncio.sleep(60)
            return

        logger.info("Pulse: starting. Tick interval = %ds", self.settings.pulse_tick_seconds)
        # Initial tick immediately so the dashboard isn't empty
        await self._tick_once()
        while self._running:
            await asyncio.sleep(self.settings.pulse_tick_seconds)
            await self._tick_once()

    async def _tick_once(self) -> None:
        ts = time.time()
        results = await asyncio.gather(
            self._fetch_news(),
            self._fetch_markets(),
            self._fetch_flights(),
            return_exceptions=True,
        )
        news_data, markets_data, flights_data = results

        # Save each snapshot, swallowing per-source failures
        await self._save_or_log("news", news_data, ts)
        await self._save_or_log("markets", markets_data, ts)
        await self._save_or_log("flights", flights_data, ts)

        # Prune to last 100 per source
        await self._prune_all()

    async def _save_or_log(self, source: str, data, ts: float) -> None:
        if isinstance(data, Exception):
            logger.warning(f"Pulse {source} fetch failed: {data}")
            return
        # POST to main app's snapshot endpoint OR call the store directly.
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    f"http://localhost:{self.settings.app_port}/api/pulse/_internal/snapshot",
                    json={"source": source, "data": data, "ts": ts},
                    headers={"Authorization": f"Bearer {self.settings.daemon_internal_secret}"},
                )
                resp.raise_for_status()
        except Exception as e:
            logger.warning(f"Pulse save {source} failed: {e}")

    async def _prune_all(self) -> None:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    f"http://localhost:{self.settings.app_port}/api/pulse/_internal/prune",
                    headers={"Authorization": f"Bearer {self.settings.daemon_internal_secret}"},
                )
                resp.raise_for_status()
        except Exception as e:
            logger.warning(f"Pulse prune failed: {e}")

    async def _fetch_news(self) -> dict:
        try:
            # signature: fetch_articles(sources, limit_per_source, newsapi_key)
            newsapi_key = getattr(self.settings, "newsapi_key", None)
            articles = await fetch_articles(NEWS_SOURCES, limit_per_source=1, newsapi_key=newsapi_key)
            if not articles:
                return {}
            top = articles[0]
            return {
                "headline": top.get("title", ""),
                "source": top.get("source", ""),
                "url": top.get("url", ""),
                "published_at": top.get("published_at", ""),
            }
        except Exception as e:
            logger.warning(f"News fetch failed: {e}")
            return {}

    async def _fetch_markets(self) -> dict:
        symbol = self.settings.pulse_ticker_symbol
        finnhub_key = getattr(self.settings, "finnhub_api_key", "") or ""
        alpha_key = getattr(self.settings, "alpha_vantage_api_key", "") or ""

        try:
            if finnhub_key:
                quote = await fetch_finnhub_quote(symbol, finnhub_key)
            elif alpha_key:
                quote = await fetch_quote(symbol, alpha_key)
            else:
                return {"symbol": symbol, "error": "no API key configured"}

            if not quote:
                return {"symbol": symbol, "error": "fetch failed"}
            return {"symbol": symbol, **quote}
        except Exception as e:
            logger.warning(f"Markets fetch failed: {e}")
            return {"symbol": symbol, "error": str(e)}

    async def _fetch_flights(self) -> dict:
        lat = getattr(self.settings, "location_lat", None)
        lon = getattr(self.settings, "location_lon", None)
        if lat is None or lon is None:
            return {"flights": [], "reason": "location_not_set"}
        flights = await fetch_overhead(lat, lon)
        return {"flights": flights, "lat": lat, "lon": lon}
