"""
tests/test_fcm.py

Covers the FCM push channel and its notifier integration.

  - is_configured() returns False when flag off.
  - is_configured() returns False when flag on but service account missing.
  - send_fcm() returns False when not configured (no network call).
  - notifier fans out FCM in parallel and prunes tokens FCM rejected.
  - notifier swallows FCM transport exceptions (returns None outcome).
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import patch

import pytest

from providers.push import fcm as fcm_mod
from providers.push import notifier as notifier_mod


def _run(coro):
    return asyncio.run(coro)


class _S:
    def __init__(self, push_on=False, fcm_on=False, project="", path=""):
        self.push_notifications_enabled = push_on
        self.ntfy_enabled = False
        self.fcm_enabled = fcm_on
        self.fcm_project_id = project
        self.fcm_service_account_path = path


class _Store:
    def __init__(self, tokens_by_user=None):
        self._tokens = tokens_by_user or {}
        self.deleted_tokens = []

    async def get_push_subscriptions(self, user_id):
        return []

    async def delete_push_subscription(self, user_id, endpoint):
        pass

    async def get_fcm_tokens(self, user_id):
        return list(self._tokens.get(user_id, []))

    async def delete_fcm_token(self, user_id, token):
        self.deleted_tokens.append((user_id, token))
        self._tokens[user_id] = [
            t for t in self._tokens.get(user_id, []) if t != token
        ]

    async def list_users(self):
        return []


# -----------------------------------------------------------------------------
# is_configured / send_fcm guards
# -----------------------------------------------------------------------------

def test_is_configured_false_when_flag_off():
    with patch.object(fcm_mod, "get_settings", return_value=_S(fcm_on=False)):
        assert fcm_mod.is_configured() is False


def test_is_configured_false_when_path_missing(tmp_path):
    s = _S(fcm_on=True, project="proj-x", path=str(tmp_path / "missing.json"))
    with patch.object(fcm_mod, "get_settings", return_value=s):
        assert fcm_mod.is_configured() is False


def test_is_configured_false_when_project_id_empty(tmp_path):
    sa = tmp_path / "sa.json"
    sa.write_text("{}")
    s = _S(fcm_on=True, project="", path=str(sa))
    with patch.object(fcm_mod, "get_settings", return_value=s):
        assert fcm_mod.is_configured() is False


def test_send_fcm_returns_false_when_not_configured():
    # No service account, no project — send should short-circuit to False
    # without attempting any HTTP request.
    with patch.object(fcm_mod, "get_settings", return_value=_S(fcm_on=False)):
        result = _run(fcm_mod.send_fcm("any-token", "title", "body"))
    assert result is False


# -----------------------------------------------------------------------------
# notifier integration — parallel fan-out + prune on rejection
# -----------------------------------------------------------------------------

def test_notifier_prunes_rejected_fcm_tokens():
    store = _Store(tokens_by_user={"u1": ["tok-good", "tok-bad"]})

    async def fake_send_one_fcm(token, title, body):
        if token == "tok-good":
            return True
        return False  # mimic FCM 4xx UNREGISTERED

    with patch.object(notifier_mod, "fcm_is_configured", return_value=True), \
         patch.object(notifier_mod, "_send_one_fcm", side_effect=fake_send_one_fcm), \
         patch.object(notifier_mod, "get_settings", return_value=_S(push_on=False, fcm_on=True)):
        delivered = _run(notifier_mod.notify_user(store, "u1", "T", "B"))

    assert delivered == 1
    assert ("u1", "tok-bad") in store.deleted_tokens
    assert ("u1", "tok-good") not in store.deleted_tokens


def test_notifier_treats_fcm_exception_as_transient():
    store = _Store(tokens_by_user={"u1": ["tok-x"]})

    async def raising_send_fcm(token, title, body):
        raise RuntimeError("network down")

    with patch.object(notifier_mod, "fcm_is_configured", return_value=True), \
         patch.object(notifier_mod.send_fcm, "__call__", side_effect=raising_send_fcm), \
         patch.object(notifier_mod, "send_fcm", side_effect=raising_send_fcm), \
         patch.object(notifier_mod, "get_settings", return_value=_S(push_on=False, fcm_on=True)):
        delivered = _run(notifier_mod.notify_user(store, "u1", "T", "B"))

    assert delivered == 0
    # Transient — token NOT pruned.
    assert ("u1", "tok-x") not in store.deleted_tokens


def test_notifier_skips_fcm_when_not_configured():
    # When fcm_is_configured() is False, no token lookup or send happens.
    store = _Store(tokens_by_user={"u1": ["tok-x"]})

    with patch.object(notifier_mod, "fcm_is_configured", return_value=False), \
         patch.object(notifier_mod, "get_settings", return_value=_S(push_on=False, fcm_on=False)):
        delivered = _run(notifier_mod.notify_user(store, "u1", "T", "B"))

    assert delivered == 0
    assert store.deleted_tokens == []
