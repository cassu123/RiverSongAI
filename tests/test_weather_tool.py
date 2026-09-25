"""
River's get_weather tool: enough to answer "will it rain?", in her own
location and units when asked about "here".

It used to return only temperature, condition, wind and today's high/low,
and it geocoded the literal words "current location".
"""
import asyncio

import providers.feeds.weather as weather
from api.services.feed_service import FeedService
from core.tools import registry

DATA = {
    "current": {"temperature": 68.4, "feels_like": 64.0, "condition": "Clear sky",
                "wind_speed": 6, "wind_direction": 190, "wind_gusts": 18,
                "humidity": 68, "unit": "°F", "wind_unit": "mph"},
    "outlook": "Rain likely around 2 PM tomorrow.",
    "daily": [
        {"date": "2026-09-25", "condition": "Partly cloudy", "temp_max": 78.2, "temp_min": 59.1,
         "precip_prob_max": 0},
        {"date": "2026-09-26", "condition": "Moderate rain", "temp_max": 85, "temp_min": 61,
         "precip_prob_max": 70},
    ],
    "forecast_text": [{"name": "Tonight", "detailed": "Mostly clear, with a low around 59."}],
    "location_name": "Jacksonville, Arkansas", "lat": 34.87, "lon": -92.11,
}


def test_the_description_answers_the_real_questions():
    text = weather.describe_weather(DATA, [{"headline": "Heat Advisory until 8 PM"}])
    assert text.splitlines() == [
        "Now 68°F, clear sky, feels like 64°F. Wind 6 mph from the S, gusting 18. Humidity 68%.",
        "Rain likely around 2 PM tomorrow.",
        "Today: partly cloudy, high 78°F, low 59°F.",
        "Saturday: moderate rain, high 85°F, low 61°F, 70% chance of rain.",
        "National Weather Service: Tonight: Mostly clear, with a low around 59.",
        "Active alerts: Heat Advisory until 8 PM.",
    ]


class _Store:
    async def get_page_settings(self, user_id):
        return {"weather": {"units": "imperial"}}


def _here(monkeypatch, weather_fn):
    async def no_alerts(lat, lon):
        return []

    monkeypatch.setattr(registry, "_get_vault_store", lambda: _Store())
    monkeypatch.setattr(FeedService, "get_weather", staticmethod(weather_fn))
    monkeypatch.setattr(weather, "fetch_nws_alerts", no_alerts)


def test_current_location_uses_the_saved_place(monkeypatch):
    async def saved(store, user_id):
        return DATA

    _here(monkeypatch, saved)
    out = asyncio.run(registry._exec_get_weather({"location": "current location"}, "u1"))
    assert out.startswith("Weather for Jacksonville, Arkansas:\nNow 68°F")


def test_no_saved_place_is_an_answer(monkeypatch):
    from fastapi import HTTPException

    async def none_saved(store, user_id):
        raise HTTPException(status_code=404, detail="No location saved.")

    _here(monkeypatch, none_saved)
    out = asyncio.run(registry._exec_get_weather({"location": "here"}, "u1"))
    assert "haven't saved a location" in out


def test_a_named_city_uses_the_saved_units(monkeypatch):
    import sys
    import types
    seen = {}

    class Maps:
        async def geocode(self, q):
            return {"geometry": {"location": {"lat": 51.5, "lng": -0.12}},
                    "formatted_address": "London, UK"}

    async def report(lat, lon, units):
        seen["units"] = units
        return "Now 60°F"

    maps_mod = types.ModuleType("providers.google.maps")
    maps_mod.build_maps_provider = lambda: Maps()
    monkeypatch.setitem(sys.modules, "providers.google.maps", maps_mod)
    monkeypatch.setattr(registry, "_get_vault_store", lambda: _Store())
    monkeypatch.setattr(weather, "get_weather_report", report)
    out = asyncio.run(registry._exec_get_weather({"location": "London"}, "u1"))
    assert out == "Weather for London, UK:\nNow 60°F" and seen["units"] == "fahrenheit"
