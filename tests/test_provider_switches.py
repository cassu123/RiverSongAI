"""
tests/test_provider_switches.py

The uniform per-provider gate, and the exclusions that used to bypass it.

Every one of these tests exists because something was previously exempt:

  - the local provider was never checked by the auto-router's last resort,
    so "River Decides" kept using Ollama after an admin switched it off
  - the auto-route safety net rebuilt Ollama for the same reason
  - the save endpoint checked the switch only `if entry.is_cloud`
  - the voice toggle was applied when listing voices but not when setting one

Free was not a reason to be exempt from any of them, which is the point.
"""

import pytest
from fastapi.testclient import TestClient

from api.routes.models_settings import (
    PROVIDER_ORDER,
    _USER_GATED_PROVIDERS,
    _get_enabled_providers,
    get_provider_global_enabled,
)
from core.auth import create_access_token
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _state(app_store):
    return app_store


def _set_config(store, config):
    import asyncio

    asyncio.run(store.set_admin_config(config))


def _admin():
    return {"Authorization": f"Bearer {create_access_token('sw-admin', 'a@example.com', 'admin')}"}


def _user():
    return {"Authorization": f"Bearer {create_access_token('sw-user', 'u@example.com', 'user')}"}


# =============================================================================
# Every provider is gateable — including the free ones
# =============================================================================


def test_all_providers_are_gateable():
    """A toggle that silently does nothing for half the list is worse than
    no toggle. Local and the free cloud tier are in the same set as the paid
    ones."""
    for provider in ("ollama", "nvidia_nim", "qwen", "deepseek",
                     "anthropic", "openai", "gemini"):
        assert provider in _USER_GATED_PROVIDERS


def test_provider_order_is_the_requested_one():
    assert list(PROVIDER_ORDER)[:7] == [
        "ollama", "nvidia_nim", "qwen", "deepseek",
        "anthropic", "openai", "gemini",
    ]


def test_local_can_be_switched_off():
    """Being free bought Ollama a permanent pass before this."""
    switches = get_provider_global_enabled({"provider_enabled": {"ollama": False}})
    assert switches["ollama"] is False
    assert _get_enabled_providers({"provider_enabled": {"ollama": False}})["ollama"] is False


def test_local_defaults_to_on():
    assert get_provider_global_enabled({})["ollama"] is True


def test_legacy_local_key_is_honoured():
    assert get_provider_global_enabled(
        {"local_llms_enabled_global": False})["ollama"] is False


def test_switch_and_credentials_are_reported_separately(monkeypatch):
    """'Off because no key' and 'off because the admin said no' are different
    problems, and telling an admin to find an API key they already removed
    the need for sends them after the wrong one."""
    from config import settings as settings_module

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "qwen_api_key", "sk-test", raising=False)
    monkeypatch.setattr(s, "qwen_enabled", True, raising=False)

    config = {"provider_enabled": {"qwen": False}}
    assert get_provider_global_enabled(config)["qwen"] is False   # admin said no
    assert _get_enabled_providers(config)["qwen"] is False

    monkeypatch.setattr(s, "qwen_api_key", "", raising=False)
    config = {"provider_enabled": {"qwen": True}}
    assert get_provider_global_enabled(config)["qwen"] is True    # admin said yes
    assert _get_enabled_providers(config)["qwen"] is False        # but no key


# =============================================================================
# The auto-router no longer walks past a disabled local provider
# =============================================================================


def test_auto_router_respects_a_disabled_local_provider():
    """The last-resort branch returned Ollama without consulting
    enabled_providers, so every auto-routed message ignored the switch."""
    from providers.llm.model_intent_router import route

    decision = route("what is the weather", {"ollama": False, "nvidia_nim": True})
    assert decision.provider != "ollama"


def test_auto_router_uses_local_when_it_is_enabled():
    from providers.llm.model_intent_router import route

    decision = route("what is the weather", {"ollama": True})
    assert decision.provider == "ollama"


def test_auto_router_raises_when_everything_is_off():
    from providers.llm.model_intent_router import NoModelAvailable, route

    with pytest.raises(NoModelAvailable):
        route("hello there", {p: False for p in _USER_GATED_PROVIDERS})


def test_auto_router_fallback_still_honours_free_only():
    """With local off, the fallback picks from what is left — but a
    free-only account must not be handed a paid model to rescue the turn."""
    from providers.llm.model_intent_router import NoModelAvailable, route

    enabled = {"ollama": False, "deepseek": True, "qwen": True}
    decision = route("write me a poem", enabled, free_only=False)
    assert decision.provider in ("deepseek", "qwen")

    # Same providers, free-only: nothing they offer is free, so it must fail
    # loudly rather than silently bill the account.
    with pytest.raises(NoModelAvailable):
        route("write me a poem", enabled, free_only=True)


def test_free_only_fallback_prefers_a_free_provider():
    from providers.llm.model_intent_router import route

    decision = route(
        "write me a poem",
        {"ollama": False, "nvidia_nim": True, "deepseek": True},
        free_only=True,
    )
    assert decision.provider == "nvidia_nim"


# =============================================================================
# Saving a model obeys the same switch
# =============================================================================


def test_a_disabled_local_provider_cannot_be_saved(_state):
    """The save endpoint checked the switch only for cloud models, which made
    the local toggle decorative."""
    _set_config(_state, {"provider_enabled": {"ollama": False}})
    r = client.post(
        "/api/settings/llm",
        json={"provider": "ollama", "model_id": "llama3.2:3b"},
        headers=_admin(),
    )
    assert r.status_code == 400, r.text
    assert "disabled" in r.json()["detail"].lower()


def test_an_enabled_local_provider_can_be_saved(_state):
    _set_config(_state, {"provider_enabled": {"ollama": True}})
    r = client.post(
        "/api/settings/llm",
        json={"provider": "ollama", "model_id": "llama3.2:3b"},
        headers=_admin(),
    )
    assert r.status_code == 200, r.text


# =============================================================================
# Admin switch endpoint
# =============================================================================


def test_admin_can_flip_any_provider(_state):
    _set_config(_state, {})
    r = client.post(
        "/api/admin/provider-switches",
        json={"provider": "ollama", "enabled": False},
        headers=_admin(),
    )
    assert r.status_code == 200, r.text

    r = client.get("/api/admin/provider-switches", headers=_admin())
    body = r.json()
    row = next(p for p in body["providers"] if p["provider"] == "ollama")
    assert row["enabled"] is False
    assert row["is_local"] is True
    assert body["order"] == list(PROVIDER_ORDER)


def test_switch_endpoint_is_admin_only(_state):
    r = client.post(
        "/api/admin/provider-switches",
        json={"provider": "ollama", "enabled": False},
        headers=_user(),
    )
    assert r.status_code == 403


def test_unknown_provider_rejected(_state):
    r = client.post(
        "/api/admin/provider-switches",
        json={"provider": "nope", "enabled": True},
        headers=_admin(),
    )
    assert r.status_code == 400


# =============================================================================
# Voice toggle — was cosmetic
# =============================================================================


def test_a_hidden_voice_cannot_be_selected(_state):
    from providers.tts.voice_registry import VoiceRegistry

    voice = VoiceRegistry.list_all()[0]
    _set_config(_state, {"hidden_voices": [voice.voice_id]})

    r = client.post(
        "/api/settings/voice",
        json={"voice_id": voice.voice_id},
        headers=_admin(),
    )
    assert r.status_code == 403, r.text
    assert "administrator" in r.json()["detail"].lower()


def test_a_visible_voice_is_not_blocked_by_the_hidden_check(_state):
    """Only the hidden gate is under test — a missing .onnx is a separate,
    legitimate 404 that must not be mistaken for the toggle working."""
    from providers.tts.voice_registry import VoiceRegistry

    voice = VoiceRegistry.list_all()[0]
    _set_config(_state, {"hidden_voices": []})

    r = client.post(
        "/api/settings/voice",
        json={"voice_id": voice.voice_id},
        headers=_admin(),
    )
    assert r.status_code != 403


# =============================================================================
# Model listing says WHY something is unavailable
# =============================================================================


def test_listing_explains_a_disabled_provider(_state):
    _set_config(_state, {"provider_enabled": {"ollama": False}})
    r = client.get("/api/models", headers=_admin())
    assert r.status_code == 200
    local = r.json()["local"]
    assert local, "expected local models in the catalog"
    assert all(m["available"] is False for m in local)
    assert all("administrator" in (m["unavailable_reason"] or "").lower() for m in local)


def test_listing_reports_the_switch_matrix(_state):
    _set_config(_state, {"provider_enabled": {"ollama": False}})
    body = client.get("/api/models", headers=_admin()).json()
    assert body["provider_enabled"]["ollama"] is False
    assert body["provider_order"] == list(PROVIDER_ORDER)


# =============================================================================
# The two narrower gates auto used to walk straight past
# =============================================================================


def test_auto_avoids_a_model_the_admin_hid():
    """hidden_llms is enforced everywhere a human picks a model, but the
    automatic pick never saw it — so hiding one model left auto still
    reaching for it."""
    from providers.llm.model_intent_router import route

    enabled = {"ollama": True}
    first = route("write me a python function to sort a list", enabled)
    assert first.provider == "ollama"

    second = route(
        "write me a python function to sort a list",
        enabled,
        hidden_models={first.model_id},
    )
    assert second.model_id != first.model_id


def test_hiding_every_model_in_a_chain_still_finds_something():
    """Hiding models must narrow the choice, not dead-end the turn while a
    perfectly good model is still enabled."""
    from providers.llm.model_intent_router import route
    from providers.llm.registry import LLMRegistry

    local_ids = {m.model_id for m in LLMRegistry.list_local()}
    decision = route(
        "write me a python function",
        {"ollama": True, "nvidia_nim": True},
        hidden_models=local_ids,
    )
    assert decision.model_id not in local_ids


def test_hidden_models_are_excluded_from_the_last_resort_fallback():
    from providers.llm.model_intent_router import NoModelAvailable, route
    from providers.llm.registry import LLMRegistry

    nim_ids = {m.model_id for m in LLMRegistry.list_by_provider("nvidia_nim")}
    with pytest.raises(NoModelAvailable):
        route("hello", {"ollama": False, "nvidia_nim": True},
              hidden_models=nim_ids)


def test_auto_respects_per_user_provider_access(monkeypatch):
    """A provider closed to non-admins was still reachable through auto,
    because the router only ever saw the coarse provider switch."""
    from config import settings as settings_module
    from core import conversation_loop as cl

    s = settings_module.get_settings()
    monkeypatch.setattr(s, "qwen_api_key", "sk-test", raising=False)
    monkeypatch.setattr(s, "qwen_enabled", True, raising=False)

    captured = {}

    def fake_route(message, enabled_providers, free_only=False, hidden_models=None):
        captured["enabled"] = dict(enabled_providers)
        captured["hidden"] = set(hidden_models or ())
        raise RuntimeError("stop here — we only want the inputs")

    monkeypatch.setattr(
        "providers.llm.model_intent_router.route", fake_route)
    monkeypatch.setattr(s, "model_intent_router_enabled", True, raising=False)

    admin_config = {
        "provider_enabled": {"ollama": True, "qwen": True},
        "provider_user_access": {"qwen": False},
        "hidden_llms": ["llama3.2:1b"],
    }

    for is_admin, expected_qwen in ((False, False), (True, True)):
        captured.clear()
        try:
            cl._build_llm_provider(
                provider_override="auto",
                message_text="hello there",
                admin_config=admin_config,
                is_admin=is_admin,
            )
        except Exception:
            pass
        assert captured["enabled"]["qwen"] is expected_qwen, (
            f"is_admin={is_admin}")
        assert "llama3.2:1b" in captured["hidden"]


# =============================================================================
# UserAccess — one row, one failure policy
# =============================================================================
#
# These were two loaders running the same query with opposite behaviour on
# error. The unification turns on a distinction the pair blurred: a missing
# row is a definite answer, a failed lookup is not.


def test_unconfigured_is_not_restricted():
    """A session with no users row — kiosk, webhook, unit-initiated — has
    never had either flag set, so both take their unset value. Restricting
    these would quietly cut every such turn down to free models."""
    from core.conversation_loop import UserAccess

    assert UserAccess.UNCONFIGURED.is_admin is False
    assert UserAccess.UNCONFIGURED.free_models_only is False


def test_unknown_is_least_privilege_on_both_axes():
    """A failed lookup means we do not know who this is."""
    from core.conversation_loop import UserAccess

    assert UserAccess.UNKNOWN.is_admin is False
    assert UserAccess.UNKNOWN.free_models_only is True


class _FakeStore:
    def __init__(self, result=None, raises=False):
        self._result = result
        self._raises = raises
        self.calls = 0

    async def get_user_by_id(self, user_id):
        self.calls += 1
        if self._raises:
            raise RuntimeError("database is down")
        return self._result


class _FakeMemory:
    def __init__(self, store):
        self._store = store


def _loop_with(store):
    from core.conversation_loop import ConversationLoop

    loop = ConversationLoop.__new__(ConversationLoop)
    loop._memory = _FakeMemory(store)
    loop._user_id = "someone"
    return loop


def _access(store):
    import asyncio

    return asyncio.run(_loop_with(store)._load_user_access())


def test_a_real_admin_row_is_read_correctly():
    access = _access(_FakeStore({"role": "admin", "free_models_only": 0}))
    assert access.is_admin is True
    assert access.free_models_only is False


def test_a_restricted_user_row_is_read_correctly():
    access = _access(_FakeStore({"role": "user", "free_models_only": 1}))
    assert access.is_admin is False
    assert access.free_models_only is True


def test_a_missing_row_is_unconfigured_not_restricted():
    from core.conversation_loop import UserAccess

    assert _access(_FakeStore(None)) == UserAccess.UNCONFIGURED


def test_a_store_error_restricts_on_both_axes():
    """The old pair failed OPEN here on the restriction: a database hiccup
    handed a restricted account paid models. It is the accounts that *are*
    restricted where being wrong matters."""
    from core.conversation_loop import UserAccess

    assert _access(_FakeStore(raises=True)) == UserAccess.UNKNOWN


def test_an_admin_is_not_promoted_by_a_store_error():
    """Symmetrically: a failure must not grant admin reach either."""
    assert _access(_FakeStore(raises=True)).is_admin is False


def test_both_flags_come_from_one_read():
    """Two loaders meant two round-trips per turn for the same row."""
    store = _FakeStore({"role": "admin", "free_models_only": 0})
    _access(store)
    assert store.calls == 1
