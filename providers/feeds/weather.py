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
_NWS_BASE = "https://api.weather.gov"

_NWS_SEVERITY_COLORS = {
    "Extreme": "#cc0000",
    "Severe": "#ff4400",
    "Moderate": "#ff8800",
    "Minor": "#ffcc00",
    "Unknown": "#888888",
}

_AQI_LEVELS = [
    (50, "Good", "#00cc44"),
    (100, "Moderate", "#ffcc00"),
    (150, "Unhealthy for Sensitive", "#ff8800"),
    (200, "Unhealthy", "#ff3300"),
    (300, "Very Unhealthy", "#9933cc"),
    (999, "Hazardous", "#7a0000"),
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
    wind_unit: str = "kmh",
) -> Dict[str, Any]:
    """
    Fetch current conditions and 7-day forecast for the given coordinates.

    Args:
        lat: Latitude
        lon: Longitude
        unit: "celsius" or "fahrenheit"
        wind_unit: "kmh" | "mph" | "kn" | "ms"

    Returns dict with keys: current, daily, unit
    """
    temp_unit = "celsius" if unit == "celsius" else "fahrenheit"
    wind_unit = wind_unit if wind_unit in ("kmh", "mph", "kn", "ms") else "kmh"

    base = {
        "current": [
            "temperature_2m", "apparent_temperature", "weathercode",
            "windspeed_10m", "winddirection_10m", "windgusts_10m",
            "relative_humidity_2m", "precipitation", "uv_index", "visibility",
            "is_day",
        ],
        "hourly": [
            "temperature_2m", "weathercode", "is_day",
            "precipitation_probability", "precipitation", "windspeed_10m",
        ],
        "daily": [
            "weathercode", "temperature_2m_max", "temperature_2m_min",
            "precipitation_sum", "windspeed_10m_max", "uv_index_max",
            "sunrise", "sunset",
        ],
    }
    # The fuller set. If Open-Meteo refuses any of it, the request above is
    # retried as it stood before, so the page never loses its weather.
    extra = {
        "current": ["dew_point_2m", "pressure_msl", "cloud_cover"],
        "hourly": ["winddirection_10m", "windgusts_10m", "uv_index"],
        "daily": ["precipitation_probability_max", "wind_gusts_10m_max",
                  "wind_direction_10m_dominant"],
        # Rain in 15-minute steps: native from NOAA's HRRR over the US,
        # interpolated from hourly elsewhere.
        "minutely_15": ["precipitation"],
    }

    def _params(fields: Dict[str, List[str]], days: int) -> Dict[str, Any]:
        return {
            "latitude": lat,
            "longitude": lon,
            **{k: ",".join(v) for k, v in fields.items()},
            "temperature_unit": temp_unit,
            "wind_speed_unit": wind_unit,
            "timezone": "auto",
            "forecast_days": days,
        }

    full = {k: base.get(k, []) + extra.get(k, []) for k in {*base, *extra}}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_BASE, params=_params(full, 10))  # type: ignore
            if resp.status_code == 400:
                logger.warning("Open-Meteo refused the full request (%s); "
                               "falling back to the basic one", resp.text[:200])
                resp = await client.get(_BASE, params=_params(base, 7))  # type: ignore
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
        "is_day": _as_bool(current_raw.get("is_day")),
        "wind_speed": current_raw.get("windspeed_10m"),
        "wind_direction": current_raw.get("winddirection_10m"),
        "wind_gusts": current_raw.get("windgusts_10m"),
        "humidity": current_raw.get("relative_humidity_2m"),
        "precipitation": current_raw.get("precipitation"),
        "uv_index": current_raw.get("uv_index"),
        "visibility": current_raw.get("visibility"),  # metres
        "dew_point": current_raw.get("dew_point_2m"),
        "pressure": current_raw.get("pressure_msl"),  # hPa
        "cloud_cover": current_raw.get("cloud_cover"),  # %
        "unit": unit_sym,
        "wind_unit": {"kmh": "km/h", "mph": "mph", "kn": "kn", "ms": "m/s"}.get(wind_unit, "km/h"),
    }

    def _at(arr: List[Any], i: int) -> Any:
        return arr[i] if i < len(arr) else None

    # Hourly — the next 48 hours
    hourly_times = hourly_raw.get("time", [])
    hourly_temps = hourly_raw.get("temperature_2m", [])
    hourly_codes = hourly_raw.get("weathercode", [])
    hourly_precip_prob = hourly_raw.get("precipitation_probability", [])
    hourly_precip = hourly_raw.get("precipitation", [])
    hourly_wind = hourly_raw.get("windspeed_10m", [])
    hourly_is_day = hourly_raw.get("is_day", [])
    hourly_wind_dir = hourly_raw.get("winddirection_10m", [])
    hourly_gusts = hourly_raw.get("windgusts_10m", [])
    hourly_uv = hourly_raw.get("uv_index", [])

    # Find index of current hour to slice the next 48
    now_str = current_raw.get("time", "")
    start_idx = 0
    if now_str and hourly_times:
        for i, t in enumerate(hourly_times):
            if t >= now_str[:13]:  # match "YYYY-MM-DDTHH"
                start_idx = i
                break

    hourly: list = []
    for i in range(start_idx, min(start_idx + 48, len(hourly_times))):
        hourly.append({
            "time": hourly_times[i],
            "temperature": hourly_temps[i] if i < len(hourly_temps) else None,
            "condition": _WMO_CODES.get(hourly_codes[i] if i < len(hourly_codes) else -1, ""),
            "weathercode": hourly_codes[i] if i < len(hourly_codes) else None,
            "is_day": _as_bool(hourly_is_day[i]) if i < len(hourly_is_day) else None,
            "precip_prob": hourly_precip_prob[i] if i < len(hourly_precip_prob) else None,
            "precipitation": hourly_precip[i] if i < len(hourly_precip) else None,
            "wind_speed": hourly_wind[i] if i < len(hourly_wind) else None,
            "wind_direction": _at(hourly_wind_dir, i),
            "wind_gusts": _at(hourly_gusts, i),
            "uv_index": _at(hourly_uv, i),
        })

    # Rain in 15-minute steps over the next two hours.
    m_raw = data.get("minutely_15", {})
    m_times = m_raw.get("time", [])
    m_precip = m_raw.get("precipitation", [])
    m_start = next((i for i, t in enumerate(m_times) if t >= now_str[:16]), len(m_times))
    minutely = [{"time": m_times[i], "precipitation": _at(m_precip, i)}
                for i in range(m_start, min(m_start + 8, len(m_times)))]

    def _daily_val(key: str, idx: int):
        arr = daily_raw.get(key) or []
        return arr[idx] if idx < len(arr) else None

    dates = daily_raw.get("time", [])
    daily: List[Dict[str, Any]] = []
    for i, date in enumerate(dates):
        worst = _daily_val("weathercode", i)
        code = _daytime_code(date, hourly_times, hourly_codes, hourly_is_day, worst)
        daily.append({
            "date": date,
            "condition": _WMO_CODES.get(code, "Unknown") if code is not None else "Unknown",
            "weathercode": code,
            # Open-Meteo's own daily code: the single worst hour of the day.
            "worst_code": worst,
            "temp_max": _daily_val("temperature_2m_max", i),
            "temp_min": _daily_val("temperature_2m_min", i),
            "precipitation": _daily_val("precipitation_sum", i),
            "wind_max": _daily_val("windspeed_10m_max", i),
            "uv_index_max": _daily_val("uv_index_max", i),
            "sunrise": _daily_val("sunrise", i),
            "sunset": _daily_val("sunset", i),
            "precip_prob_max": _daily_val("precipitation_probability_max", i),
            "wind_gusts_max": _daily_val("wind_gusts_10m_max", i),
            "wind_direction": _daily_val("wind_direction_10m_dominant", i),
        })

    import asyncio as _asyncio
    air_quality, location_name, forecast_text = await _asyncio.gather(
        fetch_air_quality(lat, lon),
        _reverse_geocode(lat, lon),
        fetch_nws_forecast(lat, lon),
        return_exceptions=True,
    )
    if isinstance(air_quality, Exception):
        air_quality = {}
    if isinstance(location_name, Exception):
        location_name = ""
    if isinstance(forecast_text, Exception):
        forecast_text = []

    return {
        "current": current,
        "hourly": hourly,
        "daily": daily,
        "minutely": minutely,
        "outlook": rain_outlook(now_str, minutely, hourly),
        "forecast_text": forecast_text,
        "air_quality": air_quality,
        "unit": unit_sym,
        "timezone": data.get("timezone"),
        "lat": lat,
        "lon": lon,
        "location_name": location_name,
    }


def _as_bool(v: Any) -> Optional[bool]:
    return None if v is None else bool(v)


def _daytime_code(date: str, times: List[str], codes: List[Any],
                  is_day: List[Any], worst: Any) -> Any:
    """The code that describes a day the way you would.

    Open-Meteo's daily code is the worst hour of the whole day, so one
    overcast hour at 3 AM made every day read "Overcast". This looks at the
    daylight hours instead: rain, snow or storms that last two hours or more
    win (the worst of them); otherwise the most common sky, ties going to the
    cloudier one. With no hourly data it falls back to Open-Meteo's code.
    """
    from collections import Counter
    day = [c for t, c, d in zip(times, codes, is_day)
           if t.startswith(date) and d and c is not None]
    if not day:
        return worst
    wet = [c for c in day if c >= 51]
    if len(wet) >= 2:
        return max(wet)
    counts = Counter(c for c in day if c < 51)
    return max(counts, key=lambda c: (counts[c], c))


_WET_MM = 0.1  # rain in a 15-minute step that counts as "raining"


def _precip_kind(code: Any) -> str:
    if isinstance(code, int) and code >= 95:
        return "storms"
    if isinstance(code, int) and (71 <= code <= 77 or code in (85, 86)):
        return "snow"
    return "rain"


def _clock(t: str, now: str, minutes: bool = False) -> str:
    """ "2026-09-25T14:00" → "2 PM", "2:15 PM", "2 PM tomorrow", "2 PM Sat"."""
    from datetime import date
    h, m = int(t[11:13]), int(t[14:16])
    label = f"{h % 12 or 12}{f':{m:02d}' if minutes and m else ''} {'AM' if h < 12 else 'PM'}"
    try:
        days = (date.fromisoformat(t[:10]) - date.fromisoformat(now[:10])).days
    except ValueError:
        days = 0
    if days == 1:
        return f"{label} tomorrow"
    if days > 1:
        return f"{label} {date.fromisoformat(t[:10]).strftime('%a')}"
    return label


def rain_outlook(now: str, minutely: List[Dict[str, Any]],
                 hourly: List[Dict[str, Any]]) -> str:
    """One plain sentence on when rain (or snow, or storms) is coming.

    The next two hours come from the 15-minute data; beyond that, the first
    hour in the next day with a 50% chance or more, else the likeliest hour
    at 20% or more.
    """
    if not now:
        return ""
    kind_now = _precip_kind(hourly[0].get("weathercode") if hourly else None)
    wet = [(m.get("precipitation") or 0) >= _WET_MM for m in minutely]
    if wet and wet[0]:
        for i in range(1, len(wet)):
            if not any(wet[i:]):
                return f"{kind_now.capitalize()} now, easing by {_clock(minutely[i]['time'], now, True)}."
        return f"{kind_now.capitalize()} now, lasting at least two hours."
    if any(wet):
        i = wet.index(True)
        return f"{kind_now.capitalize()} starting in about {i * 15} minutes."

    day = [h for h in hourly[:24] if h.get("precip_prob") is not None]
    likely = next((h for h in day if h["precip_prob"] >= 50), None)
    if likely:
        return (f"{_precip_kind(likely.get('weathercode')).capitalize()} likely "
                f"around {_clock(likely['time'], now)}.")
    chance = max(day, key=lambda h: h["precip_prob"], default=None)
    if chance and chance["precip_prob"] >= 20:
        return (f"Slight chance of {_precip_kind(chance.get('weathercode'))} around "
                f"{_clock(chance['time'], now)} ({chance['precip_prob']}%).")
    return "No rain expected in the next 24 hours."


_NWS_HEADERS = {"User-Agent": "RiverSongAI/1.0 (riversongai.com)"}
_nws_points: Dict[str, Dict[str, Any]] = {}


async def _nws_point(client: Any, lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """The NWS grid for a point (US only). Cached: a point's grid does not move."""
    key = f"{lat:.4f},{lon:.4f}"
    if key not in _nws_points:
        resp = await client.get(f"{_NWS_BASE}/points/{key}")
        if resp.status_code != 200:
            return None
        if len(_nws_points) > 64:
            _nws_points.clear()
        _nws_points[key] = resp.json().get("properties", {})
    return _nws_points[key]


async def fetch_nws_forecast(lat: float, lon: float) -> List[Dict[str, Any]]:
    """The National Weather Service's own words for the next four periods
    ("Tonight: Mostly clear, with a low around 59."). US only; [] elsewhere
    or on any failure."""
    try:
        async with httpx.AsyncClient(timeout=10, headers=_NWS_HEADERS) as client:
            point = await _nws_point(client, lat, lon)
            url = (point or {}).get("forecast")
            if not url:
                return []
            resp = await client.get(url)
            if resp.status_code != 200:
                return []
            periods = resp.json().get("properties", {}).get("periods", [])
    except Exception as exc:
        logger.debug("NWS forecast fetch failed: %s", exc)
        return []
    return [{
        "name": p.get("name", ""),
        "short": p.get("shortForecast", ""),
        "detailed": p.get("detailedForecast", ""),
        "temperature": p.get("temperature"),
        "temperature_unit": p.get("temperatureUnit"),
        "is_day": p.get("isDaytime"),
        "precip_prob": (p.get("probabilityOfPrecipitation") or {}).get("value"),
    } for p in periods[:4]]


def _compass(deg: Any) -> str:
    if not isinstance(deg, (int, float)):
        return ""
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round(deg / 45) % 8]


def describe_weather(data: Dict[str, Any], alerts: List[Dict[str, Any]] = ()) -> str:
    """The weather in plain sentences, for River to read and answer from:
    now, when rain is coming, today, the NWS's words, the next days, alerts."""
    from datetime import date

    def r(v: Any) -> Any:
        return round(v) if isinstance(v, (int, float)) else v

    cur = data.get("current") or {}
    unit = cur.get("unit") or data.get("unit") or ""
    wunit = cur.get("wind_unit") or ""
    lines = []

    if cur.get("temperature") is not None:
        now = f"Now {r(cur['temperature'])}{unit}, {(cur.get('condition') or '').lower()}"
        feels = cur.get("feels_like")
        if isinstance(feels, (int, float)) and abs(feels - cur["temperature"]) >= 2:
            now += f", feels like {r(feels)}{unit}"
        now += "."
        if cur.get("wind_speed") is not None:
            now += f" Wind {r(cur['wind_speed'])} {wunit}"
            if _compass(cur.get("wind_direction")):
                now += f" from the {_compass(cur['wind_direction'])}"
            if isinstance(cur.get("wind_gusts"), (int, float)) and cur["wind_gusts"] > cur["wind_speed"] + 5:
                now += f", gusting {r(cur['wind_gusts'])}"
            now += "."
        if cur.get("humidity") is not None:
            now += f" Humidity {cur['humidity']}%."
        lines.append(now)

    if data.get("outlook"):
        lines.append(data["outlook"])

    days = data.get("daily") or []
    for i, d in enumerate(days[:4]):
        if d.get("temp_max") is None:
            continue
        name = "Today" if i == 0 else date.fromisoformat(d["date"]).strftime("%A")
        line = (f"{name}: {(d.get('condition') or '').lower()}, "
                f"high {r(d['temp_max'])}{unit}, low {r(d['temp_min'])}{unit}")
        if d.get("precip_prob_max"):
            line += f", {d['precip_prob_max']}% chance of rain"
        lines.append(line + ".")

    text = data.get("forecast_text") or []
    if text:
        lines.append("National Weather Service: " +
                     " ".join(f"{p['name']}: {p['detailed']}" for p in text[:2]))

    if alerts:
        lines.append("Active alerts: " + "; ".join(
            a.get("headline") or a.get("event", "Alert") for a in alerts) + ".")
    return "\n".join(lines)


async def get_weather_report(lat: float, lon: float, units: str = "celsius",
                             wind_unit: Optional[str] = None) -> str:
    """Fetch the weather for a point and describe it for the LLM tool."""
    data = await fetch_weather(
        lat, lon, unit=units,
        wind_unit=wind_unit or ("mph" if units == "fahrenheit" else "kmh"))
    alerts = await fetch_nws_alerts(lat, lon)
    return describe_weather(data, alerts)


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
            addr.get("city") or addr.get("town") or addr.get(
                "village") or addr.get("county"),
            addr.get("state"),
        ]
        return ", ".join(p for p in parts if p)
    except Exception as exc:
        logger.debug("Reverse geocode failed: %s", exc)
        return ""


_PURPLEAIR_BASE = "https://api.purpleair.com/v1/sensors"


def _pm25_to_aqi(pm: float) -> int:
    # EPA breakpoint formula
    c = [(0.0, 12.0, 0, 50), (12.1, 35.4, 51, 100), (35.5, 55.4, 101, 150),
         (55.5, 150.4, 151, 200), (150.5, 250.4,
                                   201, 300), (250.5, 350.4, 301, 400),
         (350.5, 500.4, 401, 500)]
    for low, high, aqilow, aqihigh in c:
        if low <= pm <= high:
            return round(((aqihigh - aqilow) / (high - low))
                         * (pm - low) + aqilow)
    return 500


async def _fetch_purpleair_aqi(
        lat: float, lon: float) -> Optional[Dict[str, Any]]:
    import os
    from config.settings import get_settings
    settings = get_settings()
    api_key = getattr(
        settings,
        "purpleair_api_key",
        os.getenv("PURPLEAIR_API_KEY"))
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                _PURPLEAIR_BASE,
                params={
                    "fields": "pm2.5_atm,pm2.5_60minute,humidity,latitude,longitude,last_seen",
                    "nwlng": lon - 0.05,
                    "nwlat": lat + 0.05,
                    "selng": lon + 0.05,
                    "selat": lat - 0.05,
                    "max_age": 3600
                },
                headers={"X-API-Key": api_key}
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            if not data.get("data"):
                return None

            # Simple fallback to first sensor
            sensor = data["data"][0]
            pm25 = sensor[1] if len(sensor) > 1 else 0
            if pm25 is None:
                return None

            aqi = _pm25_to_aqi(pm25)
            label, color = "Unknown", "#888"
            for threshold, lbl, col in _AQI_LEVELS:
                if aqi <= threshold:
                    label, color = lbl, col
                    break

            return {
                "aqi": aqi,
                "label": label,
                "color": color,
                "pm2_5": pm25,
                "pm10": None,
                "ozone": None,
                "nitrogen_dioxide": None,
                "carbon_monoxide": None
            }
    except Exception as exc:
        logger.warning("PurpleAir fetch failed: %s", exc)
        return None


async def _fetch_openmeteo_aqi(lat: float, lon: float) -> Dict[str, Any]:
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


async def fetch_air_quality(lat: float, lon: float) -> Dict[str, Any]:
    purpleair = await _fetch_purpleair_aqi(lat, lon)
    if purpleair:
        purpleair["source"] = "purpleair"
        return purpleair
    om = await _fetch_openmeteo_aqi(lat, lon)
    om["source"] = "openmeteo"
    return om


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
                logger.debug(
                    "NWS point lookup failed: %s",
                    point_resp.status_code)
                return []
            point_data = point_resp.json()
            point_data.get("properties", {}).get("forecastZone", "")
            point_data.get("properties", {}).get("county", "")

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
        color = _NWS_SEVERITY_COLORS.get(severity, "#888888")

        # Clean up description — strip redundant whitespace
        desc = (props.get("description") or "").strip()
        desc = " ".join(desc.split())

        instruction = (props.get("instruction") or "").strip()
        instruction = " ".join(instruction.split())

        alerts.append({
            "id": feature.get("id", ""),
            "event": props.get("event", ""),
            "headline": props.get("headline") or props.get("event", ""),
            "description": desc[:600],
            "instruction": instruction[:400],
            "severity": severity,
            "urgency": props.get("urgency", ""),
            "certainty": props.get("certainty", ""),
            "onset": props.get("onset") or "",
            "expires": props.get("expires") or "",
            "color": color,
            "sender": props.get("senderName", "NWS"),
        })

    # Sort: Extreme first, then Severe, then the rest
    severity_order = {
        "Extreme": 0,
        "Severe": 1,
        "Moderate": 2,
        "Minor": 3,
        "Unknown": 4}
    alerts.sort(key=lambda a: severity_order.get(a["severity"], 9))
    return alerts
