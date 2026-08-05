"""
core/vortex_replica.py

The local copy a River Vortex unit renders from.

Units have no cellular. When WiFi drops, or when this server reboots, they are
fully offline — so the UI cannot block on the network for anything a person
looks at. The replica is the answer: the unit keeps a copy of everything it
draws, and this module is what fills and updates it.

What is in it:

    devices        the household's controllable HA entities  (Task 7)
    cameras        HA camera entities with snapshot URLs      (Task 7)
    notifications  active notifications                       (Task 7)
    rooms          room list and activity from the context engine
    weather        current conditions + forecast              (Task 1b)
    weather_alerts severe weather warnings                    (Task 1b)
    wake_word      the household's wake phrase and threshold
    unit           this unit's own settings

Weather rides here rather than on `/api/feeds/weather` deliberately: a unit
holds a unit token, not a user JWT, and folding weather into the replica means
the ambient screen keeps showing yesterday's-still-roughly-right conditions
while this server is unreachable, instead of "Weather loading…" forever.

Versioning is per section. `GET /api/vortex/replica?since=N` returns only the
sections that changed after version N, plus a new stamp. A unit that has been
off for a week and a unit that reconnected after eight seconds both ask the
same question and get the right-sized answer.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

SECTIONS = (
    "devices", "cameras", "notifications", "rooms",
    "weather", "weather_alerts", "wake_word",
)

# How stale a cached section may get before a read rebuilds it. Device state
# also arrives by push, so this is the backstop rather than the mechanism.
_STALE_AFTER_SECONDS = 60.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprint(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


class _HouseholdReplica:
    """Per-owner cache: section payloads, their fingerprints and versions."""

    def __init__(self, owner_user_id: str) -> None:
        self.owner_user_id = owner_user_id
        self.version = 0
        self.payloads: Dict[str, Any] = {}
        self.fingerprints: Dict[str, str] = {}
        self.versions: Dict[str, int] = {}
        self.built_at = 0.0
        self.lock = LoopLock()


class ReplicaService:
    """Builds, versions and pushes the unit-facing replica."""

    def __init__(self) -> None:
        self._households: Dict[str, _HouseholdReplica] = {}
        # Weather-alert surface ids currently on screen, so a warning that
        # lapses is withdrawn rather than left to time out.
        self._live_weather_surfaces: set = set()

    def _household(self, owner_user_id: str) -> _HouseholdReplica:
        replica = self._households.get(owner_user_id)
        if replica is None:
            replica = _HouseholdReplica(owner_user_id)
            self._households[owner_user_id] = replica
        return replica

    # -- building ---------------------------------------------------------

    async def refresh(self, owner_user_id: str,
                      sections: Optional[List[str]] = None) -> List[str]:
        """
        Rebuild sections and bump the version of every one that changed.

        Returns the names of the sections that actually changed, so callers
        can skip a push when nothing moved.
        """
        replica = self._household(owner_user_id)
        wanted = list(sections or SECTIONS)

        async with replica.lock:
            results = await asyncio.gather(
                *(self._build_section(name, owner_user_id) for name in wanted),
                return_exceptions=True,
            )

            changed: List[str] = []
            for name, payload in zip(wanted, results):
                if isinstance(payload, BaseException):
                    logger.warning("Replica section '%s' failed for %s: %s",
                                   name, owner_user_id, payload)
                    continue
                fingerprint = _fingerprint(payload)
                if replica.fingerprints.get(name) == fingerprint:
                    continue
                replica.version += 1
                replica.payloads[name] = payload
                replica.fingerprints[name] = fingerprint
                replica.versions[name] = replica.version
                changed.append(name)

            replica.built_at = asyncio.get_running_loop().time()

        if changed:
            logger.debug("Replica for %s changed: %s (v%d)",
                         owner_user_id, changed, replica.version)
        return changed

    async def _build_section(self, name: str, owner_user_id: str) -> Any:
        builder = getattr(self, f"_section_{name}", None)
        if builder is None:
            raise ValueError(f"Unknown replica section '{name}'")
        return await builder(owner_user_id)

    # -- sections ---------------------------------------------------------

    async def _section_devices(self, owner_user_id: str) -> List[Dict[str, Any]]:
        """The household's controllable entities, straight from /api/home."""
        from api.routes.home import collect_devices
        return await collect_devices()

    async def _section_cameras(self, owner_user_id: str) -> List[Dict[str, Any]]:
        """
        HA camera entities with snapshot URLs.

        The snapshot URL is proxied through this server (`/api/vortex/camera/
        {entity_id}/snapshot`) rather than handed over as a Home Assistant URL
        with a token attached — units never hold HA credentials (invariant 3).
        """
        from api.routes.home import collect_raw_states
        cameras = []
        for state in await collect_raw_states():
            entity_id = state.get("entity_id", "")
            if not entity_id.startswith("camera."):
                continue
            attrs = state.get("attributes", {})
            cameras.append({
                "entity_id": entity_id,
                "name": attrs.get("friendly_name", entity_id),
                "state": state.get("state"),
                "snapshot_url": f"/api/vortex/camera/{entity_id}/snapshot",
                "motion_detection": attrs.get("motion_detection"),
                "brand": attrs.get("brand"),
            })
        return cameras

    async def _section_notifications(self, owner_user_id: str) -> List[Dict[str, Any]]:
        """
        Active notifications: HA persistent notifications plus unacked alerts
        raised by the household's own units.
        """
        from api.routes.home import collect_raw_states
        notifications: List[Dict[str, Any]] = []

        for state in await collect_raw_states():
            entity_id = state.get("entity_id", "")
            if not entity_id.startswith("persistent_notification."):
                continue
            attrs = state.get("attributes", {})
            notifications.append({
                "id": entity_id,
                "source": "home_assistant",
                "title": attrs.get("title") or attrs.get("friendly_name") or "Notification",
                "message": attrs.get("message", ""),
                "created_at": attrs.get("created_at"),
            })

        try:
            from providers.memory.sqlite_store import SQLiteStore
            from core.vortex_units import list_profiles

            unit_ids = [p["unit_id"] for p in await list_profiles(owner_user_id)]
            if unit_ids:
                store = SQLiteStore()
                placeholders = ",".join("?" for _ in unit_ids)
                rows = await store.execute_read_async(
                    "SELECT id, unit_id, timestamp, level, message FROM fleet_alerts "
                    f"WHERE program='vortex' AND unit_id IN ({placeholders}) "
                    "ORDER BY id DESC LIMIT 20",
                    tuple(unit_ids),
                )
                for row in rows:
                    notifications.append({
                        "id": f"alert:{row['id']}",
                        "source": "vortex",
                        "title": f"{row['level'].title()} — {row['unit_id']}",
                        "message": row["message"],
                        "created_at": row["timestamp"],
                    })
        except Exception as exc:
            logger.debug("Vortex alert notifications unavailable: %s", exc)

        return notifications

    async def _section_rooms(self, owner_user_id: str) -> Dict[str, Any]:
        """Rooms and their activity, from the context engine."""
        try:
            from main import get_app
            app = get_app()
            if app and hasattr(app.state, "context_engine"):
                return app.state.context_engine.get_rooms() or {}
        except Exception as exc:
            logger.debug("Room data unavailable: %s", exc)
        return {}

    async def _section_weather(self, owner_user_id: str) -> Optional[Dict[str, Any]]:
        store = _memory_store()
        if store is None:
            return None
        try:
            from api.services.feed_service import FeedService
            return await FeedService.get_weather(store, owner_user_id)
        except Exception as exc:
            # A household with no saved location is the common case here, not
            # an error — the ambient screen simply has no weather to show.
            logger.debug("Weather unavailable for %s: %s", owner_user_id, exc)
            return None

    async def _section_weather_alerts(self, owner_user_id: str) -> List[Dict[str, Any]]:
        store = _memory_store()
        if store is None:
            return []
        try:
            from api.services.feed_service import FeedService
            result = await FeedService.get_weather_alerts(store, owner_user_id)
            return result.get("alerts") or []
        except Exception as exc:
            logger.debug("Weather alerts unavailable for %s: %s", owner_user_id, exc)
            return []

    async def _section_wake_word(self, owner_user_id: str) -> Dict[str, Any]:
        """
        The household's wake word configuration.

        openWakeWord, not Porcupine — the model name is the openWakeWord model
        id and the unit loads it locally. Detection stays on the device; this
        is configuration, not inference.
        """
        from config.settings import get_settings
        settings = get_settings()
        return {
            "enabled": bool(getattr(settings, "wake_word_enabled", False)),
            "model": getattr(settings, "wake_word_model", "") or "",
            "threshold": float(getattr(settings, "wake_word_threshold", 0.5) or 0.5),
            "framework": getattr(settings, "wake_word_inference_framework", "onnx"),
            "engine": "openwakeword",
        }

    # -- reading ----------------------------------------------------------

    async def snapshot(self, owner_user_id: str, *, unit_id: Optional[str] = None,
                       since: Optional[int] = None) -> Dict[str, Any]:
        """
        Return the replica, or just what changed since `since`.

        A `since` ahead of the current version (this server restarted and its
        counter went back to zero) is treated as no `since` at all: the unit
        gets a full snapshot rather than silently nothing.
        """
        replica = self._household(owner_user_id)
        loop = asyncio.get_running_loop()
        if not replica.payloads or (loop.time() - replica.built_at) > _STALE_AFTER_SECONDS:
            await self.refresh(owner_user_id)

        full = since is None or since < 0 or since > replica.version

        out: Dict[str, Any] = {
            "version": replica.version,
            "generated_at": _now_iso(),
            "full": full,
        }
        for name in SECTIONS:
            if name not in replica.payloads:
                continue
            if full or replica.versions.get(name, 0) > (since or 0):
                out[name] = replica.payloads[name]

        if unit_id:
            out["unit"] = await self._unit_block(unit_id)
        return out

    async def _unit_block(self, unit_id: str) -> Dict[str, Any]:
        """The unit's own settings and what this server believes it can do."""
        from core.vortex_units import get_profile
        profile = await get_profile(unit_id) or {}
        return {
            "unit_id": unit_id,
            "room": profile.get("room", ""),
            "has_display": bool(profile.get("has_display", True)),
            "camera": profile.get("camera", {}),
            "settings": profile.get("settings", {}),
        }

    # -- pushing ----------------------------------------------------------

    async def push_updates(self, owner_user_id: str,
                           sections: Optional[List[str]] = None) -> int:
        """
        Rebuild, then push what changed to that household's connected units.

        Sends both the generic `replica` delta and the three specific messages
        the device layer already listens for (`devices_update`,
        `cameras_update`, `notifications_update`), so the device grid, camera
        page and notification bar populate without a device-side change.
        """
        changed = await self.refresh(owner_user_id, sections)
        if not changed:
            return 0

        from core.vortex_hub import get_vortex_hub
        from core.vortex_units import list_profiles

        replica = self._household(owner_user_id)
        hub = get_vortex_hub()
        unit_ids = [p["unit_id"] for p in await list_profiles(owner_user_id)
                    if hub.is_connected(p["unit_id"])]
        if not unit_ids:
            return 0

        delta = {"version": replica.version,
                 "changed": changed,
                 "generated_at": _now_iso()}
        for name in changed:
            delta[name] = replica.payloads[name]

        delivered = await hub.send_many(unit_ids, "replica", delta)

        for name, message_type in (("devices", "devices_update"),
                                   ("cameras", "cameras_update"),
                                   ("notifications", "notifications_update")):
            if name in changed:
                await hub.send_many(unit_ids, message_type,
                                    {"data": replica.payloads[name]})

        if "weather_alerts" in changed:
            await self._raise_weather_alert_surfaces(replica.payloads["weather_alerts"])

        return delivered

    async def _raise_weather_alert_surfaces(
            self, alerts: List[Dict[str, Any]]) -> None:
        """
        Turn severe weather warnings into `high` surfaces, and withdraw the
        ones that have expired.

        A wall panel is exactly the right place for a severe weather warning,
        and a warning that has lapsed should come off the screen by itself.
        """
        from core.vortex_surfaces import get_surface_publisher, publish_weather_alert

        publisher = get_surface_publisher()
        live_ids = set()
        for alert in alerts[:3]:
            result = await publish_weather_alert(alert)
            live_ids.add(result["id"])

        for stale in self._live_weather_surfaces - live_ids:
            await publisher.withdraw(stale)
        self._live_weather_surfaces = live_ids

    async def push_to_unit(self, unit_id: str, owner_user_id: str) -> bool:
        """Send a full replica to one unit — used the moment it connects."""
        from core.vortex_hub import get_vortex_hub

        snapshot = await self.snapshot(owner_user_id, unit_id=unit_id)
        hub = get_vortex_hub()
        ok = await hub.send(unit_id, "replica", snapshot)
        for name, message_type in (("devices", "devices_update"),
                                   ("cameras", "cameras_update"),
                                   ("notifications", "notifications_update")):
            if name in snapshot:
                await hub.send(unit_id, message_type, {"data": snapshot[name]})
        return ok

    def invalidate(self, owner_user_id: str) -> None:
        """Force the next read to rebuild — call after changing device state."""
        replica = self._households.get(owner_user_id)
        if replica is not None:
            replica.built_at = 0.0

    def reset(self) -> None:
        """Drop all cached replicas. Test helper."""
        self._households.clear()
        self._live_weather_surfaces = set()


def _memory_store() -> Any:
    """The SQLite store the feed service reads preferences from."""
    try:
        from main import get_app
        app = get_app()
        memory_manager = getattr(getattr(app, "state", None), "memory_manager", None)
        if memory_manager is not None:
            return memory_manager._store
    except Exception:
        pass
    return None


_service: Optional[ReplicaService] = None


def get_replica_service() -> ReplicaService:
    """Return the shared ReplicaService."""
    global _service
    if _service is None:
        _service = ReplicaService()
    return _service
