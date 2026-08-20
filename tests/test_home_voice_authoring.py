"""Voice authoring of device alerts — core.tools_home.

The model turns a sentence into fields; these cover what happens to those
fields afterwards, which is the part that has to be right.
"""

from __future__ import annotations

import pytest

from core.tools_home import _norm_hhmm, describe, DEVICE_CLASS_SYNONYMS


# ---------------------------------------------------------------------------
# time parsing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,want", [
    ("22:00", "22:00"), ("10pm", "22:00"), ("10 PM", "22:00"),
    ("6am", "06:00"), ("12am", "00:00"), ("12pm", "12:00"),
    ("9:30pm", "21:30"), ("06:00", "06:00"),
])
def test_times_people_actually_say(raw, want):
    assert _norm_hhmm(raw) == want


@pytest.mark.parametrize("raw", ["", None, "tea time", "25:00", "10:75", "later"])
def test_unparseable_times_are_refused_not_guessed(raw):
    """A misread quiet window silences a real alert, so no guessing."""
    assert _norm_hhmm(raw) is None


# ---------------------------------------------------------------------------
# the confirmation the speaker hears
# ---------------------------------------------------------------------------

def test_describes_a_sensor_class_in_plain_words():
    got = describe({"device_class": "garage_door", "to_state": "on"})
    assert "garage door" in got and "turns on" in got


def test_describes_the_hold_in_minutes_not_seconds():
    got = describe({"device_class": "door", "to_state": "on", "for_seconds": 600})
    assert "10 minutes" in got


def test_singular_minute_reads_correctly():
    got = describe({"device_class": "door", "to_state": "on", "for_seconds": 60})
    assert "1 minute" in got and "1 minutes" not in got


def test_describes_the_time_window():
    got = describe({"domain": "lock", "to_state": "unlocked",
                    "time_window": {"start": "22:00", "end": "06:00"}})
    assert "between 22:00 and 06:00" in got


def test_critical_says_it_will_break_quiet_hours():
    """Someone agreeing to a critical alert should know what they agreed to."""
    got = describe({"device_class": "moisture", "to_state": "on"},
                   severity="critical")
    assert "quiet hours" in got


def test_describes_a_named_entity_and_a_room():
    assert "lock.front" in describe({"entity_id": "lock.front"})
    assert "Kitchen" in describe({"area": "Kitchen"})


# ---------------------------------------------------------------------------
# synonyms
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("said,stored", [
    ("leak", "moisture"), ("water", "moisture"), ("flood", "moisture"),
    ("fire", "smoke"), ("co", "carbon_monoxide"),
    ("carbon monoxide", "carbon_monoxide"), ("garage", "garage_door"),
])
def test_spoken_words_map_to_home_assistant_classes(said, stored):
    """Nobody says 'moisture'."""
    assert DEVICE_CLASS_SYNONYMS[said] == stored


def test_the_pack_classes_all_round_trip():
    """Every class the builtin safety pack watches has to be reachable by
    voice, or a rule can be described but never authored."""
    from core.home_triggers import BUILTIN_SAFETY_RULES
    reachable = set(DEVICE_CLASS_SYNONYMS.values())
    for rule in BUILTIN_SAFETY_RULES:
        dc = rule["trigger_config"].get("device_class")
        if dc:
            assert dc in reachable, f"{dc} cannot be asked for by voice"


# ---------------------------------------------------------------------------
# the authoring path
# ---------------------------------------------------------------------------

class FakeStore:
    def __init__(self, routines=None):
        self._routines = routines or []
        self.created = []
        self.updated = []
        self.deleted = []

    async def list_routines(self, user_id):
        return [r for r in self._routines if r["user_id"] == user_id]

    async def create_routine(self, r):
        self.created.append(r); self._routines.append(r); return r

    async def update_routine(self, rid, user_id, fields):
        self.updated.append((rid, fields))
        for r in self._routines:
            if r["id"] == rid:
                r.update(fields); return r
        return None

    async def delete_routine(self, rid, user_id):
        self.deleted.append(rid)
        self._routines = [r for r in self._routines if r["id"] != rid]
        return True


@pytest.fixture
def wired(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr("core.tools_home._store", lambda: store)
    async def _enabled(uid, feat): return True
    import core.family
    monkeypatch.setattr(core.family, "is_feature_enabled_for", _enabled)
    return store


@pytest.mark.asyncio
async def test_authoring_the_example_from_the_plan(wired):
    from core.tools_home import _exec_create_device_alert
    reply = await _exec_create_device_alert({
        "name": "Garage open late", "device_class": "garage",
        "to_state": "on", "between_start": "10pm", "between_end": "6am",
    }, "u1")
    cfg = wired.created[0]["trigger_config"]
    assert cfg["device_class"] == "garage_door"
    assert cfg["time_window"] == {"start": "22:00", "end": "06:00"}
    assert wired.created[0]["trigger"] == "device"
    assert wired.created[0]["builtin"] is False
    assert "garage door" in reply


@pytest.mark.asyncio
async def test_a_rule_with_nothing_to_watch_is_refused(wired):
    from core.tools_home import _exec_create_device_alert
    reply = await _exec_create_device_alert({"name": "Vague", "to_state": "on"}, "u1")
    assert wired.created == []
    assert "what to watch" in reply


@pytest.mark.asyncio
async def test_half_a_time_window_is_refused_rather_than_halved(wired):
    """Storing only one end would leave a window that means something else."""
    from core.tools_home import _exec_create_device_alert
    reply = await _exec_create_device_alert({
        "device_class": "door", "between_start": "10pm"}, "u1")
    assert wired.created == []
    assert "both ends" in reply


@pytest.mark.asyncio
async def test_minutes_become_seconds(wired):
    from core.tools_home import _exec_create_device_alert
    await _exec_create_device_alert(
        {"device_class": "door", "for_minutes": 10}, "u1")
    assert wired.created[0]["trigger_config"]["for_seconds"] == 600


@pytest.mark.asyncio
async def test_deleting_a_builtin_mutes_it_instead(wired):
    """A deleted safety rule is indistinguishable from one that never
    existed. Muting is reversible and visible on the Home page."""
    from core.tools_home import _exec_set_device_alert
    wired._routines.append({"id": "b1", "user_id": "u1", "name": "Water leak",
                            "trigger": "device", "builtin": True,
                            "enabled": True, "trigger_config": {}})
    reply = await _exec_set_device_alert({"name": "water leak", "action": "delete"}, "u1")
    assert wired.deleted == []
    assert wired.updated == [("b1", {"enabled": False})]
    assert "muted" in reply


@pytest.mark.asyncio
async def test_an_authored_rule_can_be_deleted(wired):
    from core.tools_home import _exec_set_device_alert
    wired._routines.append({"id": "a1", "user_id": "u1", "name": "Garage open late",
                            "trigger": "device", "builtin": False,
                            "enabled": True, "trigger_config": {}})
    await _exec_set_device_alert({"name": "garage", "action": "delete"}, "u1")
    assert wired.deleted == ["a1"]


@pytest.mark.asyncio
async def test_an_ambiguous_name_asks_rather_than_picking(wired):
    from core.tools_home import _exec_set_device_alert
    for i in (1, 2):
        wired._routines.append({"id": f"x{i}", "user_id": "u1",
                                "name": f"Door alert {i}", "trigger": "device",
                                "builtin": False, "enabled": True,
                                "trigger_config": {}})
    reply = await _exec_set_device_alert({"name": "door", "action": "mute"}, "u1")
    assert wired.updated == []
    assert "more than one" in reply


@pytest.mark.asyncio
async def test_listing_answers_what_happens_when_the_garage_opens(wired):
    from core.tools_home import _exec_list_device_alerts
    wired._routines.append({
        "id": "a1", "user_id": "u1", "name": "Garage open late",
        "trigger": "device", "builtin": False, "enabled": True,
        "severity": "warning",
        "trigger_config": {"device_class": "garage_door", "to_state": "on"}})
    reply = await _exec_list_device_alerts({"about": "garage"}, "u1")
    assert "Garage open late" in reply
    assert "nothing" not in reply.lower()
