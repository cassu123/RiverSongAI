from __future__ import annotations

import asyncio
import logging
import time
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, Dict, Optional, List
from collections import deque

from config.settings import get_settings

logger = logging.getLogger(__name__)

SEVERITIES = ("info", "warning", "critical")

_DEFAULT_COOLDOWNS = {
    "weather_alert": 6 * 3600,
    "device_alert": 30 * 60,
    "custom": 60,
    "routine": 0, # routines don't cooldown by default
    "maint_due": 24 * 3600,
}
_FALLBACK_COOLDOWN = 15 * 60

@dataclass
class ProactiveItem:
    kind: str                      # "weather_alert" | "device_alert" | "custom" | "routine" | ...
    title: str
    message: str
    severity: str = "info"         # info | warning | critical
    key: str = ""                  # dedupe key within kind (e.g. alert id, unit id)
    user_id: Optional[str] = None  # target one user; None → all admins
    url: Optional[str] = None      # deep-link url
    speak: bool = False            # R5: Whether to deliver via TTS
    ts: float = field(default_factory=time.time)

class DeliveryRouter:
    """The central outbound delivery router for proactive system communications.
    Replaces the legacy InitiativeEngine."""
    
    def __init__(self) -> None:
        self._recent: Deque[dict] = deque(maxlen=100)
        self._last_sent: Dict[tuple, float] = {}
        self._lock = asyncio.Lock()
        
    async def submit(self, ev: ProactiveItem) -> dict:
        try:
            async with self._lock:
                ok, reason = await self._should_deliver(ev)
                
                # record to proactive_log
                store = self._get_store()
                channels = []
                if ok:
                    channels = ["ws", "push"]
                    
                if store and ev.user_id:
                    await store._execute(
                        "INSERT INTO proactive_log (user_id, kind, dedupe_key, severity, title, body, delivered, reason, channels, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (ev.user_id, ev.kind, ev.key, ev.severity, ev.title, ev.message, 1 if ok else 0, reason, json.dumps(channels), datetime.now(timezone.utc).isoformat())
                    )
                
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
            logger.warning("proactive: submit failed: %s", exc)
            return {"delivered": False, "reason": f"error: {exc}"}

    def _get_store(self):
        try:
            from main import get_app
            app = get_app()
            if app:
                return app.state.memory_manager._store
        except Exception:
            pass
        return None

    async def _in_quiet_hours(self, user_id: Optional[str]) -> bool:
        s = get_settings()
        start = getattr(s, "initiative_quiet_start", 22)
        end = getattr(s, "initiative_quiet_end", 7)
        
        # Determine local hour based on user's timezone if available
        user_tz_str = "UTC"
        store = self._get_store()
        
        if user_id and store:
            try:
                # check proactive prefs first
                prefs = await store._fetch_one("SELECT quiet_start, quiet_end FROM proactive_prefs WHERE user_id = ?", (user_id,))
                if prefs:
                    if prefs["quiet_start"] is not None:
                        start = prefs["quiet_start"]
                    if prefs["quiet_end"] is not None:
                        end = prefs["quiet_end"]
                
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
        return hour >= start or hour < end

    async def _should_deliver(self, ev: ProactiveItem) -> tuple[bool, str]:
        s = get_settings()
        if not getattr(s, "initiative_enabled", True):
            return False, "disabled"
            
        if ev.severity not in SEVERITIES:
            ev.severity = "info"
            
        store = self._get_store()
        if ev.user_id and store:
            # check min severity and muted kinds
            try:
                prefs = await store._fetch_one("SELECT min_push_severity, kinds_muted FROM proactive_prefs WHERE user_id = ?", (ev.user_id,))
                if prefs:
                    kinds_muted = []
                    if prefs["kinds_muted"]:
                        kinds_muted = json.loads(prefs["kinds_muted"])
                    if ev.kind in kinds_muted and ev.severity != "critical":
                        return False, "muted"
                    
                    min_sev = prefs["min_push_severity"] or "info"
                    sev_levels = {"info": 0, "warning": 1, "critical": 2}
                    if sev_levels.get(ev.severity, 0) < sev_levels.get(min_sev, 0):
                        return False, "below_min_severity"
            except Exception as e:
                logger.error("Error reading proactive prefs: %s", e)

        if ev.severity != "critical" and await self._in_quiet_hours(ev.user_id):
            return False, "quiet_hours"
            
        cd_key = (ev.kind, ev.key or ev.title)
        cooldown = _DEFAULT_COOLDOWNS.get(ev.kind, _FALLBACK_COOLDOWN)
        
        if store and ev.user_id and cooldown > 0:
            # check recent logs for cooldown
            cutoff = (datetime.now(timezone.utc).timestamp() - cooldown)
            try:
                last_sent = await store._fetch_one(
                    "SELECT created_at FROM proactive_log WHERE user_id = ? AND kind = ? AND dedupe_key = ? AND delivered = 1 ORDER BY created_at DESC LIMIT 1",
                    (ev.user_id, ev.kind, ev.key or ev.title)
                )
                if last_sent:
                    last_ts = datetime.fromisoformat(last_sent["created_at"]).timestamp()
                    if last_ts > cutoff:
                        return False, "cooldown"
            except Exception as e:
                logger.error("Error checking cooldown: %s", e)
        else:
            # fallback for tests or missing store
            last = self._last_sent.get(cd_key, 0)
            if time.time() - last < cooldown:
                return False, "cooldown"

        return True, "ok"

    async def _deliver(self, ev: ProactiveItem) -> None:
        await self._deliver_ws(ev)
        await self._deliver_push(ev)
        await self._deliver_tts(ev)

    async def _deliver_tts(self, ev: ProactiveItem) -> None:
        if not ev.speak and ev.severity != "critical":
            return
            
        try:
            from main import get_app
            app = get_app()
            if not app:
                return
            store = app.state.memory_manager._store
            
            # For Phase R5 seam: pick a target device (freshest activity for now)
            # In future, uses user_presence table.
            device = await store._fetch_one(
                "SELECT id, room FROM devices WHERE user_id = ? AND json_extract(capabilities, '$.tts') = true ORDER BY last_seen DESC LIMIT 1",
                (ev.user_id,)
            )
            
            if not device:
                # No TTS capable device found
                return
                
            # Synthesize audio via warm TTS provider pool
            # For now, this is a seam. Chat plan phase 1 provides TTS.
            logger.info("R5 Seam: Sending TTS to device %s (room %s)", device["id"], device["room"])
            
            # If we had a live TTS socket for this device, we'd send it there
            
        except Exception as e:
            logger.error("Failed TTS delivery: %s", e)

    async def _deliver_ws(self, ev: ProactiveItem) -> int:
        try:
            from main import get_app
            app = get_app()
            if not app:
                return 0
        except Exception:
            return 0
            
        count = 0
        msg = {
            "type": "proactive",
            "kind": ev.kind,
            "title": ev.title,
            "message": ev.message,
            "severity": ev.severity,
        }
        
        targets = app.state.active_connections.get(ev.user_id, []) if ev.user_id else []
        if not ev.user_id:
            for s in app.state.active_connections.values():
                targets.extend(s)
                
        for ws in targets:
            try:
                await ws.send_json(msg)
                count += 1
            except Exception:
                pass
        return count

    async def _deliver_push(self, ev: ProactiveItem) -> None:
        try:
            from providers.push.notifier import notify_user, notify_admins
            from main import get_app
            app = get_app()
            if not app:
                return
            store = app.state.memory_manager._store
            
            title = ev.title or "River Song Alert"
            
            if ev.user_id:
                await notify_user(store, ev.user_id, title=title, body=ev.message, priority="high" if ev.severity == "critical" else "normal", url=ev.url)
            else:
                await notify_admins(store, title=title, body=ev.message, priority="high" if ev.severity == "critical" else "normal")
        except Exception as e:
            logger.warning("Failed to deliver push notification: %s", e)

    def recent(self) -> list[dict]:
        return list(self._recent)

_router: Optional[DeliveryRouter] = None

def get_delivery_router() -> DeliveryRouter:
    global _router
    if _router is None:
        _router = DeliveryRouter()
    return _router
