"""
providers/feeds/flights.py

OpenSky Network ADS-B flight tracking — free anonymous API.
No key required, rate-limited to ~400 queries/day for anonymous users.

API: https://opensky-network.org/api/states/all?lamin=...&lamax=...&lomin=...&lomax=...

60-second in-process cache prevents cap exhaustion at polling intervals.
Cache key: (lat_rounded, lon_rounded, radius_rounded) — filter_status applied after.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

OPENSKY_URL = "https://opensky-network.org/api/states/all"

_MPS_TO_KTS = 1.94384
_M_TO_FT    = 3.28084
_CACHE_TTL  = 60  # seconds

_cache: dict[tuple, tuple[dict, float]] = {}  # key → (result, expires_at)


def _cache_key(lat: float, lon: float, radius: float) -> tuple:
    return (round(lat, 3), round(lon, 3), round(radius, 2))


def _get_cached(key: tuple) -> Optional[dict]:
    entry = _cache.get(key)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def _set_cached(key: tuple, value: dict) -> None:
    _cache[key] = (value, time.monotonic() + _CACHE_TTL)


async def fetch_overhead(
    lat: Optional[float],
    lon: Optional[float],
    radius_deg: float = 0.5,
    **_,
) -> dict[str, Any]:
    """
    Return aircraft within `radius_deg` degrees of the given coordinates.
    Normalises the raw OpenSky states array into clean field names.
    Caches results for 60 s to protect the anonymous quota (~400/day).

    Returns:
        { aircraft: [...], cached: bool, timestamp: str }
    """
    if lat is None or lon is None:
        return {"aircraft": [], "cached": False, "timestamp": _now_iso()}

    key = _cache_key(lat, lon, radius_deg)
    cached = _get_cached(key)
    if cached is not None:
        logger.debug("OpenSky cache hit for key %s", key)
        return {**cached, "cached": True}

    params = {
        "lamin": lat - radius_deg,
        "lamax": lat + radius_deg,
        "lomin": lon - radius_deg,
        "lomax": lon + radius_deg,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(OPENSKY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("OpenSky fetch failed: %s", exc)
        return {"aircraft": [], "cached": False, "timestamp": _now_iso()}

    states = data.get("states") or []
    aircraft: list[dict] = []
    for s in states[:50]:  # cap at 50 to bound memory
        try:
            alt_m = s[7]
            vel_mps = s[9]
            aircraft.append({
                "icao24":         s[0],
                "callsign":       (s[1] or "").strip() or None,
                "origin_country": s[2],
                "longitude":      s[5],
                "latitude":       s[6],
                "altitude_ft":    round(alt_m * _M_TO_FT) if alt_m is not None else None,
                "on_ground":      bool(s[8]),
                "velocity_kts":   round(vel_mps * _MPS_TO_KTS, 1) if vel_mps is not None else None,
                "heading_deg":    s[10],
            })
        except (IndexError, TypeError):
            continue

    ts = _now_iso()
    result = {"aircraft": aircraft, "timestamp": ts}
    _set_cached(key, result)
    return {**result, "cached": False}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
