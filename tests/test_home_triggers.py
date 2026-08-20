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


# ---------------------------------------------------------------------------
# explain() — the dry run behind POST /api/home/triggers/test
# ---------------------------------------------------------------------------

from core.home_triggers import explain


def test_explain_matches_a_leak():
    v = explain({"device_class": "moisture", "to_state": "on"},
                "binary_sensor.leak", state("on", device_class="moisture"),
                None, at(3))
    assert v["would_fire"] is True
    assert v["delay_seconds"] == 0.0


def test_explain_names_the_selector_that_failed():
    v = explain({"device_class": "smoke", "to_state": "on"},
                "binary_sensor.leak", state("on", device_class="moisture"),
                None, at(3))
    assert v["would_fire"] is False
    assert "device_class" in v["reason"]


def test_explain_reports_the_hold_rather_than_pretending_it_fired():
    v = explain({"device_class": "door", "to_state": "on", "for_seconds": 600},
                "binary_sensor.door", state("on", device_class="door"),
                None, at(12))
    assert v["would_fire"] is True
    assert v["delay_seconds"] == 600.0
    assert "600" in v["reason"]


def test_explain_explains_a_closed_time_window():
    cfg = {"domain": "lock", "to_state": "unlocked",
           "time_window": {"start": "22:00", "end": "06:00"}}
    midday = explain(cfg, "lock.front", state("unlocked"), None, at(12))
    assert midday["would_fire"] is False
    assert "window" in midday["reason"]
    night = explain(cfg, "lock.front", state("unlocked"), None, at(23))
    assert night["would_fire"] is True


def test_explain_refuses_a_selectorless_rule():
    v = explain({"to_state": "on"}, "light.any", state("on"), None, at(12))
    assert v["would_fire"] is False
    assert "selector" in v["reason"]


def test_explain_checks_area():
    cfg = {"area": "Kitchen", "to_state": "on"}
    assert explain(cfg, "light.k", state("on"), "Kitchen", at(12))["would_fire"] is True
    v = explain(cfg, "light.g", state("on"), "Garage", at(12))
    assert v["would_fire"] is False and "area" in v["reason"]


def test_every_builtin_can_be_tripped_by_a_synthetic_event():
    """The safety pack has to be reachable from the test endpoint, or the
    only way to verify it is to stage a real emergency."""
    samples = {
        "builtin_leak": ("binary_sensor.x", "on", "moisture", 12),
        "builtin_smoke": ("binary_sensor.x", "on", "smoke", 12),
        "builtin_gas": ("binary_sensor.x", "on", "gas", 12),
        "builtin_co": ("binary_sensor.x", "on", "carbon_monoxide", 12),
        "builtin_door_open": ("binary_sensor.x", "on", "door", 12),
        "builtin_garage_open": ("binary_sensor.x", "on", "garage_door", 12),
        "builtin_unlocked_late": ("lock.x", "unlocked", None, 23),
    }
    for rule in BUILTIN_SAFETY_RULES:
        eid, val, dc, hour = samples[rule["key"]]
        st = state(val, **({"device_class": dc} if dc else {}))
        v = explain(rule["trigger_config"], eid, st, None, at(hour))
        assert v["would_fire"] is True, f"{rule['name']}: {v['reason']}"
