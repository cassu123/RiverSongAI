"""
providers/feeds/stocks.py

Stock quote provider using Alpha Vantage GLOBAL_QUOTE endpoint.
Free tier: 25 requests/day, up to 5/minute.
Returns a simple price snapshot per ticker symbol.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://www.alphavantage.co/query"


async def fetch_quote(ticker: str, api_key: str) -> Optional[Dict[str, Any]]:
    """Fetch a single stock quote from Alpha Vantage."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_BASE, params={
                "function": "GLOBAL_QUOTE",
                "symbol": ticker.upper(),
                "apikey": api_key,
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Alpha Vantage fetch failed for %s: %s", ticker, exc)
        return None

    q = data.get("Global Quote") or {}
    if not q or not q.get("05. price"):
        logger.warning("No quote data returned for %s (API limit may be hit)", ticker)
        return None

    price = float(q.get("05. price", 0))
    change = float(q.get("09. change", 0))
    change_pct_raw = q.get("10. change percent", "0%").replace("%", "")
    try:
        change_pct = float(change_pct_raw)
    except ValueError:
        change_pct = 0.0

    return {
        "ticker": ticker.upper(),
        "price": round(price, 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "volume": q.get("06. volume", ""),
        "prev_close": q.get("08. previous close", ""),
        "open": q.get("02. open", ""),
        "high": q.get("03. high", ""),
        "low": q.get("04. low", ""),
        "up": change >= 0,
    }


async def fetch_quotes(tickers: List[str], api_key: str) -> List[Dict[str, Any]]:
    """Fetch quotes for multiple tickers, sequentially to respect rate limits."""
    results = []
    for ticker in tickers:
        quote = await fetch_quote(ticker, api_key)
        if quote:
            results.append(quote)
        await asyncio.sleep(0.5)
    return results


async def fetch_chart(ticker: str, api_key: str, days: int = 30) -> List[Dict[str, Any]]:
    """Fetch daily OHLCV data for the last `days` trading days."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(_BASE, params={
                "function": "TIME_SERIES_DAILY",
                "symbol": ticker.upper(),
                "outputsize": "compact",
                "apikey": api_key,
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Alpha Vantage chart fetch failed for %s: %s", ticker, exc)
        return []

    series = data.get("Time Series (Daily)") or {}
    if not series:
        return []

    rows = []
    for date_str, ohlcv in sorted(series.items())[-days:]:
        rows.append({
            "date": date_str,
            "open":  float(ohlcv.get("1. open", 0)),
            "high":  float(ohlcv.get("2. high", 0)),
            "low":   float(ohlcv.get("3. low", 0)),
            "close": float(ohlcv.get("4. close", 0)),
            "volume": int(ohlcv.get("5. volume", 0)),
        })
    return rows


async def search_symbols(query: str, api_key: str) -> List[Dict[str, Any]]:
    """Search for ticker symbols by company name or partial ticker."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_BASE, params={
                "function": "SYMBOL_SEARCH",
                "keywords": query,
                "apikey": api_key,
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Alpha Vantage symbol search failed: %s", exc)
        return []

    results = []
    for m in (data.get("bestMatches") or [])[:8]:
        results.append({
            "ticker": m.get("1. symbol") or "",
            "name":   m.get("2. name") or "",
            "type":   m.get("3. type") or "",
            "region": m.get("4. region") or "",
            "currency": m.get("8. currency") or "USD",
        })
    return results
