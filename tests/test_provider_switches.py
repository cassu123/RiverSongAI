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
