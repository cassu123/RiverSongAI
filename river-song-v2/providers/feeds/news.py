# =============================================================================
# providers/feeds/news.py
#
# News provider for River Song AI.
# Ported from controllers/controller_base/news/news_controller.py.
#
# Changes from source:
#   - Replaced synchronous `requests` with async `httpx`.
#   - Methods now return structured article lists instead of only logging.
#   - Added category detection from transcript ("tech news", "sports headlines").
#   - Added topic extraction for "what happened with X" queries.
#   - Added TTS-friendly formatter with configurable article count.
#   - Fixed: source task_data was accessed without a None check in fetch_headlines,
#     which would crash when called without task_data. Fixed by using safe defaults.
#   - Removed ControllerBase dependency (not used in v2 architecture).
#
# API: NewsAPI.org free tier.
#   Docs:       https://newsapi.org/docs
#   Headlines:  GET /v2/top-headlines?country=us&category={cat}&apiKey={key}
#   Everything: GET /v2/everything?q={query}&sortBy=publishedAt&apiKey={key}
#
# Free tier limit: 100 requests/day; headlines endpoint only in production mode.
# =============================================================================

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)

_BASE_URL = "https://newsapi.org/v2"

# Valid NewsAPI category values.
_VALID_CATEGORIES = {
    "business", "entertainment", "general", "health",
    "science", "sports", "technology",
}

# Map spoken category synonyms to NewsAPI category values.
_CATEGORY_ALIASES: Dict[str, str] = {
    "tech": "technology",
    "finance": "business",
    "financial": "business",
    "economy": "business",
    "market": "business",
    "medical": "health",
    "politics": "general",
    "world": "general",
    "international": "general",
    "gaming": "entertainment",
    "movies": "entertainment",
    "music": "entertainment",
    "sport": "sports",
}

# Number of articles to read aloud by default.
_DEFAULT_ARTICLE_COUNT = 5


class NewsProvider:
    """
    Async news provider using the NewsAPI.org API.

    Args:
        api_key: NewsAPI.org API key.
        default_country: ISO 3166-1 alpha-2 country code for headline queries.
    """

    def __init__(self, api_key: str, default_country: str = "us") -> None:
        if not api_key:
            raise ValueError(
                "NEWS_API_KEY is not set. "
                "Register free at https://newsapi.org/register."
            )
        self._api_key = api_key
        self._default_country = default_country

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def get_headlines(
        self,
        category: Optional[str] = None,
        country: Optional[str] = None,
        max_results: int = _DEFAULT_ARTICLE_COUNT,
    ) -> List[Dict[str, Any]]:
        """
        Fetch top news headlines.

        Args:
            category: NewsAPI category string. Valid values: business,
                entertainment, general, health, science, sports, technology.
                None returns general top headlines.
            country: ISO 3166-1 alpha-2 country code (e.g., "us", "gb").
                Falls back to default_country.
            max_results: Maximum number of articles to return.

        Returns:
            List of article dicts, each containing: title, source, url,
            published_at, description.
        """
        params: Dict[str, Any] = {
            "country": country or self._default_country,
            "apiKey": self._api_key,
            "pageSize": max_results,
        }
        if category:
            params["category"] = category

        data = await self._get(f"{_BASE_URL}/top-headlines", params)
        articles = self._parse_articles(data)
        logger.info(
            "Fetched %d headline(s) (category=%s).", len(articles), category or "general"
        )
        return articles

    async def search_news(
        self,
        query: str,
        max_results: int = _DEFAULT_ARTICLE_COUNT,
        sort_by: str = "publishedAt",
    ) -> List[Dict[str, Any]]:
        """
        Search for news articles matching a query.

        Args:
            query: Search string (e.g., "artificial intelligence", "Chicago Cubs").
            max_results: Maximum number of articles to return.
            sort_by: Sort order. Valid values: relevancy, popularity, publishedAt.

        Returns:
            List of article dicts (same shape as get_headlines()).
        """
        if not query.strip():
            return []

        params: Dict[str, Any] = {
            "q": query,
            "apiKey": self._api_key,
            "pageSize": max_results,
            "sortBy": sort_by,
            "language": "en",
        }
        data = await self._get(f"{_BASE_URL}/everything", params)
        articles = self._parse_articles(data)
        logger.info("Fetched %d article(s) for query '%s'.", len(articles), query)
        return articles

    # -------------------------------------------------------------------------
    # TTS formatter
    # -------------------------------------------------------------------------

    @staticmethod
    def format_for_speech(
        articles: List[Dict[str, Any]],
        category: Optional[str] = None,
        query: Optional[str] = None,
    ) -> str:
        """
        Convert a list of article dicts into a TTS-friendly string.

        Args:
            articles: Article dicts as returned by get_headlines() or search_news().
            category: If provided, used in the intro sentence.
            query: If provided, used in the intro sentence instead of category.

        Returns:
            Plain-text news summary suitable for speaking aloud.
        """
        if not articles:
            topic = query or category or "that topic"
            return f"I could not find any news about {topic} right now."

        count = len(articles)
        if query:
            intro = f"Here are {count} result(s) for {query}."
        elif category and category != "general":
            intro = f"Here are the top {count} {category} headline(s)."
        else:
            intro = f"Here are the top {count} headline(s)."

        lines = [intro]
        for i, article in enumerate(articles, 1):
            title = article.get("title", "No title")
            source = article.get("source", "")
            line = f"{i}. {title}"
            if source:
                line += f", from {source}."
            else:
                line += "."
            lines.append(line)

        return " ".join(lines)

    # -------------------------------------------------------------------------
    # Response parser
    # -------------------------------------------------------------------------

    @staticmethod
    def _parse_articles(data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract normalized article dicts from a NewsAPI response."""
        articles = []
        for item in data.get("articles", []):
            source_name = item.get("source", {}).get("name", "")
            title = item.get("title") or ""
            # Skip removed/placeholder articles that NewsAPI sometimes returns.
            if title in ("[Removed]", "") or not title:
                continue
            articles.append({
                "title": title,
                "source": source_name,
                "url": item.get("url", ""),
                "published_at": item.get("publishedAt", ""),
                "description": item.get("description") or "",
            })
        return articles

    # -------------------------------------------------------------------------
    # HTTP helper
    # -------------------------------------------------------------------------

    async def _get(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send an async GET and return the JSON body."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()


# -------------------------------------------------------------------------
# Transcript parsing helpers
# -------------------------------------------------------------------------

def extract_category_from_transcript(transcript: str) -> Optional[str]:
    """
    Detect a NewsAPI category from a spoken query.

    Args:
        transcript: Raw transcript string.

    Returns:
        A valid NewsAPI category string, or None for a general query.
    """
    lower = transcript.lower()
    for alias, category in _CATEGORY_ALIASES.items():
        if alias in lower:
            return category
    for category in _VALID_CATEGORIES:
        if category in lower:
            return category
    return None


def extract_topic_from_transcript(transcript: str) -> Optional[str]:
    """
    Extract a specific search topic from a news query.

    Looks for patterns like "news about X", "what happened with X",
    "anything on X". Returns None for general headline requests.

    Args:
        transcript: Raw transcript string.

    Returns:
        Topic string for search_news(), or None for headline queries.
    """
    lower = transcript.lower()
    patterns = [
        r"\bnews\s+(?:about|on)\s+(.+?)(?:\?|$)",
        r"\bwhat(?:'s|\s+is)\s+happening\s+with\s+(.+?)(?:\?|$)",
        r"\bwhat\s+happened\s+(?:with|to)\s+(.+?)(?:\?|$)",
        r"\banything\s+(?:about|on)\s+(.+?)(?:\?|$)",
        r"\btell\s+me\s+about\s+(.+?)(?:\?|$)",
        r"\bsearch\s+(?:for\s+)?(?:news\s+(?:about|on)\s+)?(.+?)(?:\?|$)",
    ]
    for pattern in patterns:
        m = re.search(pattern, lower)
        if m:
            topic = m.group(1).strip()
            # Reject if it's just a day/time word -- that's a weather query.
            if topic and topic not in {"today", "this week", "this weekend", "lately"}:
                return topic
    return None


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_news_provider() -> NewsProvider:
    """
    Convenience factory that builds a NewsProvider using app settings.

    Returns:
        Configured NewsProvider instance.

    Raises:
        ValueError: If NEWS_API_KEY is not set.
    """
    from config.settings import get_settings
    s = get_settings()
    return NewsProvider(api_key=s.news_api_key)
