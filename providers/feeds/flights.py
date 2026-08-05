"""
providers/feeds/flights.py

ADS-B Exchange flight tracking via RapidAPI.
Replaces OpenSky Network implementation.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional
import os

import httpx

logger = logging.getLogger(__name__)

ADSBX_URL = "https://adsbexchange-com1.p.rapidapi.com/v2/lat/{lat}/lon/{lon}/dist/{nm}/"

_CACHE_TTL = 60  # seconds

_cache: dict[tuple, tuple[dict, float]] = {}  # key → (result, expires_at)


def _cache_key(lat: float, lon: float, radius: float) -> tuple:
    return (round(lat, 3), round(lon, 3), round(radius, 2))


def _get_cached(key: tuple) -> Optional[dict]:
    entry = _cache.get(key)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def _set_cached(key: tuple, value: dict) -> None:
    if len(_cache) > 1000:
        now = time.monotonic()
        expired = [k for k, v in _cache.items() if v[1] <= now]
        for k in expired:
            del _cache[k]
        if len(_cache) > 1000:
            _cache.clear()
    _cache[key] = (value, time.monotonic() + _CACHE_TTL)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def fetch_overhead(
    lat: Optional[float],
    lon: Optional[float],
    radius_deg: float = 0.5,
    **_,
) -> dict[str, Any]:
    """
    Return aircraft within `radius_deg` degrees of the given coordinates.
    Normalises the raw ADS-B Exchange states array into clean field names.
    Caches results for 60 s.

    Returns:
        { aircraft: [...], cached: bool, timestamp: str }
    """
    if lat is None or lon is None:
        return {"aircraft": [], "cached": False, "timestamp": _now_iso()}

    key = _cache_key(lat, lon, radius_deg)
    cached = _get_cached(key)
    if cached is not None:
        logger.debug("ADSBx cache hit for key %s", key)
        return {**cached, "cached": True}

    # Load key from settings/env
    from config.settings import get_settings
    settings = get_settings()
    api_key = getattr(
        settings,
        "adsbx_rapidapi_key",
        os.getenv("ADSBX_RAPIDAPI_KEY"))

    if not api_key:
        return {"aircraft": [], "cached": False, "timestamp": _now_iso()}

    nm = max(1, int(round(radius_deg * 60)))
    url = ADSBX_URL.format(lat=lat, lon=lon, nm=nm)
    headers = {
        "X-RapidAPI-Key": api_key,
        "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com"
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("ADSBx fetch failed: %s", exc)
        return {"aircraft": [], "cached": False, "timestamp": _now_iso()}

    ac_list = data.get("ac") or []
    aircraft: list[dict] = []
    for s in ac_list[:50]:
        callsign = (s.get("flight") or "").strip()
        reg = (s.get("r") or "").strip()
        type_name = (s.get("desc") or "").strip()   # e.g. "BOEING 737-800"
        # owner/operator when ADSBx has it
        operator = (s.get("ownOp") or "").strip()

        mil = bool(s.get("mil"))
        if mil:
            cat = "military"
        elif callsign.startswith(("LE", "POL")):
            cat = "government"
        elif reg.startswith("N") and not operator:
            cat = "private"
        elif operator:
            cat = "commercial"
        else:
            cat = "unknown"

        alt_raw = s.get("alt_baro")
        if isinstance(alt_raw, str) and alt_raw.lower() == "ground":
            alt_val = 0
            on_ground = True
        else:
            on_ground = False
            try:
                # type: ignore
                alt_val = int(alt_raw) if alt_raw is not None else None  # type: ignore
            except (TypeError, ValueError):
                alt_val = None

        vel = s.get("gs")
        heading = s.get("track")

        aircraft.append({
            "icao24": s.get("hex"),
            "callsign": callsign or None,
            "origin_country": None,                   # ADSBx does not expose this directly
            "longitude": s.get("lon"),
            "latitude": s.get("lat"),
            "altitude_ft": alt_val,
            "on_ground": on_ground,
            "velocity_kts": float(vel) if vel is not None else None,
            "heading_deg": float(heading) if heading is not None else None,

            "registration": reg or None,
            "operator": operator or None,
            "type_code": s.get("t"),
            "type_name": type_name or None,
            "category": cat,
            "squawk": s.get("squawk"),
            "emergency": bool(s.get("emergency")),
            "interesting": mil or cat in ("military", "government"),
        })

    ts = _now_iso()
    result = {"aircraft": aircraft, "timestamp": ts}
    _set_cached(key, result)
    return {**result, "cached": False}
