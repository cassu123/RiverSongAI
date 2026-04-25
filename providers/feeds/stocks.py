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
        # Avoid hitting Alpha Vantage's 5/min rate limit
        await asyncio.sleep(0.5)
    return results
