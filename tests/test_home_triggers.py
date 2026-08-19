"""Unit tests for core.home_triggers — phase H4/H5 of the smart-home plan.

These cover the parts that are easy to get wrong and impossible to eyeball:
midnight-crossing time windows, selector matching, the for_seconds hold, and
idempotent creation of the builtin safety pack.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
import zoneinfo

import pytest

from core.home_triggers import (
    BUILTIN_SAFETY_RULES,
    HomeTriggerEngine,
    ensure_builtin_safety_routines,
    has_selector,
    in_time_window,
    matches,
)

UTC = zoneinfo.ZoneInfo("UTC")


def at(hh, mm=0):
    return datetime(2026, 8, 19, hh, mm, tzinfo=UTC)


def state(value, **attrs):
    return {"state": value, "attributes": attrs}


# ---------------------------------------------------------------------------
# time windows
# ---------------------------------------------------------------------------

def test_no_window_always_matches():
    assert in_time_window(at(3), None) is True
    assert in_time_window(at(3), {}) is True


def test_daytime_window():
    w = {"start": "09:00", "end": "17:00"}
    assert in_time_window(at(12), w) is True
    assert in_time_window(at(8, 59), w) is False
    assert in_time_window(at(17, 1), w) is False


def test_window_across_midnight_is_two_intervals():
    """22:00-06:00 is 'late at night'. A naive start <= now <= end comparison
    makes this window match nothing at all."""
    w = {"start": "22:00", "end": "06:00"}
    assert in_time_window(at(23), w) is True
    assert in_time_window(at(2), w) is True
    assert in_time_window(at(5, 59), w) is True
    assert in_time_window(at(12), w) is False
    assert in_time_window(at(21, 59), w) is False


def test_malformed_window_does_not_silently_block():
    assert in_time_window(at(3), {"start": "nope", "end": "06:00"}) is True


# ---------------------------------------------------------------------------
# selector matching
# ---------------------------------------------------------------------------

def test_entity_selector():
    c = {"entity_id": "lock.front"}
    assert matches(c, "lock.front", state("unlocked"), None) is True
    assert matches(c, "lock.back", state("unlocked"), None) is False


def test_device_class_and_to_state_are_anded():
    c = {"device_class": "moisture", "to_state": "on"}
    assert matches(c, "binary_sensor.a", state("on", device_class="moisture"), None) is True
    assert matches(c, "binary_sensor.a", state("off", device_class="moisture"), None) is False
    assert matches(c, "binary_sensor.a", state("on", device_class="smoke"), None) is False


def test_area_match_is_case_insensitive():
    c = {"area": "Kitchen"}
    assert matches(c, "light.a", state("on"), "kitchen") is True
    assert matches(c, "light.a", state("on"), "Garage") is False
    assert matches(c, "light.a", state("on"), None) is False


def test_domain_selector():
    c = {"domain": "lock", "to_state": "unlocked"}
    assert matches(c, "lock.front", state("unlocked"), None) is True
    assert matches(c, "light.front", state("unlocked"), None) is False


def test_empty_config_is_not_a_wildcard():
    """A config with no selector would match every event in the house."""
    assert has_selector({}) is False
    assert has_selector({"to_state": "on"}) is False
    assert has_selector({"device_class": "moisture"}) is True


# ---------------------------------------------------------------------------
# the engine
# ---------------------------------------------------------------------------

class FakeStore:
    def __init__(self, routines=None, areas=None):
        self._routines = routines or []
        self._areas = areas or {}
        self.created = []

    async def get_enabled_routines(self):
        return list(self._routines)

    async def list_routines(self, user_id):
        return [r for r in self._routines if r["user_id"] == user_id]

    async def create_routine(self, routine):
        self._routines.append(routine)
        self.created.append(routine)
        return routine

    async def execute_read_async(self, sql, params=()):
        return [{"entity_id": k, "area": v} for k, v in self._areas.items()]

    async def get_llm_settings(self, user_id):
        return {"timezone": "UTC"}


class FakeApp:
    def __init__(self, store):
        self.state = type("S", (), {})()
        self.state.memory_manager = type("M", (), {"_store": store})()


def make_engine(routines, areas=None):
    store = FakeStore(routines, areas)
    engine = HomeTriggerEngine(FakeApp(store))
    fired = []
    async def _capture(routine, entity_id, new_state, area):
        fired.append((routine["id"], entity_id, new_state.get("state")))
    engine._fire = _capture
    return engine, fired


def rule(**kw):
    base = {"id": "r1", "user_id": "u1", "name": "Test", "trigger": "device",
            "severity": "warning", "prompt": "", "trigger_config": {}}
    base.update(kw)
    return base


@pytest.mark.asyncio
async def test_fires_on_transition():
    engine, fired = make_engine([rule(
        trigger_config={"device_class": "moisture", "to_state": "on"})])
    await engine.on_event("binary_sensor.leak",
                          state("on", device_class="moisture"),
                          state("off", device_class="moisture"))
    assert fired == [("r1", "binary_sensor.leak", "on")]


@pytest.mark.asyncio
async def test_repeat_updates_in_the_same_state_do_not_refire():
    """HA re-emits state_changed for attribute-only changes. Without a
    transition check a wet sensor would alert on every one of them."""
    engine, fired = make_engine([rule(
        trigger_config={"device_class": "moisture", "to_state": "on"})])
    on = state("on", device_class="moisture")
    await engine.on_event("binary_sensor.leak", on, state("off", device_class="moisture"))
    await engine.on_event("binary_sensor.leak", on, on)
    await engine.on_event("binary_sensor.leak", on, on)
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_non_matching_event_is_ignored():
    engine, fired = make_engine([rule(
        trigger_config={"device_class": "smoke", "to_state": "on"})])
    await engine.on_event("binary_sensor.leak",
                          state("on", device_class="moisture"),
                          state("off", device_class="moisture"))
    assert fired == []


@pytest.mark.asyncio
async def test_for_seconds_waits_for_the_state_to_hold():
    engine, fired = make_engine([rule(
        trigger_config={"device_class": "door", "to_state": "on",
                        "for_seconds": 0.05})])
    await engine.on_event("binary_sensor.door",
                          state("on", device_class="door"),
                          state("off", device_class="door"))
    assert fired == []          # not yet — the countdown is running
    await asyncio.sleep(0.12)
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_closing_the_door_cancels_the_countdown():
    engine, fired = make_engine([rule(
        trigger_config={"device_class": "door", "to_state": "on",
                        "for_seconds": 0.05})])
    await engine.on_event("binary_sensor.door",
                          state("on", device_class="door"),
                          state("off", device_class="door"))
    await engine.on_event("binary_sensor.door",
                          state("off", device_class="door"),
                          state("on", device_class="door"))
    await asyncio.sleep(0.12)
    assert fired == []


@pytest.mark.asyncio
async def test_area_selector_uses_the_synced_area():
    engine, fired = make_engine(
        [rule(trigger_config={"area": "Kitchen", "to_state": "on"})],
        areas={"light.kitchen": "Kitchen", "light.garage": "Garage"})
    await engine.on_event("light.kitchen", state("on"), state("off"))
    await engine.on_event("light.garage", state("on"), state("off"))
    assert [f[1] for f in fired] == ["light.kitchen"]


@pytest.mark.asyncio
async def test_a_selectorless_rule_never_fires():
    engine, fired = make_engine([rule(trigger_config={"to_state": "on"})])
    await engine.on_event("light.any", state("on"), state("off"))
    assert fired == []


@pytest.mark.asyncio
async def test_schedule_routines_are_not_device_triggers():
    engine, fired = make_engine([rule(trigger="schedule", time="08:00")])
    await engine.on_event("light.any", state("on"), state("off"))
    assert fired == []


@pytest.mark.asyncio
async def test_a_failing_rule_does_not_kill_the_bus():
    engine, _ = make_engine([rule(
        trigger_config={"device_class": "moisture", "to_state": "on"})])
    async def _boom(*a, **k):
        raise RuntimeError("delivery exploded")
    engine._fire = _boom
    # on_event swallows it; the bus has other subscribers.
    await engine.on_event("binary_sensor.leak",
                          state("on", device_class="moisture"),
                          state("off", device_class="moisture"))


# ---------------------------------------------------------------------------
# H5 builtin pack
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_builtin_pack_is_created_once():
    store = FakeStore([])
    first = await ensure_builtin_safety_routines(store, "u1")
    assert first == len(BUILTIN_SAFETY_RULES)
    second = await ensure_builtin_safety_routines(store, "u1")
    assert second == 0, "re-running must not duplicate the safety rules"


@pytest.mark.asyncio
async def test_builtins_are_device_triggers_with_real_selectors():
    store = FakeStore([])
    await ensure_builtin_safety_routines(store, "u1")
    for r in store.created:
        assert r["trigger"] == "device"
        assert r["builtin"] is True
        assert has_selector(r["trigger_config"]), r["name"]


@pytest.mark.asyncio
async def test_leak_and_smoke_are_critical():
    store = FakeStore([])
    await ensure_builtin_safety_routines(store, "u1")
    by_name = {r["name"]: r for r in store.created}
    assert by_name["Water leak"]["severity"] == "critical"
    assert by_name["Smoke detected"]["severity"] == "critical"
    assert by_name["Door left open"]["severity"] == "warning"


@pytest.mark.asyncio
async def test_a_disabled_builtin_is_not_recreated():
    """Turning one off has to stick across restarts."""
    store = FakeStore([])
    await ensure_builtin_safety_routines(store, "u1")
    for r in store._routines:
        r["enabled"] = False
    created = await ensure_builtin_safety_routines(store, "u1")
    assert created == 0
    assert all(r["enabled"] is False for r in store._routines)
