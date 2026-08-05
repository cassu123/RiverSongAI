"""Unit tests for core.observability.

Uses asyncio.run() rather than pytest-asyncio so tests run on the default
pytest installation without extra plugins.
"""

from __future__ import annotations

import asyncio

import pytest

import core.observability as obs
from providers.llm.agent_roles import AgentRole, get_role_registry


# ---------------------------------------------------------------------------
# Helpers — fake Langfuse client so tests never touch the network
# ---------------------------------------------------------------------------

class _FakeGeneration:
    def __init__(self):
        self.ended = False
        self.output = None
        self.level = None
        self.status_message = None

    def end(self, *, output=None, level="DEFAULT", status_message="ok"):
        self.ended = True
        self.output = output
        self.level = level
        self.status_message = status_message


class _FakeLangfuse:
    def __init__(self):
        self.opened = []

    def generation(self, *, name, model, input, metadata):
        g = _FakeGeneration()
        self.opened.append({
            "name": name, "model": model, "input": input,
            "metadata": metadata, "generation": g,
        })
        return g


@pytest.fixture(autouse=True)
def reset_module_state():
    """Each test gets a fresh client state."""
    obs._client = None
    obs._client_initialized = False
    yield
    obs._client = None
    obs._client_initialized = False


async def _drain(agen):
    return [c async for c in agen]


# ---------------------------------------------------------------------------
# Disabled path — no client, decorator is transparent
# ---------------------------------------------------------------------------

def test_decorator_is_passthrough_when_disabled():
    class FakeLLM:
        _model = "claude-test"

        @obs.trace_llm("anthropic", role=AgentRole.SIMPLE)
        async def stream_response(self, messages):
            for c in ["hel", "lo"]:
                yield c

    out = asyncio.run(_drain(FakeLLM().stream_response([{"role": "user", "content": "hi"}])))
    assert out == ["hel", "lo"]
    inv = get_role_registry().last_invocation(AgentRole.SIMPLE)
    assert inv is not None
    assert inv.success is True


# ---------------------------------------------------------------------------
# Enabled path — client is poked, generation ends with concatenated output
# ---------------------------------------------------------------------------

def test_decorator_records_to_fake_client(monkeypatch):
    fake = _FakeLangfuse()
    monkeypatch.setattr(obs, "_client", fake)
    monkeypatch.setattr(obs, "_client_initialized", True)

    class FakeLLM:
        _model = "gpt-test"

        @obs.trace_llm("openai", role=AgentRole.REPORTER)
        async def stream_response(self, messages):
            for c in ["a", "b", "c"]:
                yield c

    out = "".join(asyncio.run(_drain(FakeLLM().stream_response([{"role": "user", "content": "x"}]))))
    assert out == "abc"

    assert len(fake.opened) == 1
    rec = fake.opened[0]
    assert rec["name"] == "openai.stream_response"
    assert rec["model"] == "gpt-test"
    assert rec["metadata"]["provider"] == "openai"
    assert rec["metadata"]["agent_role"] == "reporter"
    gen = rec["generation"]
    assert gen.ended is True
    assert gen.output == "abc"
    assert gen.level == "DEFAULT"


def test_decorator_records_error_on_exception(monkeypatch):
    fake = _FakeLangfuse()
    monkeypatch.setattr(obs, "_client", fake)
    monkeypatch.setattr(obs, "_client_initialized", True)

    class FakeLLM:
        _model = "claude-test"

        @obs.trace_llm("anthropic", role=AgentRole.PRIMARY)
        async def stream_response(self, messages):
            yield "partial-"
            raise RuntimeError("boom")

    async def run():
        chunks = []
        with pytest.raises(RuntimeError):
            async for c in FakeLLM().stream_response([]):
                chunks.append(c)
        return chunks

    chunks = asyncio.run(run())
    assert chunks == ["partial-"]

    gen = fake.opened[0]["generation"]
    assert gen.ended is True
    assert gen.level == "ERROR"
    assert "boom" in (gen.status_message or "")

    inv = get_role_registry().last_invocation(AgentRole.PRIMARY)
    assert inv.success is False
    assert "boom" in (inv.error or "")


def test_decorator_rejects_non_async_generator():
    with pytest.raises(TypeError):

        class _Bad:
            _model = "m"

            @obs.trace_llm("test")
            async def stream_response(self, messages):  # plain coroutine, not async gen
                return "nope"

        _ = _Bad()


# ---------------------------------------------------------------------------
# get_langfuse() — disabled paths return None without exploding
# ---------------------------------------------------------------------------

def test_get_langfuse_returns_none_when_disabled(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "langfuse_enabled", False, raising=False)
    assert obs.get_langfuse() is None


def test_get_langfuse_returns_none_when_keys_missing(monkeypatch):
    from config.settings import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "langfuse_enabled", True, raising=False)
    monkeypatch.setattr(s, "langfuse_public_key", "", raising=False)
    monkeypatch.setattr(s, "langfuse_secret_key", "", raising=False)
    assert obs.get_langfuse() is None
