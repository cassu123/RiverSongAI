# =============================================================================
# providers/feeds/stocks.py
#
# Stock quote provider for River Song AI.
# Replaces controllers/controller_base/stock_market/stock_market_controller.py.
#
# Why a full rewrite rather than a port:
#   The source controller used base_url "https://api.stockmarketplatform.com/v1/"
#   which does not exist. The response parsing assumed a non-standard schema.
#   manage_portfolio() called get_current_price() expecting a return value but
#   that method only logged -- the arithmetic always crashed at runtime.
#   The entire source implementation was non-functional.
#
# This module uses Alpha Vantage (already in legacy .env as ALPHA_VANTAGE_API_KEY).
#   Docs: https://www.alphavantage.co/documentation/
#   Free tier: 25 API calls/day, up to 5 calls/minute.
#
# Features:
#   - Real-time quote: price, change, change%, volume.
#   - Company name -> ticker resolution for voice queries ("Tesla" -> "TSLA").
#   - TTS-friendly formatter that reads naturally aloud.
# =============================================================================

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx


logger = logging.getLogger(__name__)

_BASE_URL = "https://www.alphavantage.co/query"

# Common company name -> ticker symbol mappings for voice resolution.
# Users can say "what's Tesla at" instead of "what's TSLA at."
_COMPANY_TICKERS: Dict[str, str] = {
    "apple": "AAPL",
    "microsoft": "MSFT",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "meta": "META",
    "facebook": "META",
    "nvidia": "NVDA",
    "tesla": "TSLA",
    "netflix": "NFLX",
    "disney": "DIS",
    "intel": "INTC",
    "amd": "AMD",
    "ibm": "IBM",
    "oracle": "ORCL",
    "salesforce": "CRM",
    "adobe": "ADBE",
    "twitter": "X",
    "uber": "UBER",
    "lyft": "LYFT",
    "airbnb": "ABNB",
    "spotify": "SPOT",
    "paypal": "PYPL",
    "shopify": "SHOP",
    "zoom": "ZM",
    "boeing": "BA",
    "ford": "F",
    "gm": "GM",
    "general motors": "GM",
    "chevron": "CVX",
    "exxon": "XOM",
    "coca cola": "KO",
    "coke": "KO",
    "pepsi": "PEP",
    "johnson and johnson": "JNJ",
    "pfizer": "PFE",
    "moderna": "MRNA",
    "walmart": "WMT",
    "target": "TGT",
    "home depot": "HD",
    "visa": "V",
    "mastercard": "MA",
    "jpmorgan": "JPM",
    "jp morgan": "JPM",
    "bank of america": "BAC",
    "goldman sachs": "GS",
    "berkshire": "BRK.B",
    "s&p 500": "SPY",
    "dow jones": "DIA",
    "nasdaq": "QQQ",
}


class StocksProvider:
    """
    Async stock quote provider using the Alpha Vantage API.

    Args:
        api_key: Alpha Vantage API key.
    """

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError(
                "ALPHA_VANTAGE_API_KEY is not set. "
                "Register free at https://www.alphavantage.co/support/#api-key."
            )
        self._api_key = api_key

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch a real-time stock quote for a ticker symbol.

        Args:
            symbol: Stock ticker symbol (e.g., "TSLA", "AAPL").
                Case-insensitive; converted to uppercase internally.

        Returns:
            Dict with keys: symbol, price, change, change_pct, volume,
            previous_close, open, high, low, latest_trading_day.
            All numeric values are floats (or None if missing from response).

        Raises:
            httpx.HTTPStatusError: On API errors.
            ValueError: If the symbol is not found or rate-limited.
        """
        symbol = symbol.upper().strip()
        params = {
            "function": "GLOBAL_QUOTE",
            "symbol": symbol,
            "apikey": self._api_key,
        }
        data = await self._get(params)
        return self._parse_quote(symbol, data)

    async def get_quote_by_name(self, company_name: str) -> Tuple[str, Dict[str, Any]]:
        """
        Resolve a company name to a ticker and fetch its quote.

        Args:
            company_name: Company name as spoken by the user (e.g., "Tesla").

        Returns:
            Tuple of (resolved_ticker, quote_dict).
            resolved_ticker is the ticker used for the API call.

        Raises:
            ValueError: If the company name cannot be resolved to a ticker.
        """
        ticker = resolve_ticker(company_name)
        if not ticker:
            raise ValueError(
                f"Could not resolve '{company_name}' to a stock ticker. "
                "Try using the ticker symbol directly (e.g., 'TSLA')."
            )
        quote = await self.get_quote(ticker)
        return ticker, quote

    # -------------------------------------------------------------------------
    # TTS formatter
    # -------------------------------------------------------------------------

    @staticmethod
    def format_for_speech(symbol: str, quote: Dict[str, Any]) -> str:
        """
        Convert a quote dict into a TTS-friendly string.

        Args:
            symbol: Ticker symbol string (e.g., "TSLA").
            quote: Dict returned by get_quote().

        Returns:
            Plain-text stock summary suitable for speaking aloud.
        """
        price = quote.get("price")
        change = quote.get("change")
        change_pct = quote.get("change_pct")
        day = quote.get("latest_trading_day", "")

        if price is None:
            return f"I could not find a quote for {symbol}."

        parts = [f"{symbol} is trading at ${price:.2f}"]

        if change is not None and change_pct is not None:
            direction = "up" if change >= 0 else "down"
            abs_change = abs(change)
            abs_pct = abs(change_pct)
            parts.append(
                f"{direction} ${abs_change:.2f} ({abs_pct:.2f}%)"
            )

        if day:
            parts[0] += f" as of {day}"

        return ". ".join(parts) + "."

    # -------------------------------------------------------------------------
    # Response parser
    # -------------------------------------------------------------------------

    @staticmethod
    def _parse_quote(symbol: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract normalized quote fields from an Alpha Vantage GLOBAL_QUOTE response."""
        # Alpha Vantage rate-limit and error messages come back as JSON notes.
        if "Note" in data or "Information" in data:
            msg = data.get("Note") or data.get("Information", "")
            raise ValueError(f"Alpha Vantage API limit or error: {msg}")

        gq = data.get("Global Quote", {})
        if not gq:
            raise ValueError(
                f"No quote data returned for '{symbol}'. "
                "Check that the ticker is valid and the API key has remaining calls."
            )

        def _float(key: str) -> Optional[float]:
            raw = gq.get(key, "").replace("%", "").strip()
            try:
                return float(raw)
            except (ValueError, AttributeError):
                return None

        return {
            "symbol": gq.get("01. symbol", symbol),
            "open": _float("02. open"),
            "high": _float("03. high"),
            "low": _float("04. low"),
            "price": _float("05. price"),
            "volume": _float("06. volume"),
            "latest_trading_day": gq.get("07. latest trading day", ""),
            "previous_close": _float("08. previous close"),
            "change": _float("09. change"),
            "change_pct": _float("10. change percent"),
        }

    # -------------------------------------------------------------------------
    # HTTP helper
    # -------------------------------------------------------------------------

    async def _get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send an async GET to Alpha Vantage and return the JSON body."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(_BASE_URL, params=params)
            resp.raise_for_status()
            return resp.json()


# -------------------------------------------------------------------------
# Ticker resolution helpers
# -------------------------------------------------------------------------

def resolve_ticker(query: str) -> Optional[str]:
    """
    Resolve a company name or spoken query to a stock ticker symbol.

    Checks the static _COMPANY_TICKERS map first, then looks for an
    all-uppercase token that might already be a ticker (2-5 letters).

    Args:
        query: Company name or transcript fragment.

    Returns:
        Uppercase ticker string (e.g., "TSLA"), or None if not resolved.
    """
    lower = query.lower().strip()

    # Exact or contained company name match.
    for name, ticker in _COMPANY_TICKERS.items():
        if name in lower:
            return ticker

    # If the query itself looks like a ticker (2-5 uppercase letters), use it.
    m = re.search(r"\b([A-Z]{2,5})\b", query)
    if m:
        return m.group(1)

    return None


def extract_ticker_from_transcript(transcript: str) -> Optional[str]:
    """
    Extract a company name or ticker from a stock query transcript.

    Strips common question preambles and attempts ticker resolution on what's left.

    Args:
        transcript: Raw transcript string.

    Returns:
        Resolved ticker string, or None if not found.
    """
    lower = transcript.lower()
    # Strip preamble patterns.
    stripped = re.sub(
        r"what(?:'s|\s+is)\s+|how(?:'s|\s+is)\s+|check\s+|look\s+up\s+|"
        r"stock\s+(?:price\s+(?:for|of)\s+)?|price\s+(?:of\s+)?|"
        r"\bat\b|\bdoing\b|\bstock\b|\bshares\b|\btoday\b|\bright\s+now\b",
        " ",
        lower,
    )
    stripped = " ".join(stripped.split())
    return resolve_ticker(stripped)


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_stocks_provider() -> StocksProvider:
    """
    Convenience factory that builds a StocksProvider using app settings.

    Returns:
        Configured StocksProvider instance.

    Raises:
        ValueError: If ALPHA_VANTAGE_API_KEY is not set.
    """
    from config.settings import get_settings
    s = get_settings()
    return StocksProvider(api_key=s.alpha_vantage_api_key)
