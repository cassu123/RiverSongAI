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

_BASE = "https://api.open-meteo.com/v1/forecast"
_AQI_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality"

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
            "relative_humidity_2m",
            "precipitation",
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
        "humidity": current_raw.get("relative_humidity_2m"),
        "precipitation": current_raw.get("precipitation"),
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

    dates = daily_raw.get("time", [])
    daily: List[Dict[str, Any]] = []
    for i, date in enumerate(dates):
        daily.append({
            "date": date,
            "condition": _WMO_CODES.get((daily_raw.get("weathercode") or [])[i] if daily_raw.get("weathercode") else -1, "Unknown"),
            "weathercode": (daily_raw.get("weathercode") or [])[i] if daily_raw.get("weathercode") else None,
            "temp_max": (daily_raw.get("temperature_2m_max") or [])[i] if daily_raw.get("temperature_2m_max") else None,
            "temp_min": (daily_raw.get("temperature_2m_min") or [])[i] if daily_raw.get("temperature_2m_min") else None,
            "precipitation": (daily_raw.get("precipitation_sum") or [])[i] if daily_raw.get("precipitation_sum") else None,
            "wind_max": (daily_raw.get("windspeed_10m_max") or [])[i] if daily_raw.get("windspeed_10m_max") else None,
        })

    air_quality = await fetch_air_quality(lat, lon)

    return {
        "current": current,
        "hourly": hourly,
        "daily": daily,
        "air_quality": air_quality,
        "unit": unit_sym,
        "timezone": data.get("timezone"),
        "lat": lat,
        "lon": lon,
    }


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
