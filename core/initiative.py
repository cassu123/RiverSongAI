"""
core/initiative.py

The Initiative Engine — lets River Song speak first.

Events flow in from anywhere in the app (device alerts, weather watch,
n8n/custom webhooks). The engine decides whether the moment deserves the
user's attention (enabled? quiet hours? already said this recently?) and
delivers through every live surface:

  - WebSocket: a {"type": "proactive", ...} message to active conversation
    connections (the UI surfaces it as a toast / spoken line)
  - Push: notify_user / notify_admins fan-out (Web Push, FCM, ntfy)

Design rule: restraint. Jarvis isn't chatty — he's timely. Cooldowns
deduplicate, quiet hours silence non-critical events, and everything is
observable via the recent-events ring buffer.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, Dict, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

SEVERITIES = ("info", "warning", "critical")

# Per-kind default cooldown (seconds) keyed on (kind, key) — how long before
# the same logical event may interrupt again.
_DEFAULT_COOLDOWNS = {
    "weather_alert": 6 * 3600,
    "device_alert": 30 * 60,
    "custom": 60,
}
_FALLBACK_COOLDOWN = 15 * 60


@dataclass
class InitiativeEvent:
    kind: str                      # "weather_alert" | "device_alert" | "custom" | ...
    title: str
    message: str
    severity: str = "info"         # info | warning | critical
    key: str = ""                  # dedupe key within kind (e.g. alert id, unit id)
    user_id: Optional[str] = None  # target one user; None → all admins
    ts: float = field(default_factory=time.time)


class InitiativeEngine:
    def __init__(self) -> None:
        self._last_sent: Dict[tuple, float] = {}
        self._recent: Deque[dict] = deque(maxlen=100)
        self._lock = asyncio.Lock()

    # -- decision gates ------------------------------------------------------

    async def _in_quiet_hours(self, user_id: Optional[str]) -> bool:
        s = get_settings()
        start = getattr(s, "initiative_quiet_start", 22)
        end = getattr(s, "initiative_quiet_end", 7)
        
        # Determine local hour based on user's timezone if available
        user_tz_str = "UTC"
        if user_id:
            try:
                from main import get_app
                app = get_app()
                if app:
                    store = app.state.memory_manager._store
                    llm_settings = await store.get_llm_settings(user_id)
                    if isinstance(llm_settings, dict):
                        user_tz_str = llm_settings.get("timezone", "UTC")
                    else:
                        user_tz_str = getattr(llm_settings, "timezone", "UTC")
            except Exception:
                pass
                
        import zoneinfo
        try:
            user_tz = zoneinfo.ZoneInfo(user_tz_str)
        except Exception:
            user_tz = zoneinfo.ZoneInfo("UTC")
            
        now_local = datetime.now(timezone.utc).astimezone(user_tz)
        hour = now_local.hour
        
        if start == end:
            return False
        if start < end:
            return start <= hour < end
        return hour >= start or hour < end  # window crosses midnight

    async def _should_deliver(self, ev: InitiativeEvent) -> tuple[bool, str]:
        s = get_settings()
        if not getattr(s, "initiative_enabled", True):
            return False, "disabled"
        if ev.severity not in SEVERITIES:
            ev.severity = "info"
        if ev.severity != "critical" and await self._in_quiet_hours(ev.user_id):
            return False, "quiet_hours"
        cd_key = (ev.kind, ev.key or ev.title)
        cooldown = _DEFAULT_COOLDOWNS.get(ev.kind, _FALLBACK_COOLDOWN)
        last = self._last_sent.get(cd_key, 0)
        if time.time() - last < cooldown:
            return False, "cooldown"
        return True, "ok"

    # -- delivery --------------------------------------------------------------

    async def submit(self, ev: InitiativeEvent) -> dict:
        """Evaluate an event and deliver it if it passes the gates.

        Never raises — initiative must not break the code paths that feed it.
        Returns {"delivered": bool, "reason": str} for callers/tests.
        """
        try:
            async with self._lock:
                ok, reason = await self._should_deliver(ev)
                record = {
                    "kind": ev.kind, "title": ev.title, "message": ev.message,
                    "severity": ev.severity, "key": ev.key, "user_id": ev.user_id,
                    "ts": ev.ts, "delivered": ok, "reason": reason,
                }
                self._recent.appendleft(record)
                if not ok:
                    return {"delivered": False, "reason": reason}
                self._last_sent[(ev.kind, ev.key or ev.title)] = time.time()

            await self._deliver(ev)
            return {"delivered": True, "reason": "ok"}
        except Exception as exc:
            logger.warning("initiative: submit failed: %s", exc)
            return {"delivered": False, "reason": f"error: {exc}"}

    async def _deliver(self, ev: InitiativeEvent) -> None:
        delivered_ws = await self._deliver_ws(ev)
        await self._deliver_push(ev)
        logger.info("initiative: delivered %s/%s (severity=%s, ws=%d sockets)",
                    ev.kind, ev.key or ev.title, ev.severity, delivered_ws)

    async def _deliver_ws(self, ev: InitiativeEvent) -> int:
        """Send to live conversation WebSockets. Returns socket count."""
        try:
            from main import get_app
            app = get_app()
            connections = getattr(app.state, "active_connections", {}) if app else {}
        except Exception:
            return 0
        payload = {
            "type": "proactive",
            "kind": ev.kind,
            "title": ev.title,
            "message": ev.message,
            "severity": ev.severity,
        }
        targets = ([ev.user_id] if ev.user_id else list(connections.keys()))
        count = 0
        for uid in targets:
            for ws in list(connections.get(uid, [])):
                try:
                    await ws.send_json(payload)
                    count += 1
                except Exception:
                    pass  # dead socket; the route's own cleanup handles it
        return count

    async def _deliver_push(self, ev: InitiativeEvent) -> None:
        s = get_settings()
        if not getattr(s, "initiative_push_enabled", True):
            return
        try:
            from main import get_app
            from providers.push.notifier import notify_admins, notify_user
            app = get_app()
            store = getattr(app.state, "memory_manager", None) if app else None
            store = store._store if store else None
            if store is None:
                return
            if ev.user_id:
                await notify_user(store, ev.user_id, ev.title, ev.message)
            else:
                await notify_admins(store, ev.title, ev.message)
        except Exception as exc:
            logger.debug("initiative: push delivery skipped: %s", exc)

    def recent(self) -> list[dict]:
        return list(self._recent)


_engine: Optional[InitiativeEngine] = None


def get_initiative_engine() -> InitiativeEngine:
    global _engine
    if _engine is None:
        _engine = InitiativeEngine()
    return _engine


# ---------------------------------------------------------------------------
# Weather watcher — River's first sense. Polls NWS alerts for the configured
# home coordinates and raises an initiative event per new alert.
# ---------------------------------------------------------------------------

_WATCH_INTERVAL_S = 15 * 60


async def weather_watch_loop() -> None:
    from providers.feeds.weather import fetch_nws_alerts
    engine = get_initiative_engine()
    logger.info("initiative: weather watcher started")
    while True:
        try:
            s = get_settings()
            if getattr(s, "initiative_weather_alerts", True) and s.latitude and s.longitude:
                alerts = await fetch_nws_alerts(s.latitude, s.longitude)
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
        except Exception as exc:
            logger.warning("initiative: weather watch iteration failed: %s", exc)
        await asyncio.sleep(_WATCH_INTERVAL_S)
