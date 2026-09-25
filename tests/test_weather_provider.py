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


# ── Rain outlook ─────────────────────────────────────────────────────────────

NOW = f"{DAY}T13:00"


def _min(*mm):
    return [{"time": f"{DAY}T{13 + (i * 15) // 60:02d}:{(i * 15) % 60:02d}", "precipitation": v}
            for i, v in enumerate(mm)]


def _hr(probs, code=61, start=13, date=DAY):
    out = []
    for i, p in enumerate(probs):
        h = start + i
        d = date if h < 24 else "2026-09-26"
        out.append({"time": f"{d}T{h % 24:02d}:00", "precip_prob": p, "weathercode": code})
    return out


def test_outlook_rain_starting_soon():
    assert weather.rain_outlook(NOW, _min(0, 0, 0.3, 0.5), _hr([40])) == \
        "Rain starting in about 30 minutes."


def test_outlook_rain_now_easing():
    assert weather.rain_outlook(NOW, _min(0.4, 0.2, 0, 0, 0), _hr([90])) == \
        "Rain now, easing by 1:30 PM."


def test_outlook_likely_later_and_tomorrow():
    assert weather.rain_outlook(NOW, _min(0, 0), _hr([0, 10, 60])) == "Rain likely around 3 PM."
    later = _hr([0] * 13 + [70])  # 13:00 + 13h = 2 AM next day
    assert weather.rain_outlook(NOW, _min(0), later) == "Rain likely around 2 AM tomorrow."


def test_outlook_storms_and_slight_chance():
    assert weather.rain_outlook(NOW, [], _hr([0, 55], code=95)) == "Storms likely around 2 PM."
    assert weather.rain_outlook(NOW, [], _hr([5, 25, 10])) == \
        "Slight chance of rain around 2 PM (25%)."


def test_outlook_dry():
    assert weather.rain_outlook(NOW, _min(0, 0), _hr([0, 5, 10])) == \
        "No rain expected in the next 24 hours."


# ── The fuller request, and its fallback ─────────────────────────────────────

def test_full_request_carries_the_new_fields(monkeypatch):
    data, requested = _fetch(monkeypatch, _payload([0] * 24))
    assert "minutely_15" in requested and requested["forecast_days"] == 10
    assert "precipitation_probability_max" in requested["daily"]
    assert "outlook" in data and "minutely" in data


def test_a_refused_full_request_falls_back_to_the_basic_one(monkeypatch):
    payload = _payload([0] * 24)
    calls = []

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, **k):
            calls.append(params or {})
            if params and "minutely_15" in params:
                r = _Resp({"error": True, "reason": "Cannot initialize ..."})
                r.status_code = 400
                r.text = "Cannot initialize ..."
                return r
            return _Resp(payload)

    async def _nothing(*a):
        return {}

    monkeypatch.setattr(weather.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(weather, "fetch_air_quality", _nothing)
    monkeypatch.setattr(weather, "_reverse_geocode", _nothing)
    data = asyncio.run(weather.fetch_weather(34.87, -92.11))
    assert data["current"]["temperature"] == 68
    assert "minutely_15" not in calls[1] and calls[1]["forecast_days"] == 7


# ── NWS text forecast ────────────────────────────────────────────────────────

def test_nws_text_forecast(monkeypatch):
    weather._nws_points.clear()
    pages = {
        "https://api.weather.gov/points/34.8700,-92.1100": {"properties": {
            "forecast": "https://api.weather.gov/gridpoints/LZK/90,70/forecast"}},
        "https://api.weather.gov/gridpoints/LZK/90,70/forecast": {"properties": {"periods": [
            {"name": "Tonight", "shortForecast": "Mostly Clear",
             "detailedForecast": "Mostly clear, with a low around 59.",
             "temperature": 59, "temperatureUnit": "F", "isDaytime": False,
             "probabilityOfPrecipitation": {"value": None}},
        ]}},
    }

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **k):
            if url not in pages:
                r = _Resp({})
                r.status_code = 404
                return r
            return _Resp(pages[url])

    monkeypatch.setattr(weather.httpx, "AsyncClient", _Client)
    periods = asyncio.run(weather.fetch_nws_forecast(34.87, -92.11))
    assert periods == [{"name": "Tonight", "short": "Mostly Clear",
                        "detailed": "Mostly clear, with a low around 59.",
                        "temperature": 59, "temperature_unit": "F",
                        "is_day": False, "precip_prob": None}]
    # Outside the US the point lookup 404s: no text, no error.
    assert asyncio.run(weather.fetch_nws_forecast(51.5, -0.12)) == []
