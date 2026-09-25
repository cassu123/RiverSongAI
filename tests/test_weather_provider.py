"""
providers/feeds/weather.py against a stand-in Open-Meteo response.

What the Feeds page showed: every day "Overcast" (Open-Meteo's daily code is
the worst single hour), clear days "Unknown" (code 0 was read as missing),
and suns on the hourly strip through the night (no day/night flag).
"""
import asyncio


import providers.feeds.weather as weather

DAY = "2026-09-25"


def _hours(date, codes, day_from=7, day_to=19):
    times = [f"{date}T{h:02d}:00" for h in range(24)]
    is_day = [1 if day_from <= h < day_to else 0 for h in range(24)]
    return times, list(codes), is_day


def _payload(hourly_codes, daily_worst=3, current_code=0, current_is_day=1):
    times, codes, is_day = _hours(DAY, hourly_codes)
    n = len(times)
    return {
        "timezone": "America/Chicago",
        "current": {"time": f"{DAY}T21:00", "temperature_2m": 68, "apparent_temperature": 68,
                    "weathercode": current_code, "is_day": current_is_day,
                    "windspeed_10m": 6, "winddirection_10m": 200, "windgusts_10m": 12,
                    "relative_humidity_2m": 68, "precipitation": 0, "uv_index": 0,
                    "visibility": 16000},
        "hourly": {"time": times, "temperature_2m": [60] * n, "weathercode": codes,
                   "is_day": is_day, "precipitation_probability": [0] * n,
                   "precipitation": [0] * n, "windspeed_10m": [5] * n},
        "daily": {"time": [DAY], "weathercode": [daily_worst], "temperature_2m_max": [78],
                  "temperature_2m_min": [59], "precipitation_sum": [0],
                  "windspeed_10m_max": [10], "uv_index_max": [6],
                  "sunrise": [f"{DAY}T06:58"], "sunset": [f"{DAY}T19:02"]},
    }


class _Resp:
    def __init__(self, data):
        self._data = data
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


def _fetch(monkeypatch, payload, **kw):
    requested = {}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, **k):
            requested.update(params or {})
            return _Resp(payload)

    async def _no_aqi(lat, lon):
        return {}

    async def _no_name(lat, lon):
        return "Jacksonville, Arkansas"

    monkeypatch.setattr(weather.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(weather, "fetch_air_quality", _no_aqi)
    monkeypatch.setattr(weather, "_reverse_geocode", _no_name)
    return asyncio.run(weather.fetch_weather(34.87, -92.11, **kw)), requested


def test_one_overcast_hour_does_not_make_the_day_overcast(monkeypatch):
    # Overcast at 3 AM, mostly partly cloudy through the daylight hours.
    codes = [3] * 7 + [2] * 9 + [1] * 3 + [3] * 5
    data, _ = _fetch(monkeypatch, _payload(codes, daily_worst=3))
    day = data["daily"][0]
    assert day["condition"] == "Partly cloudy"
    assert day["weathercode"] == 2
    assert day["worst_code"] == 3


def test_a_clear_day_reads_clear_not_unknown(monkeypatch):
    data, _ = _fetch(monkeypatch, _payload([0] * 24, daily_worst=0))
    assert data["daily"][0]["condition"] == "Clear sky"


def test_rain_lasting_through_the_day_wins(monkeypatch):
    codes = [2] * 10 + [61, 63, 61] + [2] * 11
    data, _ = _fetch(monkeypatch, _payload(codes, daily_worst=63))
    assert data["daily"][0]["weathercode"] == 63


def test_a_single_passing_shower_does_not(monkeypatch):
    codes = [1] * 12 + [80] + [1] * 11
    data, _ = _fetch(monkeypatch, _payload(codes, daily_worst=80))
    assert data["daily"][0]["weathercode"] == 1


def test_night_is_marked_for_the_icons(monkeypatch):
    data, requested = _fetch(monkeypatch, _payload([0] * 24, current_is_day=0))
    assert "is_day" in requested["current"] and "is_day" in requested["hourly"]
    assert data["current"]["is_day"] is False


def test_no_hourly_data_falls_back_to_the_daily_code(monkeypatch):
    payload = _payload([0] * 24, daily_worst=45)
    payload["hourly"] = {}
    data, _ = _fetch(monkeypatch, payload)
    assert data["daily"][0]["condition"] == "Fog"
