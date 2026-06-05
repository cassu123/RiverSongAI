"""
tests/test_ntfy.py

Q4#17 — ntfy.sh fallback channel.

Covers:
  - Topic resolution (per-user env override, default fallback, both missing).
  - Flag-off short circuit (no HTTP issued).
  - Bearer-token header injection when ntfy_auth_token is set.
  - 2xx → True, 4xx/5xx → False, transport raise → False.
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import patch

import httpx
import pytest

from providers.push import ntfy as ntfy_mod


def _run(coro):
    return asyncio.run(coro)


# -----------------------------------------------------------------------------
# Settings stub — never mutate real settings; patch get_settings at the
# import location used by the module under test.
# -----------------------------------------------------------------------------

class _S:
    def __init__(
        self,
        enabled=True,
        base="https://ntfy.sh",
        default_topic="",
        token="",
    ):
        self.ntfy_enabled = enabled
        self.ntfy_base_url = base
        self.ntfy_default_topic = default_topic
        self.ntfy_auth_token = token


@pytest.fixture()
def _clean_env():
    keys = [k for k in os.environ if k.startswith("NTFY_TOPIC_")]
    saved = {k: os.environ.pop(k) for k in keys}
    yield
    for k, v in saved.items():
        os.environ[k] = v


# -----------------------------------------------------------------------------
# Topic resolution
# -----------------------------------------------------------------------------

class TestTopicResolution:
    def test_default_used_when_no_env(self, _clean_env):
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="rs-default")):
            assert ntfy_mod._resolve_topic("u1") == "rs-default"

    def test_per_user_env_wins(self, _clean_env):
        os.environ["NTFY_TOPIC_U1"] = "u1-private"
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="rs-default")):
            assert ntfy_mod._resolve_topic("u1") == "u1-private"

    def test_case_normalized_to_upper(self, _clean_env):
        os.environ["NTFY_TOPIC_U1"] = "u1-private"
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="rs-default")):
            assert ntfy_mod._resolve_topic("u1") == "u1-private"

    def test_no_topic_returns_none(self, _clean_env):
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="")):
            assert ntfy_mod._resolve_topic("u1") is None

    def test_unsafe_chars_stripped(self, _clean_env):
        # Env var lookup must be a safe identifier — '/' chars dropped, not
        # smuggled into NTFY_TOPIC_FOO/BAR.
        os.environ["NTFY_TOPIC_FOOBAR"] = "matched"
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="")):
            assert ntfy_mod._resolve_topic("foo/bar") == "matched"


# -----------------------------------------------------------------------------
# send_ntfy
# -----------------------------------------------------------------------------

class TestSendNtfy:
    def test_flag_off_returns_false(self):
        with patch.object(ntfy_mod, "get_settings", return_value=_S(enabled=False)):
            assert _run(ntfy_mod.send_ntfy("u1", "t", "b")) is False

    def test_no_topic_returns_false(self, _clean_env):
        with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="")):
            assert _run(ntfy_mod.send_ntfy("u1", "t", "b")) is False

    def test_success_returns_true(self, _clean_env):
        captured = {}

        def handler(request: httpx.Request):
            captured["url"] = str(request.url)
            captured["title"] = request.headers.get("Title")
            captured["priority"] = request.headers.get("Priority")
            captured["body"] = request.content.decode()
            return httpx.Response(200, text="OK")

        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport)
        try:
            with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="rs-default")):
                ok = _run(ntfy_mod.send_ntfy("u1", "Hi", "Body", client=client))
        finally:
            _run(client.aclose())
        assert ok is True
        assert captured["url"]      == "https://ntfy.sh/rs-default"
        assert captured["title"]    == "Hi"
        assert captured["priority"] == "3"
        assert captured["body"]     == "Body"

    def test_bearer_token_header_sent(self, _clean_env):
        captured = {}

        def handler(request: httpx.Request):
            captured["auth"] = request.headers.get("Authorization")
            return httpx.Response(200)

        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport)
        try:
            with patch.object(
                ntfy_mod,
                "get_settings",
                return_value=_S(default_topic="t", token="abc123"),
            ):
                _run(ntfy_mod.send_ntfy("u1", "t", "b", client=client))
        finally:
            _run(client.aclose())
        assert captured["auth"] == "Bearer abc123"

    def test_4xx_returns_false(self, _clean_env):
        transport = httpx.MockTransport(lambda r: httpx.Response(403, text="nope"))
        client = httpx.AsyncClient(transport=transport)
        try:
            with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="t")):
                ok = _run(ntfy_mod.send_ntfy("u1", "t", "b", client=client))
        finally:
            _run(client.aclose())
        assert ok is False

    def test_transport_error_returns_false(self, _clean_env):
        def handler(_request):
            raise httpx.ConnectError("nope")

        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport)
        try:
            with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="t")):
                ok = _run(ntfy_mod.send_ntfy("u1", "t", "b", client=client))
        finally:
            _run(client.aclose())
        assert ok is False

    def test_tags_header_when_passed(self, _clean_env):
        captured = {}

        def handler(request: httpx.Request):
            captured["tags"] = request.headers.get("Tags")
            return httpx.Response(200)

        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport)
        try:
            with patch.object(ntfy_mod, "get_settings", return_value=_S(default_topic="t")):
                _run(
                    ntfy_mod.send_ntfy(
                        "u1", "t", "b", tags=["warning", "skull"], client=client
                    )
                )
        finally:
            _run(client.aclose())
        assert captured["tags"] == "warning,skull"
