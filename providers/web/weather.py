"""
providers/web/weather.py

Weather provider for River Song AI.
Uses Open-Meteo (free, no key) for real-time forecasts.
"""

import logging
import httpx
from typing import Dict, Any, Optional
from config.settings import get_settings

logger = logging.getLogger(__name__)

class WeatherProvider:
    """
    Provides weather forecasts and current conditions.
    """

    def __init__(self):
        self.settings = get_settings()

    async def get_forecast(self, lat: float, lon: float, units: str = "celsius") -> str:
        """
        Fetch weather for given coordinates.
        """
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "current_weather": "true",
            "daily": "temperature_2m_max,temperature_2m_min,weathercode",
            "timezone": "auto"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, params=params, timeout=10.0)
                if resp.status_code != 200:
                    return "I couldn't reach the weather service right now."

                data = resp.json()
                current = data.get("current_weather", {})
                temp = current.get("temperature")
                wind = current.get("windspeed")
                
                # Simple mapping for weather codes
                # https://open-meteo.com/en/docs
                code = current.get("weathercode", 0)
                condition = self._map_code(code)

                report = (
                    f"The current weather is {condition} at {temp}°{units.upper()[0]}. "
                    f"Wind speed is {wind} km/h."
                )
                
                daily = data.get("daily", {})
                if daily:
                    high = daily.get("temperature_2m_max", [temp])[0]
                    low = daily.get("temperature_2m_min", [temp])[0]
                    report += f" Expect a high of {high}° and a low of {low}° today."

                return report

        except Exception as exc:
            logger.error("Weather fetch failed: %s", exc)
            return "I had trouble checking the weather for you, sweetie."

    def _map_code(self, code: int) -> str:
        codes = {
            0: "clear sky",
            1: "mainly clear", 2: "partly cloudy", 3: "overcast",
            45: "foggy", 48: "depositing rime fog",
            51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
            61: "slight rain", 63: "moderate rain", 65: "heavy rain",
            71: "slight snow fall", 73: "moderate snow fall", 75: "heavy snow fall",
            95: "thunderstorm",
        }
        return codes.get(code, "changeable")

def build_weather_provider() -> WeatherProvider:
    return WeatherProvider()
