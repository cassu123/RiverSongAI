import asyncio
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import httpx
from config.settings import get_settings

logger = logging.getLogger(__name__)

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
NEOWS_URL = "https://api.nasa.gov/neo/rest/v1/feed"
OCEARCH_JSON_URL = "https://www.ocearch.org/api/sharks"

_cache_eonet: Dict[str, Any] = {}
_cache_neows: Dict[str, Any] = {}
_cache_ocearch: Dict[str, Any] = {}
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

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def _eonet_color(category: str) -> str:
    category = category.lower()
    if "wildfire" in category: return "#ff4400"
    if "volcano" in category: return "#cc0000"
    if "storm" in category: return "#ff8800"
    if "ice" in category: return "#3366cc"
    if "earthquake" in category: return "#990066"
    return "#888888"

async def _fetch_eonet(lat: float, lon: float) -> list[Dict[str, Any]]:
    ckey = f"{round(lat, 1)}_{round(lon, 1)}"
    cached = _get_cached(_cache_eonet, ckey, 1800)
    if cached is not None:
        return cached

    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(EONET_URL, params={"status": "open", "days": 7, "limit": 20})
            if res.status_code == 200:
                data = res.json()
                for event in data.get("events", []):
                    geoms = event.get("geometry", [])
                    if not geoms:
                        continue
                    # Most recent geometry
                    geom = sorted(geoms, key=lambda g: g.get("date", ""), reverse=True)[0]
                    coords = geom.get("coordinates")
                    # coords is [lon, lat] for points, or polygon. We assume point or use first
                    if isinstance(coords, list) and len(coords) >= 2:
                        # flatten if polygon
                        if isinstance(coords[0], list):
                            c = coords[0][0]
                            while isinstance(c, list):
                                c = c[0]
                            elat, elon = coords[0][0][1], coords[0][0][0]  # naive extraction
                            try:
                                elon, elat = float(coords[0][0][0]), float(coords[0][0][1])
                            except:
                                continue
                        else:
                            elon, elat = float(coords[0]), float(coords[1])
                        
                        dist = _haversine(lat, lon, elat, elon)
                        cat = event.get("categories", [{}])[0].get("title", "Unknown")
                        results.append({
                            "id": event.get("id"),
                            "title": event.get("title"),
                            "category": cat,
                            "category_color": _eonet_color(cat),
                            "date": geom.get("date"),
                            "lat": elat,
                            "lon": elon,
                            "distance_mi": int(dist),
                            "source_url": event.get("sources", [{}])[0].get("url", "")
                        })
                results.sort(key=lambda x: x["distance_mi"])
    except Exception as e:
        logger.warning(f"EONET fetch failed: {e}")
    
    _set_cached(_cache_eonet, ckey, results)
    return results

async def _fetch_neows() -> list[Dict[str, Any]]:
    ckey = "neows_global"
    cached = _get_cached(_cache_neows, ckey, 1800)
    if cached is not None:
        return cached

    results = []
    try:
        api_key = getattr(get_settings(), "nasa_api_key", os.getenv("NASA_API_KEY", "DEMO_KEY"))
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(NEOWS_URL, params={"start_date": today, "api_key": api_key})
            if res.status_code == 200:
                data = res.json()
                neos = data.get("near_earth_objects", {})
                all_neos = []
                for date_key, arr in neos.items():
                    all_neos.extend(arr)
                
                for neo in all_neos:
                    ca = neo.get("close_approach_data", [{}])[0]
                    results.append({
                        "id": neo.get("id"),
                        "name": neo.get("name"),
                        "diameter_m": int(neo.get("estimated_diameter", {}).get("meters", {}).get("estimated_diameter_max", 0)),
                        "velocity_kph": int(float(ca.get("relative_velocity", {}).get("kilometers_per_hour", 0))),
                        "miss_distance_km": int(float(ca.get("miss_distance", {}).get("kilometers", 0))),
                        "miss_distance_lunar": float(ca.get("miss_distance", {}).get("lunar", 0)),
                        "approach_date": ca.get("epoch_date_close_approach"),
                        "hazardous": neo.get("is_potentially_hazardous_asteroid", False)
                    })
                # approach_date is a unix timestamp in ms
                results.sort(key=lambda x: x["approach_date"])
                for r in results:
                    if isinstance(r["approach_date"], (int, float)):
                        r["approach_date"] = datetime.fromtimestamp(r["approach_date"]/1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                results = results[:5]
    except Exception as e:
        logger.warning(f"NeoWs fetch failed: {e}")

    _set_cached(_cache_neows, ckey, results)
    return results

async def _fetch_ocearch(lat: float, lon: float) -> list[Dict[str, Any]]:
    ckey = f"{round(lat, 1)}_{round(lon, 1)}"
    cached = _get_cached(_cache_ocearch, ckey, 1800)
    if cached is not None:
        return cached

    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(OCEARCH_JSON_URL)
            if res.status_code == 200:
                data = res.json()
                # If it's a list, process it
                if isinstance(data, list):
                    for shark in data:
                        slat = shark.get("lat")
                        slon = shark.get("lon")
                        if slat is None or slon is None:
                            continue
                        dist = _haversine(lat, lon, float(slat), float(slon))
                        results.append({
                            "id": str(shark.get("id")),
                            "name": shark.get("name"),
                            "species": shark.get("species"),
                            "length_ft": shark.get("length"),
                            "weight_lb": shark.get("weight"),
                            "last_ping": shark.get("date"),
                            "lat": float(slat),
                            "lon": float(slon),
                            "distance_mi": int(dist)
                        })
                    results.sort(key=lambda x: x["distance_mi"])
                    results = results[:20]
    except Exception as e:
        logger.warning(f"OCEARCH fetch failed: {e}")

    _set_cached(_cache_ocearch, ckey, results)
    return results

async def fetch_earth(lat: float, lon: float) -> dict[str, Any]:
    eonet_task = _fetch_eonet(lat, lon)
    neows_task = _fetch_neows()
    ocearch_task = _fetch_ocearch(lat, lon)

    eonet, neows, ocearch = await asyncio.gather(eonet_task, neows_task, ocearch_task)

    return {
        "eonet": eonet,
        "neows": neows,
        "ocearch": ocearch,
        "timestamp": _now_iso(),
        "cached": False
    }
