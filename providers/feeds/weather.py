# =============================================================================
# providers/feeds/weather.py
#
# Weather provider for River Song AI.
# Ported from controllers/controller_base/weather/weather_controller.py.
#
# Changes from source:
#   - Replaced synchronous `requests` with async `httpx`.
#   - Methods now return structured dicts instead of only logging.
#   - Defaults to imperial units (Fahrenheit) instead of metric.
#   - Added day-of-week parsing for queries like "what's the weather Friday."
#   - Added location extraction from transcript ("weather in Chicago").
#   - Added TTS-friendly formatters for both current and forecast responses.
#   - Removed ControllerBase dependency (not used in v2 architecture).
#
# API: OpenWeatherMap free tier.
#   Docs: https://openweathermap.org/api/one-call-3
#   Current weather: GET /data/2.5/weather
#   5-day forecast:  GET /data/2.5/forecast  (3-hour intervals, 5 days)
# =============================================================================

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)

_BASE_URL = "https://api.openweathermap.org/data/2.5"

# Map lowercase day names to weekday numbers (Monday=0).
_DAY_NUMBERS: Dict[str, int] = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
    "today": -1, "tomorrow": -2,  # Handled specially below.
}

# Cities the user might name without a country code.
# Extend as needed; the API handles most city names without disambiguation.
_CITY_ALIASES: Dict[str, str] = {
    "nyc": "New York,US",
    "new york city": "New York,US",
    "la": "Los Angeles,US",
    "dc": "Washington,US",
    "chicago": "Chicago,US",
    "london": "London,GB",
}


class WeatherProvider:
    """
    Async weather provider using the OpenWeatherMap API.

    Args:
        api_key: OpenWeatherMap API key.
        default_location: Fallback city string when no location is in the query.
            Format: "City,CountryCode" (e.g., "Chicago,US").
        units: "imperial" (Fahrenheit) or "metric" (Celsius).
    """

    def __init__(
        self,
        api_key: str,
        default_location: str = "New York,US",
        units: str = "imperial",
    ) -> None:
        if not api_key:
            raise ValueError(
                "WEATHER_API_KEY is not set. "
                "Register free at https://openweathermap.org/api."
            )
        self._api_key = api_key
        self._default_location = default_location
        self._units = units

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def get_current(self, location: Optional[str] = None) -> Dict[str, Any]:
        """
        Fetch current weather conditions for a location.

        Args:
            location: City string (e.g., "Chicago,US"). Falls back to
                default_location when omitted.

        Returns:
            Dict with keys: location, description, temp, feels_like,
            humidity, wind_speed, units_label.

        Raises:
            httpx.HTTPStatusError: On API errors (bad key, unknown city).
        """
        city = location or self._default_location
        params = {
            "q": city,
            "appid": self._api_key,
            "units": self._units,
        }
        data = await self._get(f"{_BASE_URL}/weather", params)
        return self._parse_current(data)

    async def get_forecast(
        self,
        location: Optional[str] = None,
        day_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch 5-day forecast, optionally filtered to a specific day.

        Args:
            location: City string. Falls back to default_location.
            day_name: Lowercase day name ("friday", "tomorrow", "today") or
                None to return all 5 days. Case-insensitive.

        Returns:
            List of period dicts, each with: datetime, description, temp_min,
            temp_max, humidity, wind_speed, units_label.
            For a specific day, returns that day's periods (up to 8 x 3-hr blocks).
            For all days, returns one representative period per day.
        """
        city = location or self._default_location
        params = {
            "q": city,
            "appid": self._api_key,
            "units": self._units,
            "cnt": 40,  # Full 5-day range.
        }
        data = await self._get(f"{_BASE_URL}/forecast", params)
        periods = self._parse_forecast(data)

        if day_name:
            return self._filter_by_day(periods, day_name.lower())
        return _one_per_day(periods)

    # -------------------------------------------------------------------------
    # TTS formatters
    # -------------------------------------------------------------------------

    def format_current_for_speech(self, weather: Dict[str, Any]) -> str:
        """
        Convert a get_current() result to a TTS-friendly string.

        Args:
            weather: Dict returned by get_current().

        Returns:
            Plain-text weather description suitable for speaking aloud.
        """
        loc = weather.get("location", "your location")
        desc = weather.get("description", "unknown conditions")
        temp = weather.get("temp")
        feels = weather.get("feels_like")
        wind = weather.get("wind_speed")
        label = weather.get("units_label", "degrees")

        parts = [f"Currently in {loc}: {desc}."]
        if temp is not None:
            parts.append(f"It's {temp:.0f} {label}.")
        if feels is not None and abs(feels - temp) >= 3:
            parts.append(f"Feels like {feels:.0f}.")
        if wind is not None:
            parts.append(f"Wind at {wind:.0f} miles per hour." if self._units == "imperial"
                         else f"Wind at {wind:.0f} meters per second.")
        return " ".join(parts)

    def format_forecast_for_speech(
        self,
        periods: List[Dict[str, Any]],
        day_name: Optional[str] = None,
    ) -> str:
        """
        Convert get_forecast() results to a TTS-friendly string.

        Args:
            periods: List of period dicts from get_forecast().
            day_name: If provided, included in the intro sentence.

        Returns:
            Plain-text forecast suitable for speaking aloud.
        """
        if not periods:
            target = day_name or "the requested period"
            return f"No forecast data available for {target}."

        label = periods[0].get("units_label", "degrees")
        day_label = f"for {day_name}" if day_name else "for the next few days"

        if len(periods) == 1:
            p = periods[0]
            desc = p.get("description", "unknown")
            hi = p.get("temp_max")
            lo = p.get("temp_min")
            date_str = p.get("datetime", "")
            dt_label = _friendly_date(date_str) if date_str else ""
            intro = f"The forecast {day_label}"
            if dt_label:
                intro = f"The forecast for {dt_label}"
            parts = [f"{intro}: {desc}."]
            if hi is not None and lo is not None:
                parts.append(f"High of {hi:.0f}, low of {lo:.0f} {label}.")
            return " ".join(parts)

        # Multiple days -- read each one.
        parts = [f"Here's the forecast {day_label}."]
        for p in periods:
            date_str = p.get("datetime", "")
            dt_label = _friendly_date(date_str) if date_str else "upcoming"
            desc = p.get("description", "unknown")
            hi = p.get("temp_max")
            lo = p.get("temp_min")
            day_part = f"{dt_label}: {desc}"
            if hi is not None and lo is not None:
                day_part += f", high {hi:.0f}, low {lo:.0f}."
            else:
                day_part += "."
            parts.append(day_part)
        return " ".join(parts)

    # -------------------------------------------------------------------------
    # Response parsers
    # -------------------------------------------------------------------------

    def _parse_current(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract relevant fields from a /weather API response."""
        main = data.get("main", {})
        weather_list = data.get("weather", [{}])
        wind = data.get("wind", {})
        return {
            "location": data.get("name", "Unknown"),
            "description": weather_list[0].get("description", "unknown") if weather_list else "unknown",
            "temp": main.get("temp"),
            "feels_like": main.get("feels_like"),
            "temp_min": main.get("temp_min"),
            "temp_max": main.get("temp_max"),
            "humidity": main.get("humidity"),
            "wind_speed": wind.get("speed"),
            "units_label": "degrees Fahrenheit" if self._units == "imperial" else "degrees Celsius",
        }

    def _parse_forecast(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract a list of period dicts from a /forecast API response."""
        city_name = data.get("city", {}).get("name", "Unknown")
        periods = []
        for item in data.get("list", []):
            weather_list = item.get("weather", [{}])
            main = item.get("main", {})
            wind = item.get("wind", {})
            periods.append({
                "location": city_name,
                "datetime": item.get("dt_txt", ""),
                "description": weather_list[0].get("description", "unknown") if weather_list else "unknown",
                "temp": main.get("temp"),
                "temp_min": main.get("temp_min"),
                "temp_max": main.get("temp_max"),
                "humidity": main.get("humidity"),
                "wind_speed": wind.get("speed"),
                "units_label": "degrees Fahrenheit" if self._units == "imperial" else "degrees Celsius",
            })
        return periods

    def _filter_by_day(
        self,
        periods: List[Dict[str, Any]],
        day_name: str,
    ) -> List[Dict[str, Any]]:
        """
        Return periods whose datetime falls on the requested day.

        For "today" and "tomorrow", matches by date offset from now.
        For named days ("friday"), matches the next occurrence of that weekday.
        """
        now = datetime.now()

        if day_name == "today":
            target_date = now.date()
        elif day_name == "tomorrow":
            target_date = (now + timedelta(days=1)).date()
        else:
            day_num = _DAY_NUMBERS.get(day_name)
            if day_num is None:
                logger.warning("Unknown day name '%s', returning all periods.", day_name)
                return _one_per_day(periods)
            days_ahead = (day_num - now.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7  # If today is Friday, "Friday" means next Friday.
            target_date = (now + timedelta(days=days_ahead)).date()

        matched = [
            p for p in periods
            if p.get("datetime", "").startswith(str(target_date))
        ]

        if not matched:
            logger.info("No forecast periods found for '%s' (%s).", day_name, target_date)
            return []

        # Summarize the day: pick representative noon period or aggregate.
        return _summarize_day_periods(matched)

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
# Internal helpers
# -------------------------------------------------------------------------

def _one_per_day(periods: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Reduce a list of 3-hour forecast periods to one representative entry per day.

    Picks the noon (12:00) period for each date, or the first available period
    if noon is not in the data.
    """
    by_date: Dict[str, List[Dict[str, Any]]] = {}
    for p in periods:
        date = p.get("datetime", "")[:10]
        by_date.setdefault(date, []).append(p)

    result = []
    for date in sorted(by_date):
        day_periods = by_date[date]
        noon = next((p for p in day_periods if "12:00" in p.get("datetime", "")), None)
        rep = noon or day_periods[0]
        # Annotate with day-level min/max across all periods for that date.
        temps = [p["temp"] for p in day_periods if p.get("temp") is not None]
        if temps:
            rep = dict(rep)
            rep["temp_min"] = min(temps)
            rep["temp_max"] = max(temps)
        result.append(rep)
    return result


def _summarize_day_periods(periods: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Produce a single summary period for a list of same-day periods.

    Returns a list containing one dict with the day's overall high, low, and
    the most common weather description.
    """
    if not periods:
        return []
    temps = [p["temp"] for p in periods if p.get("temp") is not None]
    descriptions = [p.get("description", "") for p in periods]
    most_common_desc = max(set(descriptions), key=descriptions.count) if descriptions else "unknown"

    summary = dict(periods[0])
    summary["description"] = most_common_desc
    if temps:
        summary["temp_min"] = min(temps)
        summary["temp_max"] = max(temps)
        summary["temp"] = sum(temps) / len(temps)
    return [summary]


def _friendly_date(dt_txt: str) -> str:
    """
    Convert a forecast datetime string like '2025-04-18 12:00:00' to
    a natural label like 'Friday April 18th'.
    """
    try:
        dt = datetime.strptime(dt_txt[:10], "%Y-%m-%d")
        now = datetime.now()
        delta = (dt.date() - now.date()).days
        if delta == 0:
            return "today"
        if delta == 1:
            return "tomorrow"
        day_name = dt.strftime("%A")
        month_day = dt.strftime("%B %-d")
        return f"{day_name} {month_day}"
    except ValueError:
        return dt_txt


def extract_location_from_transcript(transcript: str, default: str) -> str:
    """
    Extract a city name from a weather query transcript.

    Looks for "in <city>" or "for <city>" patterns. Falls back to default.

    Args:
        transcript: Raw transcript string.
        default: Fallback location string.

    Returns:
        Location string suitable for the OpenWeatherMap API.
    """
    import re
    lower = transcript.lower()

    # Check aliases first.
    for alias, resolved in _CITY_ALIASES.items():
        if alias in lower:
            return resolved

    # Pattern: "weather in Chicago" or "forecast for Dallas"
    m = re.search(r"\b(?:in|for)\s+([A-Za-z\s]+?)(?:\s+(?:this|on|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week)|[?.!]|$)", lower)
    if m:
        city = m.group(1).strip().title()
        if city:
            return city

    return default


def extract_day_from_transcript(transcript: str) -> Optional[str]:
    """
    Extract a day-of-week or relative day from a weather query.

    Args:
        transcript: Raw transcript string.

    Returns:
        Lowercase day name ("friday", "today", "tomorrow", "weekend") or None.
    """
    lower = transcript.lower()
    for day in _DAY_NUMBERS:
        if day in lower:
            return day
    if "weekend" in lower:
        return "saturday"
    return None


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_weather_provider() -> WeatherProvider:
    """
    Convenience factory that builds a WeatherProvider using app settings.

    Returns:
        Configured WeatherProvider instance.

    Raises:
        ValueError: If WEATHER_API_KEY is not set.
    """
    from config.settings import get_settings
    s = get_settings()
    return WeatherProvider(
        api_key=s.weather_api_key,
        default_location=s.default_location,
        units=s.weather_units,
    )
