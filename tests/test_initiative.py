"""
tests/test_initiative.py

Initiative engine decision gates (quiet hours, cooldowns, kill switch)
and the external event intake route.
"""

import pytest
from fastapi.testclient import TestClient

from config.settings import get_settings
from core.initiative import InitiativeEngine, InitiativeEvent
from main import app

client = TestClient(app)


@pytest.fixture()
def engine():
    return InitiativeEngine()


async def test_event_delivers_and_cooldown_suppresses_repeat(engine, monkeypatch):
    async def mock_quiet_hours(user_id=None): return False
    monkeypatch.setattr(engine, "_in_quiet_hours", mock_quiet_hours)
    sent = []

    async def fake_deliver(ev):
        sent.append(ev)
    monkeypatch.setattr(engine, "_deliver", fake_deliver)

    ev = InitiativeEvent(kind="device_alert", title="Mower", message="Battery low",
                         severity="warning", key="vector:1:battery")
    r1 = await engine.submit(ev)
    r2 = await engine.submit(ev)
    assert r1 == {"delivered": True, "reason": "ok"}
    assert r2 == {"delivered": False, "reason": "cooldown"}
    assert len(sent) == 1


async def test_quiet_hours_suppress_noncritical_but_not_critical(engine, monkeypatch):
    async def mock_quiet_hours(user_id=None): return True
    monkeypatch.setattr(engine, "_in_quiet_hours", mock_quiet_hours)
    sent = []

    async def fake_deliver(ev):
        sent.append(ev)
    monkeypatch.setattr(engine, "_deliver", fake_deliver)

    r1 = await engine.submit(InitiativeEvent(
        kind="custom", title="FYI", message="", severity="info", key="a"))
    r2 = await engine.submit(InitiativeEvent(
        kind="custom", title="Tornado", message="", severity="critical", key="b"))
    assert r1["reason"] == "quiet_hours"
    assert r2["delivered"] is True
    assert len(sent) == 1


async def test_master_switch_disables_everything(engine, monkeypatch):
    import types
    import core.proactive as proactive_mod
    stub = types.SimpleNamespace(initiative_enabled=False,
                                 initiative_quiet_start=22,
                                 initiative_quiet_end=7)
    monkeypatch.setattr(proactive_mod, "get_settings", lambda: stub)
    r = await engine.submit(InitiativeEvent(
        kind="custom", title="X", message="", severity="critical", key="c"))
    assert r == {"delivered": False, "reason": "disabled"}


def test_event_route_requires_auth():
    assert client.post("/api/initiative/event",
                       json={"title": "hi"}).status_code == 401
    assert client.get("/api/initiative/recent").status_code == 401


def test_event_route_accepts_internal_secret():
    secret = get_settings().daemon_internal_secret
    r = client.post(
        "/api/initiative/event",
        json={"title": "n8n test", "message": "hello", "severity": "info",
              "key": "test-route"},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert r.status_code == 200
    assert "delivered" in r.json()

    r = client.get("/api/initiative/recent",
                   headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 200
    assert any(e["key"] == "test-route" for e in r.json()["events"])
