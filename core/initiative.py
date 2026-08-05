"""
core/initiative.py

Legacy alias module. The Initiative Engine has been replaced by the
DeliveryRouter in core/proactive.py.
"""
from core.proactive import (
    DeliveryRouter as InitiativeEngine,
    ProactiveItem as InitiativeEvent,
    get_delivery_router as get_initiative_engine,
    SEVERITIES
)

__all__ = [
    "InitiativeEngine",
    "InitiativeEvent",
    "get_initiative_engine",
    "SEVERITIES"
]


# ---------------------------------------------------------------------------
# Weather watcher — River's first sense. Polls NWS alerts for the configured
# home coordinates and raises an initiative event per new alert.
# ---------------------------------------------------------------------------

import asyncio
import logging
from config.settings import get_settings

logger = logging.getLogger(__name__)

_WATCH_INTERVAL_S = 15 * 60


async def weather_sweep_func() -> None:
    from providers.feeds.weather import fetch_nws_alerts
    engine = get_initiative_engine()
    s = get_settings()
    # location_lat / location_lon are the real setting names. This read
    # `s.latitude` / `s.longitude`, which do not exist on Settings, so the
    # sweep raised AttributeError on every run instead of quietly skipping
    # when no location is configured.
    if getattr(s, "initiative_weather_alerts", True) and s.location_lat and s.location_lon:
        alerts = await fetch_nws_alerts(s.location_lat, s.location_lon)
        for a in alerts or []:
            event_name = a.get("event") or "Weather alert"
            severity = "critical" if any(
                w in event_name.lower()
                for w in ("warning", "tornado", "severe", "flash flood")
            ) else "warning"
            await engine.submit(InitiativeEvent(
                kind="weather_alert",
                title=f"Weather: {event_name}",
                message=(a.get("headline") or a.get("description") or "")[:300],
                severity=severity,
                key=str(a.get("id") or event_name),
            ))
