"""
The morning brief and the Briefing page's weather read fetch_weather's real
shape. The brief used to die on settings.latitude (no such setting); the
Briefing chip read Open-Meteo's raw field names and never showed anything.
"""
import asyncio
import os
import sys
import types

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _name, _path in (("api.routes", "api/routes"), ("api.routes.domains", "api/routes/domains")):
    if _name not in sys.modules:
        _pkg = types.ModuleType(_name)
        _pkg.__path__ = [os.path.join(_ROOT, _path)]
        sys.modules[_name] = _pkg

import api.routes.domains.briefing as briefing  # noqa: E402
import core.brief as brief  # noqa: E402
import providers.feeds.weather as weather  # noqa: E402
from api.services.feed_service import FeedService  # noqa: E402

# What fetch_weather returns (trimmed).
WEATHER = {
    "current": {"temperature": 68.4, "feels_like": 67.6, "condition": "Clear sky",
                "weathercode": 0, "is_day": False, "unit": "°F"},
    "daily": [{"date": "2026-09-25", "condition": "Partly cloudy", "weathercode": 2,
               "temp_max": 78.2, "temp_min": 59.1}],
    "unit": "°F", "lat": 34.87, "lon": -92.11,
}


def _serve(monkeypatch, alerts=()):
    async def get_weather(store, user_id):
        return WEATHER

    async def nws(lat, lon):
        return [{"event": e} for e in alerts]

    monkeypatch.setattr(FeedService, "get_weather", staticmethod(get_weather))
    monkeypatch.setattr(weather, "fetch_nws_alerts", nws)


def test_briefing_chip_shows_the_weather(monkeypatch):
    _serve(monkeypatch)
    monkeypatch.setattr(briefing, "_store", lambda request: None)
    chip = asyncio.run(briefing._section_weather(None, "u1"))
    assert chip["status"] == "ok"
    assert (chip["temperature"], chip["high"], chip["low"], chip["unit"]) == (68, 78, 59, "F")
    assert chip["icon"] == "clear_night"


class _Store:
    async def execute_read_async(self, sql, params):
        return []


class _Memory:
    _store = _Store()


def test_morning_brief_includes_the_forecast_and_alerts(monkeypatch):
    _serve(monkeypatch, alerts=["Heat Advisory"])
    text = asyncio.run(brief.generate_morning_brief("u1", _Memory()))
    assert "Now 68°F, clear sky." in text
    assert "high 78°F, low 59°F" in text
    assert "Heat Advisory" in text


def test_morning_brief_without_a_location_still_runs(monkeypatch):
    from fastapi import HTTPException

    async def no_location(store, user_id):
        raise HTTPException(status_code=404, detail="No location saved.")

    monkeypatch.setattr(FeedService, "get_weather", staticmethod(no_location))
    assert asyncio.run(brief.generate_morning_brief("u1", _Memory())) == \
        "Good morning! No new updates for today."
