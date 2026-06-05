import asyncio
import logging
import math
import os
import time
import base64
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from config.settings import get_settings

logger = logging.getLogger(__name__)

HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item/{id}.json"
REDDIT_AUTH_URL = "https://www.reddit.com/api/v1/access_token"
EVENTBRITE_URL = "https://www.eventbriteapi.com/v3/events/search/"

_cache_hn: Dict[str, Any] = {}
_cache_reddit: Dict[str, Any] = {}
_cache_eb: Dict[str, Any] = {}
_cache_reddit_token: Dict[str, Any] = {}
CACHE_MAX_ENTRIES = 1000


def _get_cached(cache_dict: dict, key: str, ttl: int) -> Any:
    entry = cache_dict.get(key)
    if entry and time.time() - entry["ts"] < ttl:
        return entry["data"]
    return None


def _set_cached(cache_dict: dict, key: str, data: Any):
    if len(cache_dict) >= CACHE_MAX_ENTRIES:
        oldest = min(cache_dict.keys(), key=lambda k: cache_dict[k]["ts"])
        del cache_dict[oldest]
    cache_dict[key] = {"data": data, "ts": time.time()}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _fetch_hn() -> list[Dict[str, Any]]:
    ckey = "hn_top"
    cached = _get_cached(_cache_hn, ckey, 300)
    if cached is not None:
        return cached

    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(HN_TOP_URL)
            if res.status_code == 200:
                top_ids = res.json()[:15]

                async def fetch_item(item_id):
                    r = await client.get(HN_ITEM_URL.format(id=item_id))
                    if r.status_code == 200:
                        return r.json()
                    return None

                items = await asyncio.gather(*(fetch_item(i) for i in top_ids))
                for item in items:
                    if not item:
                        continue
                    results.append({
                        "source": "hackernews",
                        "id": str(item.get("id")),
                        "title": item.get("title"),
                        "url": item.get("url") or f"https://news.ycombinator.com/item?id={item.get('id')}",
                        "score": item.get("score", 0),
                        "comments": item.get("descendants", 0),
                        "author": item.get("by"),
                        "posted_at": datetime.fromtimestamp(item.get("time", 0), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                        "subreddit": None,
                        "image_url": None
                    })
    except Exception as e:
        logger.warning(f"Hacker News fetch failed: {e}")

    _set_cached(_cache_hn, ckey, results)
    return results


async def _get_reddit_token() -> str:
    ckey = "reddit_token"
    cached = _get_cached(_cache_reddit_token, ckey, 3000)
    if cached:
        return cached

    s = get_settings()
    client_id = getattr(s, "reddit_client_id", os.getenv("REDDIT_CLIENT_ID"))
    client_secret = getattr(
        s,
        "reddit_client_secret",
        os.getenv("REDDIT_CLIENT_SECRET"))
    if not client_id or not client_secret:
        return ""

    try:
        auth_str = f"{client_id}:{client_secret}"
        b64_auth = base64.b64encode(auth_str.encode()).decode()
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                REDDIT_AUTH_URL,
                data={"grant_type": "client_credentials"},
                headers={
                    "Authorization": f"Basic {b64_auth}",
                    "User-Agent": getattr(s, "reddit_user_agent", os.getenv("REDDIT_USER_AGENT", "RiverSongAI/1.0"))
                }
            )
            if res.status_code == 200:
                token = res.json().get("access_token")
                _set_cached(_cache_reddit_token, ckey, token)
                return token
    except Exception as e:
        logger.warning(f"Reddit auth failed: {e}")
    return ""


async def _fetch_reddit(subs: list[str]) -> list[Dict[str, Any]]:
    subs_str = "+".join(subs) if subs else "all"
    ckey = f"reddit_{subs_str}"
    cached = _get_cached(_cache_reddit, ckey, 300)
    if cached is not None:
        return cached

    token = await _get_reddit_token()
    if not token:
        return []

    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"https://oauth.reddit.com/r/{subs_str}/rising",
                params={"limit": 15},
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": getattr(get_settings(), "reddit_user_agent", os.getenv("REDDIT_USER_AGENT", "RiverSongAI/1.0"))
                }
            )
            if res.status_code == 200:
                posts = res.json().get("data", {}).get("children", [])
                for p in posts:
                    d = p.get("data", {})
                    img_url = None
                    preview = d.get("preview", {}).get("images", [])
                    if preview:
                        img_url = preview[0].get(
                            "source",
                            {}).get(
                            "url",
                            "").replace(
                            "&amp;",
                            "&")

                    results.append({
                        "source": "reddit",
                        "id": d.get("id"),
                        "title": d.get("title"),
                        "url": "https://reddit.com" + d.get("permalink", "") if d.get("permalink") else d.get("url"),
                        "score": d.get("score", 0),
                        "comments": d.get("num_comments", 0),
                        "author": d.get("author"),
                        "posted_at": datetime.fromtimestamp(d.get("created_utc", 0), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                        "subreddit": d.get("subreddit"),
                        "image_url": img_url
                    })
    except Exception as e:
        logger.warning(f"Reddit fetch failed: {e}")

    _set_cached(_cache_reddit, ckey, results)
    return results


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * \
        math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _fetch_eventbrite(
        lat: Optional[float], lon: Optional[float], radius_mi: int) -> list[Dict[str, Any]]:
    if lat is None or lon is None:
        return []
    ckey = f"{round(lat, 2)}_{round(lon, 2)}_{radius_mi}"
    cached = _get_cached(_cache_eb, ckey, 900)
    if cached is not None:
        return cached

    eb_token = getattr(
        get_settings(),
        "eventbrite_oauth_token",
        os.getenv("EVENTBRITE_OAUTH_TOKEN"))
    if not eb_token:
        return []

    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                EVENTBRITE_URL,
                params={
                    "location.latitude": lat,
                    "location.longitude": lon,
                    "location.within": f"{radius_mi}mi",
                    "expand": "venue,ticket_classes",
                    "sort_by": "date",
                    "token": eb_token
                }
            )
            if res.status_code == 200:
                events = res.json().get("events", [])
                for e in events:
                    v = e.get("venue", {})
                    vlat, vlon = v.get("latitude"), v.get("longitude")
                    dist = 0
                    if vlat and vlon:
                        dist = _haversine(
                            lat, lon, float(vlat), float(vlon))  # type: ignore

                    tcs = e.get("ticket_classes", [])
                    prices = [
                        float(
                            tc.get(
                                "cost",
                                {}).get(
                                "major_value",
                                0)) for tc in tcs if tc.get("cost")]
                    pmin = min(prices) if prices else 0.0
                    pmax = max(prices) if prices else 0.0

                    results.append({
                        "source": "eventbrite",
                        "id": e.get("id"),
                        "title": e.get("name", {}).get("text"),
                        "url": e.get("url"),
                        "venue": v.get("name"),
                        "city": v.get("address", {}).get("city"),
                        "lat": float(vlat) if vlat else None,
                        "lon": float(vlon) if vlon else None,
                        "distance_mi": round(dist, 1),
                        "start_time": e.get("start", {}).get("utc"),
                        "price_min": pmin,
                        "price_max": pmax,
                        "image_url": e.get("logo", {}).get("url") if e.get("logo") else None
                    })
    except Exception as e:
        logger.warning(f"Eventbrite fetch failed: {e}")

    _set_cached(_cache_eb, ckey, results)
    return results


async def fetch_happenings(lat: float | None, lon: float | None,
                           subs: list[str], radius_mi: int = 25) -> dict[str, Any]:
    hn_task = _fetch_hn()
    reddit_task = _fetch_reddit(subs)
    eb_task = _fetch_eventbrite(lat, lon, radius_mi)

    hn, reddit, eb = await asyncio.gather(hn_task, reddit_task, eb_task)

    trending = []
    seen_urls = set()

    for item in hn + reddit:
        url = item.get("url")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        trending.append(item)

    return {
        "trending": trending,
        "events_nearby": eb,
        "timestamp": _now_iso(),
        "cached": False
    }
