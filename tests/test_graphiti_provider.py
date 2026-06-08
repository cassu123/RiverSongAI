"""Unit tests for providers.memory.graphiti_provider.

Tests run without a live Neo4j or the graphiti-core package — we substitute
fakes and exercise the wrapper's enable/disable, healthcheck, and best-effort
write semantics.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from providers.memory import graphiti_provider as gp


@pytest.fixture(autouse=True)
def reset_singleton():
    gp._provider = None
    yield
    gp._provider = None


# ---------------------------------------------------------------------------
# Disabled-by-default semantics
# ---------------------------------------------------------------------------

def test_provider_disabled_by_default(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "graphiti_enabled", False, raising=False)
    prov = gp.get_graphiti_provider()
    assert prov.enabled is False
    assert prov.healthcheck() is False
    stats = prov.stats()
    assert stats["enabled"] is False
    assert stats["node_count"] == 0


def test_add_episode_is_noop_when_disabled(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "graphiti_enabled", False, raising=False)
    prov = gp.get_graphiti_provider()

    asyncio.run(prov.add_episode(gp.Episode(
        group_id="test", name="t", episode_body="hi", source="unittest",
    )))
    # Local cache should also stay empty when disabled (we exit before touching it)
    stats = prov.stats()
    assert stats["recent_episodes"] == []


# ---------------------------------------------------------------------------
# Enabled-with-fake-client semantics
# ---------------------------------------------------------------------------

class _FakeGraphiti:
    def __init__(self):
        self.calls = []

    async def add_episode(self, *, name, episode_body, source, reference_time, group_id):
        self.calls.append({
            "name": name, "episode_body": episode_body, "source": source,
            "reference_time": reference_time, "group_id": group_id,
        })


def _enable(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "graphiti_enabled", True, raising=False)
    monkeypatch.setattr(s, "graphiti_mode", "library", raising=False)
    monkeypatch.setattr(s, "neo4j_password", "test-password", raising=False)
    monkeypatch.setattr(s, "graphiti_write_timeout_seconds", 2.0, raising=False)


def test_enabled_when_settings_say_so(monkeypatch):
    _enable(monkeypatch)
    prov = gp.GraphitiProvider()
    assert prov.enabled is True


def test_add_episode_writes_to_fake_client(monkeypatch):
    _enable(monkeypatch)
    fake = _FakeGraphiti()
    prov = gp.GraphitiProvider()
    # Bypass the lazy build with our fake.
    prov._client = fake
    prov._initialized = True

    ep = gp.Episode(
        group_id="user:42",
        name="conversation_turn",
        episode_body="User: hi\n\nRiver: hello",
        source="test",
    )
    asyncio.run(prov.add_episode(ep))

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["group_id"] == "user:42"
    assert call["source"] == "test"
    assert "hello" in call["episode_body"]

    # The shadow cache also reflects the episode for the admin panel.
    stats = prov.stats()
    assert len(stats["recent_episodes"]) == 1
    assert stats["recent_episodes"][0]["source"] == "test"


def test_add_episode_timeout_does_not_raise(monkeypatch):
    _enable(monkeypatch)

    class _SlowFake:
        async def add_episode(self, **kwargs):
            await asyncio.sleep(5.0)

    prov = gp.GraphitiProvider()
    prov._client = _SlowFake()
    prov._initialized = True

    from config.settings import get_settings
    monkeypatch.setattr(get_settings(), "graphiti_write_timeout_seconds", 0.05, raising=False)

    # Must not raise — Graphiti failures are warnings, never exceptions.
    asyncio.run(prov.add_episode(gp.Episode(
        group_id="g", name="t", episode_body="body", source="s",
    )))


def test_add_episode_raising_client_does_not_propagate(monkeypatch):
    _enable(monkeypatch)

    class _BadFake:
        async def add_episode(self, **kwargs):
            raise RuntimeError("graph offline")

    prov = gp.GraphitiProvider()
    prov._client = _BadFake()
    prov._initialized = True

    # Must not raise; logs at WARNING level.
    asyncio.run(prov.add_episode(gp.Episode(
        group_id="g", name="t", episode_body="body", source="s",
    )))


def test_recent_episodes_capped_at_100(monkeypatch):
    _enable(monkeypatch)
    fake = _FakeGraphiti()
    prov = gp.GraphitiProvider()
    prov._client = fake
    prov._initialized = True

    async def push_many():
        for i in range(150):
            await prov.add_episode(gp.Episode(
                group_id="g", name=f"e{i}", episode_body="b", source="s",
            ))

    asyncio.run(push_many())
    assert len(prov._recent_episodes) == 100


def test_singleton_get_graphiti_provider():
    a = gp.get_graphiti_provider()
    b = gp.get_graphiti_provider()
    assert a is b


# ---------------------------------------------------------------------------
# Recall is empty when disabled — never explodes
# ---------------------------------------------------------------------------

def test_recall_returns_empty_when_disabled(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "graphiti_enabled", False, raising=False)
    prov = gp.GraphitiProvider()
    assert asyncio.run(prov.recall_recent("g")) == []
    assert asyncio.run(prov.recall_related("g", "q")) == []
