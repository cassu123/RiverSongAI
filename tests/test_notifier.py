"""
tests/test_notifier.py

Q4#16 — notify_user / notify_admins fan-out helper.

Covers:
  - Flag-off short-circuit (no send_push call).
  - Successful send increments delivered count.
  - 410-Gone subscription is deleted from the store.
  - send_push raise → don't count, don't delete.
  - notify_admins iterates only over active admins.
  - ntfy parallel channel fires when ntfy_enabled.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from providers.push import notifier as notifier_mod


def _run(coro):
    return asyncio.run(coro)


class _S:
    def __init__(self, push_on=True, ntfy_on=False):
        self.push_notifications_enabled = push_on
        self.ntfy_enabled = ntfy_on


class _Store:
    """Fake store with user-id keyed subscription rows."""

    def __init__(self, subs_by_user=None, users=None):
        self._subs = subs_by_user or {}
        self._users = users or []
        self.deleted = []

    async def get_push_subscriptions(self, user_id):
        return list(self._subs.get(user_id, []))

    async def delete_push_subscription(self, user_id, endpoint):
        self.deleted.append((user_id, endpoint))
        self._subs[user_id] = [
            s for s in self._subs.get(user_id, [])
            if '"endpoint": "' + endpoint + '"' not in s
        ]

    async def list_users(self):
        return list(self._users)


def _sub(endpoint):
    return '{"endpoint": "' + endpoint + '", "keys": {}}'


# -----------------------------------------------------------------------------
# notify_user
# -----------------------------------------------------------------------------

class TestNotifyUser:
    def test_flag_off_no_send(self):
        store = _Store({"u1": [_sub("https://e/1")]})
        calls = []

        async def fake_send(*a, **kw):
            calls.append((a, kw))
            return True

        with patch.object(notifier_mod, "get_settings", return_value=_S(push_on=False)), \
             patch.object(notifier_mod, "send_push", side_effect=fake_send):
            n = _run(notifier_mod.notify_user(store, "u1", "t", "b"))
        assert n == 0
        assert calls == []

    def test_success_counted(self):
        store = _Store({"u1": [_sub("https://e/1"), _sub("https://e/2")]})

        async def fake_send(sub_json, **kw):
            return True

        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=fake_send):
            n = _run(notifier_mod.notify_user(store, "u1", "t", "b"))
        assert n == 2
        assert store.deleted == []

    def test_expired_sub_deleted(self):
        store = _Store({"u1": [_sub("https://e/dead")]})

        async def fake_send(sub_json, **kw):
            return False  # signals 410

        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=fake_send):
            n = _run(notifier_mod.notify_user(store, "u1", "t", "b"))
        assert n == 0
        assert store.deleted == [("u1", "https://e/dead")]

    def test_send_raise_not_counted_not_deleted(self):
        store = _Store({"u1": [_sub("https://e/1")]})

        async def fake_send(*a, **kw):
            raise RuntimeError("boom")

        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=fake_send):
            n = _run(notifier_mod.notify_user(store, "u1", "t", "b"))
        # Tri-state: exception → None outcome. Neither counted as delivered
        # nor pruned as expired. Caller sees an honest 0 rather than an
        # inflated success metric on transport failure.
        assert n == 0
        assert store.deleted == []

    def test_store_lookup_raise_is_swallowed(self):
        class BadStore(_Store):
            async def get_push_subscriptions(self, user_id):
                raise RuntimeError("db down")

        store = BadStore()
        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=AssertionError("must not call")):
            n = _run(notifier_mod.notify_user(store, "u1", "t", "b"))
        assert n == 0

    def test_ntfy_fired_when_enabled(self):
        store = _Store()
        sent = []

        async def fake_ntfy(user_id, title, body, **kw):
            sent.append((user_id, title, body))
            return True

        with patch.object(notifier_mod, "get_settings", return_value=_S(push_on=False, ntfy_on=True)), \
             patch.object(notifier_mod, "send_ntfy", side_effect=fake_ntfy):
            _run(notifier_mod.notify_user(store, "u1", "T", "B"))
        assert sent == [("u1", "T", "B")]


# -----------------------------------------------------------------------------
# notify_admins
# -----------------------------------------------------------------------------

class TestNotifyAdmins:
    def test_only_active_admins(self):
        users = [
            {"id": "a1", "role": "admin", "is_approved": True,  "is_suspended": False},
            {"id": "a2", "role": "admin", "is_approved": False, "is_suspended": False},
            {"id": "a3", "role": "admin", "is_approved": True,  "is_suspended": True},
            {"id": "u1", "role": "user",  "is_approved": True,  "is_suspended": False},
        ]
        store = _Store(
            subs_by_user={
                "a1": [_sub("https://e/a1")],
                "a2": [_sub("https://e/a2")],
                "a3": [_sub("https://e/a3")],
                "u1": [_sub("https://e/u1")],
            },
            users=users,
        )
        called_for = []

        async def fake_send(sub_json, **kw):
            called_for.append(sub_json)
            return True

        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=fake_send):
            n = _run(notifier_mod.notify_admins(store, "t", "b"))
        assert n == 1
        assert len(called_for) == 1
        assert "a1" in called_for[0]

    def test_list_users_raise_returns_zero(self):
        class BadStore(_Store):
            async def list_users(self):
                raise RuntimeError("db down")

        store = BadStore()
        with patch.object(notifier_mod, "get_settings", return_value=_S()), \
             patch.object(notifier_mod, "send_push", side_effect=AssertionError("must not call")):
            n = _run(notifier_mod.notify_admins(store, "t", "b"))
        assert n == 0
