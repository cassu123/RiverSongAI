"""
providers/feeds/news.py

News provider — fetches headlines from RSS feeds (no API key required) and
optionally from NewsAPI.org when a key is configured.

Curated RSS sources are grouped by category so users can subscribe by topic.
Each article returned is a plain dict: {title, summary, url, source, published_at}.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated RSS feed catalogue
# Each entry: {"name": str, "url": str, "category": str}
# ---------------------------------------------------------------------------
CURATED_SOURCES: List[Dict[str, str]] = [
    # ── World / General ──────────────────────────────────────────────────────
    {"name": "BBC News",         "url": "https://feeds.bbci.co.uk/news/rss.xml",                    "category": "world"},
    {"name": "Reuters",          "url": "https://feeds.reuters.com/reuters/topNews",                  "category": "world"},
    {"name": "Al Jazeera",       "url": "https://www.aljazeera.com/xml/rss/all.xml",                 "category": "world"},
    {"name": "AP News",          "url": "https://feeds.apnews.com/rss/apf-topnews",                  "category": "world"},
    {"name": "NPR",              "url": "https://feeds.npr.org/1001/rss.xml",                        "category": "world"},
    {"name": "FOX News",         "url": "https://moxie.foxnews.com/google-publisher/latest.xml",     "category": "world"},

    # ── US National ───────────────────────────────────────────────────────────
    {"name": "NPR Politics",     "url": "https://feeds.npr.org/1014/rss.xml",                       "category": "us"},
    {"name": "NPR National",     "url": "https://feeds.npr.org/1003/rss.xml",                       "category": "us"},
    {"name": "FOX News US",      "url": "https://moxie.foxnews.com/google-publisher/us.xml",        "category": "us"},
    {"name": "PBS NewsHour",     "url": "https://www.pbs.org/newshour/feeds/rss/headlines",          "category": "us"},

    # ── Local — Central Arkansas ──────────────────────────────────────────────
    {"name": "THV11 (CBS AR)",   "url": "https://www.thv11.com/feeds/syndication/rss",              "category": "local"},
    {"name": "KARK 4 (NBC AR)",  "url": "https://www.kark.com/feed/",                               "category": "local"},
    {"name": "KATV (ABC AR)",    "url": "https://www.katv.com/feed/",                               "category": "local"},
    {"name": "Arkansas Online",  "url": "https://www.arkansasonline.com/feeds/rss/",                "category": "local"},

    # ── Technology ────────────────────────────────────────────────────────────
    {"name": "The Verge",        "url": "https://www.theverge.com/rss/index.xml",                   "category": "technology"},
    {"name": "Ars Technica",     "url": "https://feeds.arstechnica.com/arstechnica/index",           "category": "technology"},
    {"name": "Wired",            "url": "https://www.wired.com/feed/rss",                           "category": "technology"},
    {"name": "TechCrunch",       "url": "https://techcrunch.com/feed/",                             "category": "technology"},
    {"name": "Hacker News",      "url": "https://hnrss.org/frontpage",                              "category": "technology"},
    {"name": "MIT Tech Review",  "url": "https://www.technologyreview.com/topnews.rss",             "category": "technology"},

    # ── Business / Finance ────────────────────────────────────────────────────
    {"name": "BBC Business",     "url": "https://feeds.bbci.co.uk/news/business/rss.xml",            "category": "business"},
    {"name": "Reuters Business", "url": "https://feeds.reuters.com/reuters/businessNews",            "category": "business"},
    {"name": "Financial Times",  "url": "https://www.ft.com/rss/home",                             "category": "business"},
    {"name": "CNBC",             "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",    "category": "business"},
    {"name": "MarketWatch",      "url": "https://feeds.marketwatch.com/marketwatch/topstories/",    "category": "business"},

    # ── Sports — General ─────────────────────────────────────────────────────
    {"name": "ESPN Top",         "url": "https://www.espn.com/espn/rss/news",                       "category": "sports"},
    {"name": "BBC Sport",        "url": "https://feeds.bbci.co.uk/sport/rss.xml",                   "category": "sports"},
    {"name": "Sky Sports",       "url": "https://www.skysports.com/rss/12040",                      "category": "sports"},
    {"name": "Yahoo Sports",     "url": "https://sports.yahoo.com/top/rss.xml",                     "category": "sports"},

    # ── Sports — NFL ─────────────────────────────────────────────────────────
    {"name": "ESPN NFL",         "url": "https://www.espn.com/espn/rss/nfl/news",                   "category": "nfl"},
    {"name": "FOX Sports NFL",   "url": "https://api.foxsports.com/v1/rss?id=2",                    "category": "nfl"},
    {"name": "NFL.com",          "url": "https://www.nfl.com/rss/rsslanding.html",                  "category": "nfl"},

    # ── Sports — NBA ─────────────────────────────────────────────────────────
    {"name": "ESPN NBA",         "url": "https://www.espn.com/espn/rss/nba/news",                   "category": "nba"},
    {"name": "FOX Sports NBA",   "url": "https://api.foxsports.com/v1/rss?id=7",                    "category": "nba"},

    # ── Sports — MLB ─────────────────────────────────────────────────────────
    {"name": "ESPN MLB",         "url": "https://www.espn.com/espn/rss/mlb/news",                   "category": "mlb"},
    {"name": "FOX Sports MLB",   "url": "https://api.foxsports.com/v1/rss?id=4",                    "category": "mlb"},

    # ── Sports — NHL ─────────────────────────────────────────────────────────
    {"name": "ESPN NHL",         "url": "https://www.espn.com/espn/rss/nhl/news",                   "category": "nhl"},
    {"name": "FOX Sports NHL",   "url": "https://api.foxsports.com/v1/rss?id=5",                    "category": "nhl"},

    # ── Sports — NASCAR ───────────────────────────────────────────────────────
    {"name": "ESPN NASCAR",      "url": "https://www.espn.com/espn/rss/rpm/news",                   "category": "nascar"},
    {"name": "FOX Sports NASCAR","url": "https://api.foxsports.com/v1/rss?id=6",                    "category": "nascar"},

    # ── Entertainment ─────────────────────────────────────────────────────────
    {"name": "BBC Entertainment","url": "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", "category": "entertainment"},
    {"name": "The Guardian Arts","url": "https://www.theguardian.com/culture/rss",                  "category": "entertainment"},
    {"name": "Variety",          "url": "https://variety.com/feed/",                                "category": "entertainment"},
    {"name": "Hollywood Reporter","url": "https://www.hollywoodreporter.com/feed/",                 "category": "entertainment"},

    # ── Health ────────────────────────────────────────────────────────────────
    {"name": "BBC Health",       "url": "https://feeds.bbci.co.uk/news/health/rss.xml",             "category": "health"},
    {"name": "Reuters Health",   "url": "https://feeds.reuters.com/reuters/healthNews",             "category": "health"},
    {"name": "WebMD",            "url": "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC", "category": "health"},

    # ── Science ───────────────────────────────────────────────────────────────
    {"name": "New Scientist",    "url": "https://www.newscientist.com/feed/home/",                  "category": "science"},
    {"name": "NASA",             "url": "https://www.nasa.gov/rss/dyn/breaking_news.rss",           "category": "science"},
    {"name": "Science Daily",    "url": "https://www.sciencedaily.com/rss/top.xml",                 "category": "science"},
    {"name": "Space.com",        "url": "https://www.space.com/feeds/all",                          "category": "science"},
]

# Source categories with display metadata
SOURCE_CATEGORIES: Dict[str, Dict[str, str]] = {
    "world":         {"label": "World",              "icon": "public"},
    "us":            {"label": "US National",        "icon": "flag"},
    "local":         {"label": "Local (Arkansas)",   "icon": "location_on"},
    "technology":    {"label": "Technology",         "icon": "computer"},
    "business":      {"label": "Business",           "icon": "trending_up"},
    "sports":        {"label": "Sports — General",   "icon": "sports"},
    "nfl":           {"label": "Sports — NFL",       "icon": "sports_football"},
    "nba":           {"label": "Sports — NBA",       "icon": "sports_basketball"},
    "mlb":           {"label": "Sports — MLB",       "icon": "sports_baseball"},
    "nhl":           {"label": "Sports — NHL",       "icon": "sports_hockey"},
    "nascar":        {"label": "Sports — NASCAR",    "icon": "speed"},
    "entertainment": {"label": "Entertainment",      "icon": "movie"},
    "health":        {"label": "Health",             "icon": "health_and_safety"},
    "science":       {"label": "Science",            "icon": "science"},
}

_NEWSAPI_BASE      = "https://newsapi.org/v2"
_WORLD_NEWS_BASE   = "https://api.worldnewsapi.com"
_APITUBE_BASE      = "https://apitube.io/v1/news"
_MEDIASTACK_BASE   = "http://api.mediastack.com/v1/news"


async def fetch_rss_feed(url: str, source_name: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch and parse a single RSS feed URL, returning up to `limit` articles."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            content = resp.text
    except Exception as exc:
        logger.warning("RSS fetch failed for %s: %s", url, exc)
        return []

    # Minimal RSS/Atom parser — avoids needing feedparser for the happy path
    articles: List[Dict[str, Any]] = []
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        logger.warning("RSS parse error for %s: %s", url, exc)
        return []

    # RSS 2.0
    items = root.findall(".//item")
    for item in items[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc = (item.findtext("description") or "").strip()
        pub = item.findtext("pubDate") or ""
        articles.append({
            "id": _article_id(link),
            "title": title,
            "summary": _strip_html(desc)[:300],
            "url": link,
            "source": source_name,
            "published_at": _parse_date(pub),
            "image_url": _extract_image(item, desc),
        })

    # Atom
    if not items:
        entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")
        for entry in entries[:limit]:
            title = (entry.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
            link_el = entry.find("{http://www.w3.org/2005/Atom}link")
            link = (link_el.get("href") if link_el is not None else "") or ""
            summary_raw = (entry.findtext("{http://www.w3.org/2005/Atom}summary") or "").strip()
            content_raw = (entry.findtext("{http://www.w3.org/2005/Atom}content") or "").strip()
            pub = entry.findtext("{http://www.w3.org/2005/Atom}updated") or ""
            img = _extract_image(entry, summary_raw or content_raw)
            articles.append({
                "id": _article_id(link),
                "title": title,
                "summary": _strip_html(summary_raw or content_raw)[:300],
                "url": link,
                "source": source_name,
                "published_at": _parse_date(pub),
                "image_url": img,
            })

    return articles


async def fetch_newsapi(api_key: str, category: str = "general", country: str = "gb", limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch top headlines from NewsAPI.org (requires a key)."""
    if not api_key:
        return []
    params = {
        "apiKey": api_key,
        "category": category,
        "country": country,
        "pageSize": limit,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_NEWSAPI_BASE}/top-headlines", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("NewsAPI fetch failed: %s", exc)
        return []

    articles = []
    for a in data.get("articles", []):
        url = a.get("url") or ""
        articles.append({
            "id": _article_id(url),
            "title": a.get("title") or "",
            "summary": (a.get("description") or "")[:300],
            "url": url,
            "source": (a.get("source") or {}).get("name") or "NewsAPI",
            "published_at": _parse_date(a.get("publishedAt") or ""),
            "image_url": a.get("urlToImage") or "",
            "category": category,
        })
    return articles


async def fetch_world_news(api_key: str, language: str = "en", limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch top headlines from World News API (worldnewsapi.com)."""
    if not api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_WORLD_NEWS_BASE}/search-news", params={
                "api-key": api_key,
                "language": language,
                "number": limit,
                "sort": "publish-time",
                "sort-direction": "DESC",
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("World News API fetch failed: %s", exc)
        return []

    articles = []
    for a in data.get("news", []):
        url = a.get("url") or ""
        articles.append({
            "id": _article_id(url),
            "title": a.get("title") or "",
            "summary": (a.get("text") or "")[:300],
            "url": url,
            "source": a.get("source", {}).get("name") or "World News",
            "published_at": _parse_date(a.get("publish_date") or ""),
            "image_url": a.get("image") or "",
            "category": "world",
        })
    return articles


async def fetch_apitube(api_key: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch headlines from APITube (apitube.io) — 200 free req/day."""
    if not api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_APITUBE_BASE, params={
                "api_key": api_key,
                "language": "en",
                "count": limit,
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("APITube fetch failed: %s", exc)
        return []

    articles = []
    for a in data.get("articles", []):
        url = a.get("url") or ""
        articles.append({
            "id": _article_id(url),
            "title": a.get("title") or "",
            "summary": (a.get("description") or "")[:300],
            "url": url,
            "source": a.get("source_name") or "APITube",
            "published_at": _parse_date(a.get("published_at") or ""),
            "image_url": a.get("image_url") or "",
            "category": "world",
        })
    return articles


async def fetch_mediastack(api_key: str, categories: str = "general", limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch headlines from Mediastack (mediastack.com) — 100 free req/month."""
    if not api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_MEDIASTACK_BASE, params={
                "access_key": api_key,
                "categories": categories,
                "languages": "en",
                "limit": limit,
                "sort": "published_desc",
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Mediastack fetch failed: %s", exc)
        return []

    articles = []
    for a in data.get("data", []):
        url = a.get("url") or ""
        articles.append({
            "id": _article_id(url),
            "title": a.get("title") or "",
            "summary": (a.get("description") or "")[:300],
            "url": url,
            "source": a.get("source") or "Mediastack",
            "published_at": _parse_date(a.get("published_at") or ""),
            "image_url": a.get("image") or "",
            "category": a.get("category") or "general",
        })
    return articles


async def fetch_articles(
    sources: List[Dict[str, str]],
    newsapi_key: str = "",
    world_news_key: str = "",
    apitube_key: str = "",
    mediastack_key: str = "",
    limit_per_source: int = 8,
) -> List[Dict[str, Any]]:
    """
    Fetch articles from a list of source dicts.
    Each source dict: {"name": str, "url": str, "category": str}
    """
    import asyncio
    tasks = []
    meta = []  # track category per task
    for src in sources:
        if src.get("url"):
            tasks.append(fetch_rss_feed(src["url"], src["name"], limit_per_source))
            meta.append(src.get("category", "general"))
        elif newsapi_key and src.get("category"):
            tasks.append(fetch_newsapi(newsapi_key, src["category"], limit=limit_per_source))
            meta.append(src.get("category", "general"))
    if not tasks:
        return []
    results = await asyncio.gather(*tasks, return_exceptions=True)
    articles: List[Dict[str, Any]] = []
    for r, category in zip(results, meta):
        if isinstance(r, list):
            for a in r:
                a.setdefault("category", category)
            articles.extend(r)
    articles.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    return articles


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _article_id(url: str) -> str:
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:12]


def _extract_image(element, html_text: str = "") -> str:
    """
    Try multiple strategies to find an image URL for an RSS item/entry element.
    Returns the first found URL, or "" if none.
    """
    import xml.etree.ElementTree as ET
    import re

    # 1. media:thumbnail (BBC, many news sites)
    ns_media = "http://search.yahoo.com/mrss/"
    thumb = element.find(f"{{{ns_media}}}thumbnail")
    if thumb is not None:
        url = thumb.get("url") or ""
        if url:
            return url

    # 2. media:content (common alt tag)
    content_el = element.find(f"{{{ns_media}}}content")
    if content_el is not None:
        url = content_el.get("url") or ""
        if url and any(ext in url.lower() for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
            return url

    # 3. enclosure (podcasts / TechCrunch style)
    enc = element.find("enclosure")
    if enc is not None:
        mime = enc.get("type") or ""
        url = enc.get("url") or ""
        if "image" in mime and url:
            return url

    # 4. img tag inside description/content HTML
    if html_text:
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html_text)
        if m:
            return m.group(1)

    return ""


def _strip_html(text: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", text).strip()


def _parse_date(raw: str) -> str:
    """Return ISO-8601 UTC string, or raw string if unparseable."""
    if not raw:
        return ""
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
    ):
        try:
            dt = datetime.strptime(raw.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return raw
