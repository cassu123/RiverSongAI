"""
providers/feeds/weather.py

Weather provider using Open-Meteo (https://open-meteo.com).
No API key required. Returns current conditions + 7-day daily forecast.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_BASE     = "https://api.open-meteo.com/v1/forecast"
_AQI_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality"
_NWS_BASE = "https://api.weather.gov"

_NWS_SEVERITY_COLORS = {
    "Extreme":  "#cc0000",
    "Severe":   "#ff4400",
    "Moderate": "#ff8800",
    "Minor":    "#ffcc00",
    "Unknown":  "#888888",
}

_AQI_LEVELS = [
    (50,  "Good",                    "#00cc44"),
    (100, "Moderate",                "#ffcc00"),
    (150, "Unhealthy for Sensitive", "#ff8800"),
    (200, "Unhealthy",               "#ff3300"),
    (300, "Very Unhealthy",          "#9933cc"),
    (999, "Hazardous",               "#7a0000"),
]

# WMO weather interpretation codes → human-readable description
_WMO_CODES: Dict[int, str] = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}


async def fetch_weather(
    lat: float,
    lon: float,
    unit: str = "celsius",
) -> Dict[str, Any]:
    """
    Fetch current conditions and 7-day forecast for the given coordinates.

    Args:
        lat: Latitude
        lon: Longitude
        unit: "celsius" or "fahrenheit"

    Returns dict with keys: current, daily, unit
    """
    temp_unit = "celsius" if unit == "celsius" else "fahrenheit"
    wind_unit = "kmh"

    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join([
            "temperature_2m",
            "apparent_temperature",
            "weathercode",
            "windspeed_10m",
            "winddirection_10m",
            "windgusts_10m",
            "relative_humidity_2m",
            "precipitation",
            "uv_index",
            "visibility",
        ]),
        "hourly": ",".join([
            "temperature_2m",
            "weathercode",
            "precipitation_probability",
            "precipitation",
            "windspeed_10m",
        ]),
        "daily": ",".join([
            "weathercode",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "windspeed_10m_max",
            "uv_index_max",
            "sunrise",
            "sunset",
        ]),
        "temperature_unit": temp_unit,
        "wind_speed_unit": wind_unit,
        "timezone": "auto",
        "forecast_days": 7,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("Open-Meteo fetch failed: %s", exc)
        raise

    current_raw = data.get("current", {})
    hourly_raw = data.get("hourly", {})
    daily_raw = data.get("daily", {})
    unit_sym = "°C" if temp_unit == "celsius" else "°F"

    current = {
        "temperature": current_raw.get("temperature_2m"),
        "feels_like": current_raw.get("apparent_temperature"),
        "condition": _WMO_CODES.get(current_raw.get("weathercode", -1), "Unknown"),
        "weathercode": current_raw.get("weathercode"),
        "wind_speed": current_raw.get("windspeed_10m"),
        "wind_direction": current_raw.get("winddirection_10m"),
        "wind_gusts": current_raw.get("windgusts_10m"),
        "humidity": current_raw.get("relative_humidity_2m"),
        "precipitation": current_raw.get("precipitation"),
        "uv_index": current_raw.get("uv_index"),
        "visibility": current_raw.get("visibility"),  # metres
        "unit": unit_sym,
        "wind_unit": "km/h",
    }

    # Hourly — next 24 hours only
    hourly_times = hourly_raw.get("time", [])
    hourly_temps = hourly_raw.get("temperature_2m", [])
    hourly_codes = hourly_raw.get("weathercode", [])
    hourly_precip_prob = hourly_raw.get("precipitation_probability", [])
    hourly_precip = hourly_raw.get("precipitation", [])
    hourly_wind = hourly_raw.get("windspeed_10m", [])

    # Find index of current hour to slice next 24
    from datetime import datetime as _dt
    now_str = current_raw.get("time", "")
    start_idx = 0
    if now_str and hourly_times:
        for i, t in enumerate(hourly_times):
            if t >= now_str[:13]:  # match "YYYY-MM-DDTHH"
                start_idx = i
                break

    hourly: list = []
    for i in range(start_idx, min(start_idx + 24, len(hourly_times))):
        hourly.append({
            "time": hourly_times[i],
            "temperature": hourly_temps[i] if i < len(hourly_temps) else None,
            "condition": _WMO_CODES.get(hourly_codes[i] if i < len(hourly_codes) else -1, ""),
            "weathercode": hourly_codes[i] if i < len(hourly_codes) else None,
            "precip_prob": hourly_precip_prob[i] if i < len(hourly_precip_prob) else None,
            "precipitation": hourly_precip[i] if i < len(hourly_precip) else None,
            "wind_speed": hourly_wind[i] if i < len(hourly_wind) else None,
        })

    def _daily_val(key: str, idx: int):
        arr = daily_raw.get(key) or []
        return arr[idx] if idx < len(arr) else None

    dates = daily_raw.get("time", [])
    daily: List[Dict[str, Any]] = []
    for i, date in enumerate(dates):
        daily.append({
            "date": date,
            "condition": _WMO_CODES.get(_daily_val("weathercode", i) or -1, "Unknown"),
            "weathercode": _daily_val("weathercode", i),
            "temp_max": _daily_val("temperature_2m_max", i),
            "temp_min": _daily_val("temperature_2m_min", i),
            "precipitation": _daily_val("precipitation_sum", i),
            "wind_max": _daily_val("windspeed_10m_max", i),
            "uv_index_max": _daily_val("uv_index_max", i),
            "sunrise": _daily_val("sunrise", i),
            "sunset": _daily_val("sunset", i),
        })

    import asyncio as _asyncio
    air_quality, location_name = await _asyncio.gather(
        fetch_air_quality(lat, lon),
        _reverse_geocode(lat, lon),
        return_exceptions=True,
    )
    if isinstance(air_quality, Exception):
        air_quality = {}
    if isinstance(location_name, Exception):
        location_name = ""

    return {
        "current": current,
        "hourly": hourly,
        "daily": daily,
        "air_quality": air_quality,
        "unit": unit_sym,
        "timezone": data.get("timezone"),
        "lat": lat,
        "lon": lon,
        "location_name": location_name,
    }


async def get_weather_report(lat: float, lon: float, units: str = "celsius") -> str:
    """
    Fetch weather and return a concise text summary for the LLM tool.
    """
    data = await fetch_weather(lat, lon, unit=units)
    curr = data["current"]
    unit_sym = curr["unit"]
    
    report = f"The current weather is {curr['condition'].lower()} at {curr['temperature']}{unit_sym}. "
    report += f"Wind speed is {curr['wind_speed']} km/h."
    
    if data["daily"]:
        today = data["daily"][0]
        report += f" Expect a high of {today['temp_max']}{unit_sym} and a low of {today['temp_min']}{unit_sym} today."
        
    return report


async def _reverse_geocode(lat: float, lon: float) -> str:
    """Return a short human-readable location name via Nominatim (no key needed)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 10},
                headers={"User-Agent": "RiverSongAI/1.0 (riversongai.com)"},
            )
            resp.raise_for_status()
            addr = resp.json().get("address", {})
        parts = [
            addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county"),
            addr.get("state"),
        ]
        return ", ".join(p for p in parts if p)
    except Exception as exc:
        logger.debug("Reverse geocode failed: %s", exc)
        return ""


async def fetch_air_quality(lat: float, lon: float) -> Dict[str, Any]:
    """Fetch current air quality from Open-Meteo air quality API (no key needed)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_AQI_BASE, params={
                "latitude": lat,
                "longitude": lon,
                "current": "us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,carbon_monoxide",
                "timezone": "auto",
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Air quality fetch failed: %s", exc)
        return {}

    c = data.get("current", {})
    aqi = c.get("us_aqi")
    label, color = "Unknown", "#888"
    if aqi is not None:
        for threshold, lbl, col in _AQI_LEVELS:
            if aqi <= threshold:
                label, color = lbl, col
                break

    return {
        "aqi": aqi,
        "label": label,
        "color": color,
        "pm2_5": c.get("pm2_5"),
        "pm10": c.get("pm10"),
        "ozone": c.get("ozone"),
        "nitrogen_dioxide": c.get("nitrogen_dioxide"),
        "carbon_monoxide": c.get("carbon_monoxide"),
    }


async def fetch_nws_alerts(lat: float, lon: float) -> List[Dict[str, Any]]:
    """
    Fetch active weather alerts from the National Weather Service REST API.
    Free, no API key required. Returns [] if no alerts or the request fails.

    Args:
        lat: Latitude of the location to check.
        lon: Longitude of the location to check.

    Returns:
        List of alert dicts with: id, event, headline, description,
        severity, urgency, certainty, onset, expires, color, instruction.
    """
    try:
        headers = {"User-Agent": "RiverSongAI/1.0 (riversongai.com)"}
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            # NWS requires a point lookup first to get the grid zone
            point_resp = await client.get(
                f"{_NWS_BASE}/points/{lat:.4f},{lon:.4f}"
            )
            if point_resp.status_code != 200:
                logger.debug("NWS point lookup failed: %s", point_resp.status_code)
                return []
            point_data  = point_resp.json()
            zone_url    = point_data.get("properties", {}).get("forecastZone", "")
            county_url  = point_data.get("properties", {}).get("county", "")

            # Use the active alerts by point endpoint (simplest)
            alerts_resp = await client.get(
                f"{_NWS_BASE}/alerts/active",
                params={"point": f"{lat:.4f},{lon:.4f}"},
            )
            if alerts_resp.status_code != 200:
                return []
            alerts_data = alerts_resp.json()
    except Exception as exc:
        logger.debug("NWS alerts fetch failed: %s", exc)
        return []

    alerts: List[Dict[str, Any]] = []
    for feature in alerts_data.get("features", []):
        props = feature.get("properties", {})
        severity = props.get("severity", "Unknown")
        color    = _NWS_SEVERITY_COLORS.get(severity, "#888888")

        # Clean up description — strip redundant whitespace
        desc = (props.get("description") or "").strip()
        desc = " ".join(desc.split())

        instruction = (props.get("instruction") or "").strip()
        instruction = " ".join(instruction.split())

        alerts.append({
            "id":          feature.get("id", ""),
            "event":       props.get("event", ""),
            "headline":    props.get("headline") or props.get("event", ""),
            "description": desc[:600],
            "instruction": instruction[:400],
            "severity":    severity,
            "urgency":     props.get("urgency", ""),
            "certainty":   props.get("certainty", ""),
            "onset":       props.get("onset") or "",
            "expires":     props.get("expires") or "",
            "color":       color,
            "sender":      props.get("senderName", "NWS"),
        })

    # Sort: Extreme first, then Severe, then the rest
    severity_order = {"Extreme": 0, "Severe": 1, "Moderate": 2, "Minor": 3, "Unknown": 4}
    alerts.sort(key=lambda a: severity_order.get(a["severity"], 9))
    return alerts
