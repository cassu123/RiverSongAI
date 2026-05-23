"""
providers/feeds/flights.py

OpenSky Network ADS-B flight tracking — free anonymous API.
No key required, rate-limited to ~400 queries/day for anonymous users.

API: https://opensky-network.org/api/states/all?lamin=...&lamax=...&lomin=...&lomax=...

Returns flights within a bounding box around the configured location.
If LOCATION_LAT/LOCATION_LON are unset, returns [].
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

OPENSKY_URL = "https://opensky-network.org/api/states/all"


async def fetch_overhead(lat: Optional[float], lon: Optional[float], radius_deg: float = 0.5, **_) -> list[dict]:
    """
    Return flights within roughly `radius_deg` degrees of the given coordinates.
    Returns an empty list if coordinates are missing or the API call fails.
    """
    if lat is None or lon is None:
        return []
    params = {
        "lamin": lat - radius_deg, "lamax": lat + radius_deg,
        "lomin": lon - radius_deg, "lomax": lon + radius_deg,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(OPENSKY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"OpenSky fetch failed: {e}")
        return []

    states = data.get("states") or []
    result = []
    for s in states[:50]:  # cap at 50 to bound memory
        try:
            result.append({
                "icao24": s[0],
                "callsign": (s[1] or "").strip(),
                "country": s[2],
                "lon": s[5],
                "lat": s[6],
                "baro_altitude_m": s[7],
                "on_ground": bool(s[8]),
                "velocity_mps": s[9],
                "true_track_deg": s[10],
            })
        except (IndexError, TypeError):
            continue
    return result
