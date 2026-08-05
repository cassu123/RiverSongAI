"""Unit tests for providers.llm.agent_roles."""

from __future__ import annotations

import time

import pytest

from providers.llm.agent_roles import (
    AgentRole,
    AgentRoleRegistry,
    RoleConfig,
    get_role_registry,
    route_for_role,
)


def test_every_role_has_a_default_config():
    reg = AgentRoleRegistry()
    for role in AgentRole:
        cfg = reg.get(role)
        assert isinstance(cfg, RoleConfig)
        assert cfg.role is role
        assert cfg.provider, f"{role} has empty provider"
        assert cfg.model_id, f"{role} has empty model_id"


def test_all_returns_roles_in_enum_order():
    reg = AgentRoleRegistry()
    roles = [c.role for c in reg.all()]
    assert roles == list(AgentRole)


def test_get_role_registry_returns_singleton():
    assert get_role_registry() is get_role_registry()


def test_route_for_role_proxies_registry():
    reg = get_role_registry()
    assert route_for_role(AgentRole.SCRIBE) is reg.get(AgentRole.SCRIBE)


def test_record_invocation_stores_latest_only():
    reg = AgentRoleRegistry()
    assert reg.last_invocation(AgentRole.SCRIBE) is None

    reg.record_invocation(AgentRole.SCRIBE, success=True, elapsed_ms=120)
    first = reg.last_invocation(AgentRole.SCRIBE)
    assert first is not None
    assert first.success is True
    assert first.elapsed_ms == 120

    time.sleep(0.01)
    reg.record_invocation(AgentRole.SCRIBE, success=False, elapsed_ms=999, error="boom")
    second = reg.last_invocation(AgentRole.SCRIBE)
    assert second.success is False
    assert second.error == "boom"
    assert second.timestamp >= first.timestamp


def test_set_config_overrides_default():
    reg = AgentRoleRegistry()
    override = RoleConfig(
        role=AgentRole.SCRIBE,
        provider="ollama",
        model_id="llama3.2:3b",
        temperature=0.1,
        max_tokens=256,
        notes="local override",
    )
    reg.set_config(AgentRole.SCRIBE, override)
    assert reg.get(AgentRole.SCRIBE) is override


def test_invocation_records_use_configured_model_unless_overridden():
    reg = AgentRoleRegistry()
    reg.record_invocation(AgentRole.SIMPLE, success=True)
    inv = reg.last_invocation(AgentRole.SIMPLE)
    assert inv.model_id == reg.get(AgentRole.SIMPLE).model_id

    reg.record_invocation(AgentRole.SIMPLE, success=True, model_id_override="alt-model")
    inv = reg.last_invocation(AgentRole.SIMPLE)
    assert inv.model_id == "alt-model"


def test_role_values_are_lowercase_strings():
    for role in AgentRole:
        assert role.value == role.value.lower()
        assert "_" not in role.value, "role values should be flat lowercase"


def test_json_mode_roles_make_sense():
    """Roles that are documented as JSON-mode should actually be flagged."""
    reg = AgentRoleRegistry()
    for r in (AgentRole.SIFTER, AgentRole.WARDEN, AgentRole.REPORTER):
        assert reg.get(r).json_mode is True, f"{r} should be json_mode=True"
