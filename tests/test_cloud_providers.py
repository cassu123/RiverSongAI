"""
tests/test_cloud_providers.py

The two metered cloud providers added alongside the free/local ones:
DeepSeek (platform.deepseek.com) and Qwen (Alibaba DashScope).

The assertions that carry weight here are about money and access, not about
whether the HTTP client works:

  - a free model must never be priced as a paid one
  - a paid model must never be priced at zero
  - a provider with no API key must not be selectable, however many toggles
    are switched on
  - a non-admin must not see a gated provider the admin has not opened up

The last two are what stop a household member spending the admin's money.
"""

import pytest

from api.routes.models_settings import (
    _USER_GATED_PROVIDERS,
    _get_enabled_providers,
    get_provider_user_access,
)
from core.token_tracker import _estimate_cost
from providers.llm.registry import LLMRegistry

PAID_DEEPSEEK = ("deepseek-chat", "deepseek-reasoner")
PAID_QWEN = ("qwen-turbo", "qwen-plus", "qwen-max")


# =============================================================================
# Catalog
# =============================================================================


@pytest.mark.parametrize("model_id", PAID_DEEPSEEK)
def test_deepseek_cloud_models_are_registered(model_id):
    entry = LLMRegistry.get("deepseek", model_id)
    assert entry is not None
    assert entry.is_cloud


@pytest.mark.parametrize("model_id", PAID_QWEN)
def test_qwen_cloud_models_are_registered(model_id):
    entry = LLMRegistry.get("qwen", model_id)
    assert entry is not None
    assert entry.is_cloud


@pytest.mark.parametrize(
    "provider,model_id",
    [("deepseek", m) for m in PAID_DEEPSEEK] + [("qwen", m) for m in PAID_QWEN],
)
def test_metered_models_are_not_reported_as_free(provider, model_id):
    """is_free drives the per-user `free_models_only` restriction. A paid
    model wrongly marked free would be handed to exactly the accounts an
    admin had restricted to zero-cost models."""
    assert LLMRegistry.is_free(provider, model_id) is False
    entry = LLMRegistry.get(provider, model_id)
    assert entry.cost_per_1k_input_usd and entry.cost_per_1k_input_usd > 0
    assert entry.cost_per_1k_output_usd and entry.cost_per_1k_output_usd > 0


def test_local_qwen_and_deepseek_stay_free():
    """Adding paid entries that share a family name must not reprice the
    local ones. Cost lookup falls back to prefix matching, which is exactly
    the mechanism that could bleed a paid rate onto a free model."""
    for entry in LLMRegistry.list_local():
        assert LLMRegistry.is_free(entry.provider, entry.model_id) is True
        assert _estimate_cost(entry.model_id, 1_000_000, 1_000_000) == 0.0


def test_free_nim_deepseek_is_still_free():
    """The NIM route shares the DeepSeek name but not the bill."""
    assert LLMRegistry.is_free("nvidia_nim", "deepseek-ai/deepseek-r1") is True
    assert _estimate_cost("deepseek-ai/deepseek-r1", 1_000_000, 1_000_000) == 0.0


# =============================================================================
# Costing
# =============================================================================


@pytest.mark.parametrize("model_id", PAID_DEEPSEEK + PAID_QWEN)
def test_metered_models_have_a_nonzero_estimated_cost(model_id):
    """A metered model that costs $0.00 in the tracker means an admin
    dashboard that reads zero while the provider's bill climbs."""
    assert _estimate_cost(model_id, 1_000_000, 1_000_000) > 0.0


def test_cost_matches_the_published_rate():
    """1M in + 1M out should equal the per-1M input rate plus output rate."""
    # deepseek-chat: $0.27/M in, $1.10/M out
    assert _estimate_cost("deepseek-chat", 1_000_000, 1_000_000) == pytest.approx(1.37)
    # qwen-max: $1.60/M in, $6.40/M out
    assert _estimate_cost("qwen-max", 1_000_000, 1_000_000) == pytest.approx(8.00)


def test_registry_and_cost_table_agree():
    """Two tables hold prices — the registry (shown in the picker) and
    _COST_PER_M (used to bill recorded usage). If they disagree, the price a
    user is shown is not the price they are charged."""
    from core.token_tracker import _COST_PER_M

    for provider in ("deepseek", "qwen"):
        for entry in LLMRegistry.list_by_provider(provider):
            rates = _COST_PER_M.get(entry.model_id)
            assert rates is not None, f"{entry.model_id} missing from _COST_PER_M"
            assert rates["in"] == pytest.approx(
                entry.cost_per_1k_input_usd * 1000
            ), entry.model_id
            assert rates["out"] == pytest.approx(
                entry.cost_per_1k_output_usd * 1000
            ), entry.model_id


# =============================================================================
# Availability gating
# =============================================================================


def test_providers_are_unavailable_without_an_api_key(monkeypatch):
    """Every toggle on, no key: still unavailable. The key is the last word."""
    from config import settings as settings_module

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_enabled", True, raising=False)
    monkeypatch.setattr(s, "qwen_enabled", True, raising=False)
    monkeypatch.setattr(s, "deepseek_api_key", "", raising=False)
    monkeypatch.setattr(s, "qwen_api_key", "", raising=False)

    enabled = _get_enabled_providers(
        {"deepseek_enabled_global": True, "qwen_enabled_global": True}
    )
    assert enabled["deepseek"] is False
    assert enabled["qwen"] is False


def test_providers_become_available_with_key_and_toggles(monkeypatch):
    from config import settings as settings_module

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_enabled", True, raising=False)
    monkeypatch.setattr(s, "qwen_enabled", True, raising=False)
    monkeypatch.setattr(s, "deepseek_api_key", "sk-test", raising=False)
    monkeypatch.setattr(s, "qwen_api_key", "sk-test", raising=False)

    enabled = _get_enabled_providers({})
    assert enabled["deepseek"] is True
    assert enabled["qwen"] is True


def test_cloud_kill_switch_covers_the_new_providers(monkeypatch):
    """'Disable cloud LLMs' has to mean all of them, or the switch lies."""
    from config import settings as settings_module

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_enabled", True, raising=False)
    monkeypatch.setattr(s, "qwen_enabled", True, raising=False)
    monkeypatch.setattr(s, "deepseek_api_key", "sk-test", raising=False)
    monkeypatch.setattr(s, "qwen_api_key", "sk-test", raising=False)

    enabled = _get_enabled_providers({"cloud_llms_enabled_global": False})
    assert enabled["deepseek"] is False
    assert enabled["qwen"] is False


def test_instantiating_a_disabled_provider_raises(monkeypatch):
    from config import settings as settings_module
    from core.conversation_loop import _instantiate_llm

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_enabled", False, raising=False)
    with pytest.raises(ValueError, match="DeepSeek is disabled"):
        _instantiate_llm("deepseek", None)

    monkeypatch.setattr(s, "qwen_enabled", False, raising=False)
    with pytest.raises(ValueError, match="Qwen is disabled"):
        _instantiate_llm("qwen", None)


def test_enabled_without_a_key_raises_a_distinct_error(monkeypatch):
    """'Enabled but no key' and 'disabled' are different mistakes and should
    not produce the same message — one is a missing toggle, the other a
    missing secret."""
    from config import settings as settings_module
    from core.conversation_loop import _instantiate_llm

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_enabled", True, raising=False)
    monkeypatch.setattr(s, "deepseek_api_key", "", raising=False)
    with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
        _instantiate_llm("deepseek", None)


# =============================================================================
# Per-user access
# =============================================================================


def test_user_access_defaults_to_allowed():
    access = get_provider_user_access({})
    for provider in _USER_GATED_PROVIDERS:
        assert access[provider] is True


def test_legacy_nim_key_is_still_honoured():
    """An existing deployment that turned NIM access off must not have that
    silently reset by the move to the generalised map."""
    assert get_provider_user_access({"nvidia_nim_user_access": False})[
        "nvidia_nim"
    ] is False


def test_new_map_overrides_the_legacy_key():
    access = get_provider_user_access(
        {
            "nvidia_nim_user_access": False,
            "provider_user_access": {"nvidia_nim": True},
        }
    )
    assert access["nvidia_nim"] is True


def test_each_provider_is_gated_independently():
    access = get_provider_user_access(
        {"provider_user_access": {"deepseek": False, "qwen": True}}
    )
    assert access["deepseek"] is False
    assert access["qwen"] is True
    assert access["nvidia_nim"] is True


# =============================================================================
# The providers themselves — streaming, and the usage rows they write
# =============================================================================
#
# These import the provider modules, which the tests above never do (they all
# raise on a gate before the import runs). Without them a typo in deepseek.py
# or qwen.py would ship green.

pytest.importorskip("openai", reason="openai client not installed")


class _FakeDelta:
    def __init__(self, content=None, reasoning_content=None):
        self.content = content
        if reasoning_content is not None:
            self.reasoning_content = reasoning_content


class _FakeChoice:
    def __init__(self, delta):
        self.delta = delta


class _FakeUsage:
    def __init__(self, prompt_tokens, completion_tokens):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


class _FakeChunk:
    def __init__(self, content=None, usage=None, reasoning_content=None):
        self.choices = (
            [_FakeChoice(_FakeDelta(content, reasoning_content))]
            if content is not None or reasoning_content is not None
            else []
        )
        self.usage = usage


class _FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        async def gen():
            for c in self._chunks:
                yield c

        return gen()


def _provider(kind, monkeypatch, model=None):
    from config import settings as settings_module

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "deepseek_api_key", "sk-test", raising=False)
    monkeypatch.setattr(s, "qwen_api_key", "sk-test", raising=False)

    if kind == "deepseek":
        from providers.llm.deepseek import DeepSeekLLM

        return DeepSeekLLM(model=model)
    from providers.llm.qwen import QwenLLM

    return QwenLLM(model=model)


def _install_stream(provider, chunks):
    """Replace the network call with a canned stream."""

    async def fake_create(**kwargs):
        fake_create.kwargs = kwargs
        return _FakeStream(chunks)

    provider._client.chat.completions.create = fake_create
    return fake_create


@pytest.mark.parametrize("kind", ["deepseek", "qwen"])
@pytest.mark.asyncio
async def test_streaming_yields_text_and_records_usage(kind, monkeypatch):
    import core.token_tracker as tracker

    recorded = []
    monkeypatch.setattr(
        tracker, "record_usage", lambda *a, **k: recorded.append((a, k))
    )
    monkeypatch.setattr(
        "providers.llm.openai_compatible.record_usage",
        lambda *a, **k: recorded.append((a, k)),
    )

    provider = _provider(kind, monkeypatch)
    _install_stream(
        provider,
        [
            _FakeChunk("Hello"),
            _FakeChunk(" world"),
            _FakeChunk(usage=_FakeUsage(120, 45)),
        ],
    )

    out = "".join([c async for c in provider.stream_response([{"role": "user", "content": "hi"}])])
    assert out == "Hello world"

    assert len(recorded) == 1, "a streamed reply must write exactly one usage row"
    args, _kwargs = recorded[0]
    assert args[0] == kind          # provider key, used to join spend to models
    assert args[2] == 120           # input tokens
    assert args[3] == 45            # output tokens


@pytest.mark.parametrize("kind", ["deepseek", "qwen"])
@pytest.mark.asyncio
async def test_streaming_requests_usage_in_the_stream(kind, monkeypatch):
    """Without stream_options include_usage the final chunk carries no token
    counts, and every streamed reply would be recorded as zero spend."""
    provider = _provider(kind, monkeypatch)
    create = _install_stream(provider, [_FakeChunk("hi")])

    [c async for c in provider.stream_response([{"role": "user", "content": "x"}])]
    assert create.kwargs["stream_options"] == {"include_usage": True}
    assert create.kwargs["stream"] is True


@pytest.mark.asyncio
async def test_deepseek_reasoner_streams_its_thinking(monkeypatch):
    provider = _provider("deepseek", monkeypatch, model="deepseek-reasoner")
    _install_stream(
        provider,
        [
            _FakeChunk(reasoning_content="thinking..."),
            _FakeChunk("answer"),
            _FakeChunk(usage=_FakeUsage(10, 20)),
        ],
    )
    out = "".join(
        [c async for c in provider.stream_response_thinking([{"role": "user", "content": "x"}])]
    )
    assert out == "thinking...answer"


@pytest.mark.asyncio
async def test_non_reasoner_thinking_falls_through(monkeypatch):
    """deepseek-chat has no reasoning_content, so the thinking path must not
    open a second request that returns nothing extra."""
    provider = _provider("deepseek", monkeypatch, model="deepseek-chat")
    _install_stream(provider, [_FakeChunk("plain")])
    out = "".join(
        [c async for c in provider.stream_response_thinking([{"role": "user", "content": "x"}])]
    )
    assert out == "plain"


@pytest.mark.parametrize("kind", ["deepseek", "qwen"])
@pytest.mark.asyncio
async def test_a_failure_speaks_instead_of_raising(kind, monkeypatch):
    """These strings get spoken aloud, so a provider outage must not surface
    as an exception into the conversation loop."""
    provider = _provider(kind, monkeypatch)

    async def boom(**kwargs):
        raise RuntimeError("Error code: 401 - authentication failed")

    provider._client.chat.completions.create = boom
    out = "".join([c async for c in provider.stream_response([{"role": "user", "content": "x"}])])
    assert "admin" in out.lower()


@pytest.mark.parametrize("kind", ["deepseek", "qwen"])
@pytest.mark.asyncio
async def test_empty_messages_make_no_request(kind, monkeypatch):
    provider = _provider(kind, monkeypatch)

    async def boom(**kwargs):
        raise AssertionError("should not have called the API")

    provider._client.chat.completions.create = boom
    assert [c async for c in provider.stream_response([])] == []


# =============================================================================
# End to end: what the model picker is actually served
# =============================================================================

from fastapi.testclient import TestClient  # noqa: E402

from core.auth import create_access_token  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture
def keys_configured(monkeypatch, app_store):
    """Both providers enabled with keys present."""
    from config import settings as settings_module

    s = settings_module.get_settings()
    for attr, value in (
        ("deepseek_enabled", True),
        ("qwen_enabled", True),
        ("deepseek_api_key", "sk-test"),
        ("qwen_api_key", "sk-test"),
    ):
        monkeypatch.setattr(s, attr, value, raising=False)
    return app_store


def _set_config(store, config):
    import asyncio

    asyncio.run(store.set_admin_config(config))


def _models_as(role, user_id):
    token = create_access_token(user_id, f"{user_id}@example.com", role)
    r = client.get("/api/models", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


def _cloud_ids(payload, provider):
    return {m["model_id"] for m in payload["cloud"] if m["provider"] == provider}


def test_admin_sees_the_metered_models_as_available(keys_configured):
    _set_config(keys_configured, {})
    payload = _models_as("admin", "metered-admin")

    assert _cloud_ids(payload, "deepseek") == set(PAID_DEEPSEEK)
    assert _cloud_ids(payload, "qwen") == set(PAID_QWEN)
    assert payload["enabled_providers"]["deepseek"] is True
    assert payload["enabled_providers"]["qwen"] is True


def test_users_can_check_them_when_access_is_granted(keys_configured):
    """The point of the feature: a household member can pick these."""
    _set_config(
        keys_configured, {"provider_user_access": {"deepseek": True, "qwen": True}}
    )
    payload = _models_as("user", "metered-user")
    assert _cloud_ids(payload, "deepseek") == set(PAID_DEEPSEEK)
    assert _cloud_ids(payload, "qwen") == set(PAID_QWEN)


def test_users_cannot_see_a_provider_the_admin_closed(keys_configured):
    _set_config(
        keys_configured, {"provider_user_access": {"deepseek": False, "qwen": True}}
    )
    payload = _models_as("user", "metered-user")
    assert _cloud_ids(payload, "deepseek") == set()
    assert _cloud_ids(payload, "qwen") == set(PAID_QWEN)


def test_an_admin_still_sees_a_closed_provider(keys_configured):
    """Closing user access must not lock the admin out of their own testing."""
    _set_config(
        keys_configured, {"provider_user_access": {"deepseek": False, "qwen": False}}
    )
    payload = _models_as("admin", "metered-admin")
    assert _cloud_ids(payload, "deepseek") == set(PAID_DEEPSEEK)
    assert _cloud_ids(payload, "qwen") == set(PAID_QWEN)


def test_the_response_reports_the_access_map(keys_configured):
    _set_config(keys_configured, {"provider_user_access": {"qwen": False}})
    payload = _models_as("admin", "metered-admin")
    assert payload["provider_user_access"]["qwen"] is False
    assert payload["provider_user_access"]["deepseek"] is True


def test_admin_can_flip_access_over_the_api(keys_configured):
    _set_config(keys_configured, {})
    token = create_access_token("metered-admin", "a@example.com", "admin")
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post(
        "/api/settings/provider-user-access",
        json={"provider": "qwen", "enabled": False},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    r = client.get("/api/settings/provider-user-access", headers=headers)
    assert r.json()["access"]["qwen"] is False

    assert _cloud_ids(_models_as("user", "metered-user"), "qwen") == set()


def test_a_non_admin_cannot_change_access(keys_configured):
    token = create_access_token("metered-user", "u@example.com", "user")
    r = client.post(
        "/api/settings/provider-user-access",
        json={"provider": "qwen", "enabled": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_an_unknown_provider_is_rejected(keys_configured):
    token = create_access_token("metered-admin", "a@example.com", "admin")
    r = client.post(
        "/api/settings/provider-user-access",
        json={"provider": "not-a-provider", "enabled": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_a_closed_provider_cannot_be_saved_by_a_user(keys_configured):
    """Hiding a provider from the list is cosmetic on its own — anyone who
    knows a model id could POST it directly. The save endpoint has to enforce
    the same gate, or the admin's switch does not actually stop spending."""
    _set_config(keys_configured, {"provider_user_access": {"deepseek": False}})
    token = create_access_token("metered-user", "u@example.com", "user")

    r = client.post(
        "/api/settings/llm",
        json={"provider": "deepseek", "model_id": "deepseek-chat"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403, r.text
    assert "administrator" in r.json()["detail"].lower()


def test_an_open_provider_can_be_saved_by_a_user(keys_configured):
    _set_config(keys_configured, {"provider_user_access": {"qwen": True}})
    token = create_access_token("metered-user", "u@example.com", "user")

    r = client.post(
        "/api/settings/llm",
        json={"provider": "qwen", "model_id": "qwen-plus"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "qwen-plus"


def test_an_admin_can_still_save_a_closed_provider(keys_configured):
    _set_config(keys_configured, {"provider_user_access": {"deepseek": False}})
    token = create_access_token("metered-admin", "a@example.com", "admin")

    r = client.post(
        "/api/settings/llm",
        json={"provider": "deepseek", "model_id": "deepseek-chat"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
