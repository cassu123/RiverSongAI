"""
tests/test_daemon_secret_auth.py

The shared-secret gate on internal daemon IPC, and the n8n webhook gate.

Both are constant-time comparisons that several routes now delegate to, so a
regression here silently reopens every internal endpoint at once. The
load-bearing assertions are the negative ones: an unset secret must refuse
rather than wave callers through, and a near-miss token must not be accepted.
"""

import importlib.util
import pathlib
import sys

import pytest

from core.auth import verify_daemon_secret

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _features_module():
    """
    Load api/routes/features.py by path. Importing it as `api.routes.features`
    runs api/routes/__init__.py, which pulls in every router in the app and
    every optional cloud SDK with it.
    """
    name = "_features_under_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, _ROOT / "api" / "routes" / "features.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


VALID = "test-only-daemon-secret-0123456789"


@pytest.fixture
def secret(monkeypatch):
    """Point verify_daemon_secret at a known secret."""
    import core.auth as auth

    class _S:
        daemon_internal_secret = VALID

    monkeypatch.setattr(auth, "get_settings", lambda: _S())
    return VALID


def test_accepts_the_bearer_token(secret):
    assert verify_daemon_secret(f"Bearer {VALID}") is True


def test_accepts_a_bare_token_without_the_bearer_prefix(secret):
    assert verify_daemon_secret(VALID) is True


def test_rejects_a_wrong_secret(secret):
    assert verify_daemon_secret(f"Bearer {VALID}x") is False
    assert verify_daemon_secret("Bearer nonsense") is False


def test_rejects_a_missing_header(secret):
    assert verify_daemon_secret(None) is False
    assert verify_daemon_secret("") is False


def test_rejects_trailing_whitespace_on_the_presented_token(secret):
    """The token is compared verbatim. Stripping it would widen the secret."""
    assert verify_daemon_secret(f"Bearer {VALID} ") is False
    assert verify_daemon_secret(f"Bearer {VALID}\n") is False


def test_rejects_a_non_ascii_header_instead_of_raising(secret):
    """compare_digest raises TypeError on non-ASCII str; that must be a no."""
    assert verify_daemon_secret("Bearer ünicode") is False


def test_fails_closed_when_no_secret_is_configured(monkeypatch):
    """An unconfigured secret must refuse everything, including empty input."""
    import core.auth as auth

    for value in ("", "   ", None):
        class _S:
            daemon_internal_secret = value

        monkeypatch.setattr(auth, "get_settings", lambda: _S())
        assert verify_daemon_secret("Bearer anything") is False
        assert verify_daemon_secret("") is False
        assert verify_daemon_secret(None) is False


def test_comparison_is_constant_time():
    """Guards against a refactor back to ==."""
    import inspect

    src = inspect.getsource(verify_daemon_secret)
    assert "compare_digest" in src
    assert "==" not in src.split("def ", 1)[1]


def test_every_ai_feature_flag_maps_to_a_real_settings_field():
    """
    DaemonControlSection PUTs these flag names; a name missing from the map
    makes the endpoint 400 and the switch inert. A name mapped to a field that
    does not exist writes a phantom attribute nothing reads.
    """
    from config.settings import Settings

    AI_FEATURE_MAP = _features_module().AI_FEATURE_MAP
    fields = set(Settings.model_fields)
    unmapped = {k: v for k, v in AI_FEATURE_MAP.items() if v not in fields}
    assert not unmapped, f"flags pointing at non-existent Settings fields: {unmapped}"


@pytest.mark.parametrize(
    "flag",
    [
        "WARDEN_ENABLED",
        "MECHANIC_ENABLED",
        "SIFTER_ENABLED",
        "DAEMON_PULSE_ENABLED",
        "DAEMON_SCRIBE_ENABLED",
    ],
)
def test_daemon_toggles_are_reachable_from_the_settings_ui(flag):
    """Each switch rendered by DaemonControlSection must be accepted by PUT."""
    AI_FEATURE_MAP = _features_module().AI_FEATURE_MAP

    assert flag in AI_FEATURE_MAP, (
        f"{flag} is rendered as a toggle but PUT /api/features/{flag} would 400"
    )
