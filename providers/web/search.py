"""
providers/web/search.py

Multi-provider web search system with a free fallback chain.
Providers: SearXNG (local) -> Tavily -> Google PSE -> TinyFish
"""

import logging
import httpx
from abc import ABC, abstractmethod
from typing import List
from config.settings import get_settings

logger = logging.getLogger(__name__)


class SearchProvider(ABC):
    """Abstract base class for search providers."""
    @abstractmethod
    async def search(self, query: str, count: int = 5) -> str:
        """Perform a web search and return results as a formatted string."""


class SearXNGSearchProvider(SearchProvider):
    """Unlimited local search via SearXNG."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def search(self, query: str, count: int = 5) -> str:
        # Quick health check
        try:
            async with httpx.AsyncClient() as client:
                await client.get(self.base_url, timeout=1.5)
        except Exception:
            raise RuntimeError("SearXNG not running")

        params = {
            "q": query,
            "format": "json",
            "engines": "google,bing,duckduckgo",
            "language": "en"
        }
        headers = {"User-Agent": "RiverSongAI/3.0"}

        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{self.base_url}/search", params=params, headers=headers, timeout=10.0)
            if resp.status_code != 200:
                raise RuntimeError(f"SearXNG error {resp.status_code}")

            data = resp.json()
            results = data.get("results", [])[:count]
            if not results:
                return ""

            output = [f"Search results for '{query}':"]
            for i, res in enumerate(results):
                title = res.get("title", "No Title")
                content = res.get("content") or res.get(
                    "snippet") or "No content"
                url = res.get("url", "")
                output.append(
                    f"{i + 1}. {title}\n   {content}\n   Source: {url}")

            return "\n\n".join(output)


class TavilySearchProvider(SearchProvider):
    """High-quality AI search (1,000 free/month)."""

    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError("Tavily API key empty")
        self.api_key = api_key
        self.url = "https://api.tavily.com/search"

    async def search(self, query: str, count: int = 5) -> str:
        payload = {
            "api_key": self.api_key,
            "query": query,
            "max_results": count,
            "include_answer": True
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(self.url, json=payload, timeout=15.0)
            if resp.status_code != 200:
                raise RuntimeError(f"Tavily error {resp.status_code}")

            data = resp.json()
            results = data.get("results", [])[:count]

            output = [f"Search results for '{query}':"]
            if data.get("answer"):
                output.append(f"Summary: {data['answer']}")

            for i, res in enumerate(results):
                title = res.get("title", "No Title")
                content = res.get("content", "No content")
                url = res.get("url", "")
                output.append(
                    f"{i + 1}. {title}\n   {content}\n   Source: {url}")

            return "\n\n".join(output)


class GooglePSESearchProvider(SearchProvider):
    """Google Programmable Search (100 free/day)."""

    def __init__(self, api_key: str, cx: str):
        if not api_key or not cx:
            raise RuntimeError("Google PSE config missing")
        self.api_key = api_key
        self.cx = cx
        self.url = "https://www.googleapis.com/customsearch/v1"

    async def search(self, query: str, count: int = 5) -> str:
        params = {
            "key": self.api_key,
            "cx": self.cx,
            "q": query,
            "num": min(count, 10)
        }
        async with httpx.AsyncClient() as client:
            # type: ignore
            resp = await client.get(self.url, params=params, timeout=15.0)  # type: ignore
            if resp.status_code != 200:
                raise RuntimeError(f"Google PSE error {resp.status_code}")

            data = resp.json()
            items = data.get("items", [])[:count]
            if not items:
                return ""

            output = [f"Search results for '{query}':"]
            for i, item in enumerate(items):
                title = item.get("title", "No Title")
                snippet = item.get("snippet", "No snippet")
                link = item.get("link", "")
                output.append(
                    f"{i + 1}. {title}\n   {snippet}\n   Source: {link}")

            return "\n\n".join(output)


class TinyFishSearchProvider(SearchProvider):
    """Fast, free search backup (5 free/min)."""

    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError("TinyFish API key empty")
        self.api_key = api_key

    async def search(self, query: str, count: int = 5) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"}

        # Try endpoint 1
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.tinyfish.io/search",
                    params={"q": query, "num": count},
                    headers=headers,
                    timeout=10.0
                )
                if resp.status_code == 200:
                    logger.info("TinyFish: Using v1 GET endpoint")
                    return self._parse(resp.json(), query, count)
        except Exception as exc:
            logger.debug("TinyFish v1 GET endpoint failed: %s", exc)

        # Try endpoint 2
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.tinyfish.io/v1/search",
                json={"query": query, "num_results": count},
                headers=headers,
                timeout=10.0
            )
            if resp.status_code == 200:
                logger.info("TinyFish: Using v1 POST endpoint")
                return self._parse(resp.json(), query, count)

        raise RuntimeError("TinyFish both endpoints failed")

    def _parse(self, data: dict, query: str, count: int) -> str:
        results = data.get("results") or data.get("data") or []
        results = results[:count]
        if not results:
            return ""

        output = [f"Search results for '{query}':"]
        for i, res in enumerate(results):
            title = res.get("title", "No Title")
            content = res.get("snippet") or res.get(
                "content") or res.get("description") or "No content"
            url = res.get("url") or res.get("link") or ""
            output.append(f"{i + 1}. {title}\n   {content}\n   Source: {url}")

        return "\n\n".join(output)


class FallbackSearchProvider(SearchProvider):
    """Orchestrates multiple providers in a fallback chain."""

    def __init__(self, providers: List[SearchProvider]):
        self.providers = providers

    async def search(self, query: str, count: int = 5) -> str:
        for provider in self.providers:
            name = provider.__class__.__name__
            try:
                logger.debug("Trying search provider: %s", name)
                result = await provider.search(query, count)
                if result and len(result.strip()) > 50:
                    return result
            except Exception as exc:
                logger.warning("%s failed: %s", name, exc)

        return (
            "I wasn't able to search the web right now — all search services "
            "are currently unavailable. Try asking me something I can answer "
            "from memory, or check your .env to configure a search provider."
        )


def build_search_provider() -> SearchProvider:
    s = get_settings()
    providers = []

    # Always try SearXNG first (no key needed, just needs to be running)
    providers.append(SearXNGSearchProvider(s.searxng_base_url))

    # Add paid-free providers only if keys are configured
    if s.tavily_api_key:
        providers.append(
            TavilySearchProvider(
                s.tavily_api_key))  # type: ignore

    if s.google_pse_api_key and s.google_pse_cx:
        providers.append(
            GooglePSESearchProvider(
                s.google_pse_api_key,
                s.google_pse_cx))  # type: ignore

    if s.tinyfish_api_key:
        providers.append(
            TinyFishSearchProvider(
                s.tinyfish_api_key))  # type: ignore

    return FallbackSearchProvider(providers)  # type: ignore
