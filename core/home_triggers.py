"""
core/home_triggers.py

Device-event triggers — phase H4 of docs/smart-home-plan.md.

River is the automation brain; Home Assistant is the device layer. HA's own
automations are left alone. A routine with trigger="device" carries a
trigger_config describing what to watch:

    {
      "entity_id":    "binary_sensor.garage_door",   # or
      "area":         "Kitchen",                     # or
      "device_class": "moisture",                    # any combination
      "to_state":     "on",
      "for_seconds":  600,
      "time_window":  {"start": "22:00", "end": "06:00"}
    }

Matching is AND across whichever selectors are present, so an empty config
would match everything — it is rejected instead.

The engine subscribes once to the HA event bus (core/home_events) and fans
out to every enabled device routine. Delivery goes through the DeliveryRouter,
never straight to push, so quiet hours, severity gating and cooldowns apply in
one place.
"""

from __future__ import annotations

import asyncio
import logging
import time
import zoneinfo
from datetime import datetime, time as dtime
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# A pending "state must hold for N seconds" timer, keyed by (routine, entity).
_PendingKey = tuple


def parse_hhmm(value: str) -> Optional[dtime]:
    try:
        hh, mm = value.split(":")
        return dtime(int(hh), int(mm))
    except Exception:
        return None


def in_time_window(now_local: datetime, window: Optional[dict]) -> bool:
    """Is now inside the window? Windows that cross midnight are supported.

    A window of 22:00-06:00 means "late at night", which is two intervals on
    the clock face, not one. Comparing start <= now <= end would make that
    window match nothing at all.
    """
    if not window:
        return True
    start = parse_hhmm(window.get("start", ""))
    end = parse_hhmm(window.get("end", ""))
    if not start or not end:
        return True
    now_t = now_local.time()
    if start <= end:
        return start <= now_t <= end
    return now_t >= start or now_t <= end


def matches(config: dict, entity_id: str, new_state: dict,
            area: Optional[str]) -> bool:
    """Does this event satisfy the routine's selectors?

    Every selector present must match. A config with no selector at all is
    refused by the caller rather than treated as "match everything".
    """
    if config.get("entity_id") and config["entity_id"] != entity_id:
        return False
    if config.get("area"):
        if not area or area.lower() != str(config["area"]).lower():
            return False
    if config.get("device_class"):
        attrs = new_state.get("attributes") or {}
        if attrs.get("device_class") != config["device_class"]:
            return False
    if config.get("domain") and entity_id.split(".")[0] != config["domain"]:
        return False
    to_state = config.get("to_state")
    if to_state is not None and str(new_state.get("state")) != str(to_state):
        return False
    return True


def has_selector(config: dict) -> bool:
    return any(config.get(k) for k in
               ("entity_id", "area", "device_class", "domain"))


def explain(config: dict, entity_id: str, new_state: dict,
            area: Optional[str], now_local: datetime) -> dict:
    """Why a rule would or would not fire for this event — without firing it.

    Exists so a rule can be checked without staging the real-world condition.
    Nobody should have to flood a bathroom to find out whether the leak alert
    is wired up correctly.
    """
    if not has_selector(config):
        return {"would_fire": False,
                "reason": "no selector — the rule matches nothing on purpose"}

    for label, ok in (
        ("entity_id", not config.get("entity_id")
                      or config["entity_id"] == entity_id),
        ("area", not config.get("area") or (
            area and area.lower() == str(config["area"]).lower())),
        ("device_class", not config.get("device_class") or (
            (new_state.get("attributes") or {}).get("device_class")
            == config["device_class"])),
        ("domain", not config.get("domain")
                   or entity_id.split(".")[0] == config["domain"]),
        ("to_state", config.get("to_state") is None
                     or str(new_state.get("state")) == str(config["to_state"])),
    ):
        if not ok:
            return {"would_fire": False, "reason": f"{label} does not match"}

    if not in_time_window(now_local, config.get("time_window")):
        w = config["time_window"]
        return {"would_fire": False,
                "reason": (f"outside the {w.get('start')}-{w.get('end')} "
                           f"window (local time is "
                           f"{now_local.strftime('%H:%M')})")}

    hold = config.get("for_seconds") or 0
    if hold:
        return {"would_fire": True, "delay_seconds": float(hold),
                "reason": f"matches; fires if it holds for {hold}s"}
    return {"would_fire": True, "delay_seconds": 0.0, "reason": "matches"}


class HomeTriggerEngine:
    """Watches the HA event bus and fires device-triggered routines."""

    def __init__(self, app) -> None:
        self._app = app
        self._pending: Dict[_PendingKey, asyncio.Task] = {}
        self._areas: Dict[str, Optional[str]] = {}
        self._areas_at: float = 0.0
        self._started = False

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        from core.home_events import get_home_bus
        if self._started:
            return
        get_home_bus().subscribe(self.on_event)
        self._started = True
        logger.info("Home trigger engine listening for device events.")

    def stop(self) -> None:
        from core.home_events import get_home_bus
        if not self._started:
            return
        get_home_bus().unsubscribe(self.on_event)
        for task in self._pending.values():
            task.cancel()
        self._pending.clear()
        self._started = False

    # -- helpers -----------------------------------------------------------

    @property
    def _store(self):
        return self._app.state.memory_manager._store

    async def _area_for(self, entity_id: str) -> Optional[str]:
        """Entity -> area, cached for a minute.

        Every state change would otherwise hit SQLite, and a busy house emits
        a lot of them.
        """
        if time.time() - self._areas_at > 60:
            try:
                rows = await self._store.execute_read_async(
                    "SELECT entity_id, area FROM ha_entities")
                self._areas = {r["entity_id"]: r["area"] for r in rows}
                self._areas_at = time.time()
            except Exception as e:
                logger.debug("area lookup failed: %s", e)
        return self._areas.get(entity_id)

    async def _user_tz(self, user_id: str) -> zoneinfo.ZoneInfo:
        try:
            settings = await self._store.get_llm_settings(user_id)
            tz = (settings.get("timezone") if isinstance(settings, dict)
                  else getattr(settings, "timezone", None)) or "UTC"
            return zoneinfo.ZoneInfo(tz)
        except Exception:
            return zoneinfo.ZoneInfo("UTC")

    async def _device_routines(self) -> list:
        try:
            routines = await self._store.get_enabled_routines()
        except Exception as e:
            logger.error("Could not load routines: %s", e)
            return []
        return [r for r in routines if r.get("trigger") == "device"]

    # -- the hot path ------------------------------------------------------

    async def on_event(self, entity_id: str, new_state: dict,
                       old_state: dict) -> None:
        """One HA state change. Never raises — the bus has other subscribers."""
        try:
            await self._handle(entity_id, new_state, old_state)
        except Exception as e:
            logger.error("Home trigger evaluation failed for %s: %s",
                         entity_id, e)

    async def _handle(self, entity_id: str, new_state: dict,
                      old_state: dict) -> None:
        routines = await self._device_routines()
        if not routines:
            return
        area = await self._area_for(entity_id)
        new_value = str(new_state.get("state"))
        old_value = str((old_state or {}).get("state"))

        for r in routines:
            config = r.get("trigger_config") or {}
            if not has_selector(config):
                continue
            key = (r["id"], entity_id)

            if not matches(config, entity_id, new_state, area):
                # The condition stopped holding — cancel any countdown.
                self._cancel(key)
                continue

            # Only act on an actual transition into the state, not on the
            # repeat updates HA sends while a sensor sits in it (attribute
            # changes re-emit state_changed with the same state).
            if new_value == old_value:
                continue

            # float, not int: int(0.5) is 0, which would turn a sub-second
            # hold into "fire immediately" without saying so.
            try:
                hold = float(config.get("for_seconds") or 0)
            except (TypeError, ValueError):
                hold = 0.0
            if hold > 0:
                self._schedule(key, hold, r, entity_id, new_state, area)
            else:
                await self._fire(r, entity_id, new_state, area)

    def _cancel(self, key: _PendingKey) -> None:
        task = self._pending.pop(key, None)
        if task:
            task.cancel()

    def _schedule(self, key, hold: float, routine: dict, entity_id: str,
                  new_state: dict, area: Optional[str]) -> None:
        """Fire only if the state is still held after `hold` seconds."""
        self._cancel(key)

        async def _later():
            try:
                await asyncio.sleep(hold)
                await self._fire(routine, entity_id, new_state, area)
            except asyncio.CancelledError:
                pass
            finally:
                # Only clear our own entry. A cancelled task's finally runs on
                # a later loop iteration, by which point _schedule may have
                # registered a replacement under this key — popping blindly
                # would orphan that timer, so the next close event would find
                # nothing to cancel and the door alert would fire anyway.
                if self._pending.get(key) is task:
                    self._pending.pop(key, None)

        task = asyncio.create_task(_later())
        self._pending[key] = task

    async def _fire(self, routine: dict, entity_id: str, new_state: dict,
                    area: Optional[str]) -> None:
        config = routine.get("trigger_config") or {}
        user_id = routine.get("user_id")

        tz = await self._user_tz(user_id)
        if not in_time_window(datetime.now(tz), config.get("time_window")):
            return

        friendly = (new_state.get("attributes") or {}).get(
            "friendly_name", entity_id)
        logger.info("Device trigger '%s' fired on %s", routine.get("name"),
                    entity_id)

        if routine.get("prompt"):
            # An authored routine: run it through the agent loop so it can use
            # tools, with the event that triggered it in context.
            try:
                from core.routines_scheduler import _run_proactive_routine
                enriched = dict(routine)
                enriched["prompt"] = (
                    f"{routine['prompt']}\n\n"
                    f"[Triggered by {friendly} ({entity_id}) becoming "
                    f"{new_state.get('state')}"
                    + (f" in the {area}]" if area else "]")
                )
                await _run_proactive_routine(self._app, user_id, enriched)
                return
            except Exception as e:
                logger.error("Agent run failed for '%s', falling back to a "
                             "plain alert: %s", routine.get("name"), e)

        # No prompt (or the agent failed): announce the event itself.
        await self._alert(routine, friendly, new_state, area)

    async def _alert(self, routine: dict, friendly: str, new_state: dict,
                     area: Optional[str]) -> None:
        from core.proactive import ProactiveItem, get_delivery_router
        router = get_delivery_router()

        where = f" in the {area}" if area else ""
        await router.submit(ProactiveItem(
            kind="device_alert",
            title=routine.get("name") or "Home",
            message=f"{friendly}{where} is {new_state.get('state')}.",
            severity=routine.get("severity") or "warning",
            # Dedupe per rule+entity so a flapping sensor is not a broadcast
            # storm; the router's cooldown does the rest.
            key=f"{routine['id']}:{new_state.get('entity_id', friendly)}",
            user_id=routine.get("user_id"),
        ))


_engine: Optional[HomeTriggerEngine] = None


def get_trigger_engine(app=None) -> Optional[HomeTriggerEngine]:
    global _engine
    if _engine is None and app is not None:
        _engine = HomeTriggerEngine(app)
    return _engine


# ---------------------------------------------------------------------------
# Phase H5 — the built-in safety pack
#
# These are ordinary device-trigger routines flagged builtin, not a separate
# code path, so they run through the same evaluator and the same delivery as
# anything authored by voice. Each is individually editable and disableable;
# a rule whose sensor class does not exist in the house simply never matches,
# which is why there is no setup nagging.
# ---------------------------------------------------------------------------

BUILTIN_SAFETY_RULES = [
    {
        "key": "builtin_leak",
        "name": "Water leak",
        "severity": "critical",
        "trigger_config": {"device_class": "moisture", "to_state": "on"},
    },
    {
        "key": "builtin_smoke",
        "name": "Smoke detected",
        "severity": "critical",
        "trigger_config": {"device_class": "smoke", "to_state": "on"},
    },
    {
        "key": "builtin_gas",
        "name": "Gas detected",
        "severity": "critical",
        "trigger_config": {"device_class": "gas", "to_state": "on"},
    },
    {
        "key": "builtin_co",
        "name": "Carbon monoxide detected",
        "severity": "critical",
        "trigger_config": {"device_class": "carbon_monoxide", "to_state": "on"},
    },
    {
        "key": "builtin_door_open",
        "name": "Door left open",
        "severity": "warning",
        "trigger_config": {"device_class": "door", "to_state": "on",
                           "for_seconds": 600},
    },
    {
        "key": "builtin_garage_open",
        "name": "Garage left open",
        "severity": "warning",
        "trigger_config": {"device_class": "garage_door", "to_state": "on",
                           "for_seconds": 600},
    },
    {
        "key": "builtin_unlocked_late",
        "name": "Unlocked late at night",
        "severity": "warning",
        "trigger_config": {"domain": "lock", "to_state": "unlocked",
                           "time_window": {"start": "22:00", "end": "06:00"}},
    },
]


async def ensure_builtin_safety_routines(store, user_id: str) -> int:
    """Create any missing builtin rules for this user. Idempotent.

    Keyed on the routine id, so re-running never duplicates and never
    resurrects a rule the owner deliberately disabled or edited — an existing
    id is left exactly as it is.
    """
    created = 0
    try:
        existing = {r["id"] for r in await store.list_routines(user_id)}
    except Exception as e:
        logger.error("Could not read routines for %s: %s", user_id, e)
        return 0

    for rule in BUILTIN_SAFETY_RULES:
        rid = f"{user_id}:{rule['key']}"
        if rid in existing:
            continue
        try:
            await store.create_routine({
                "id": rid,
                "user_id": user_id,
                "name": rule["name"],
                "trigger": "device",
                "prompt": "",          # alert only; no agent run needed
                "type": "alert",
                "severity": rule["severity"],
                "enabled": True,
                "builtin": True,
                "trigger_config": rule["trigger_config"],
            })
            created += 1
        except Exception as e:
            logger.error("Could not create builtin rule %s: %s", rid, e)
    if created:
        logger.info("Created %d builtin safety rules for %s", created, user_id)
    return created
