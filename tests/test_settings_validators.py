"""
tests/test_settings_validators.py

Production guardrails in config/settings.py. Covers the CORS wildcard
validator (audit M-2) alongside the existing ALLOWED_HOSTS one, since a
wildcard CORS origin with allow_credentials=True exposes credentialed
requests to any site.
"""

import pytest
from pydantic import ValidationError

from config.settings import Settings


def _settings(**overrides) -> Settings:
    """Build a Settings with safe production defaults, overridable per test.
    Required secrets come from the test env (see tests/conftest.py)."""
    base = dict(
        environment="production",
        allowed_hosts=["riversongai.com"],
        cors_origins=["https://riversongai.com"],
    )
    base.update(overrides)
    return Settings(**base)


def test_cors_wildcard_rejected_in_production():
    with pytest.raises(ValidationError):
        _settings(cors_origins=["*"])


def test_real_cors_origin_ok_in_production():
    s = _settings(cors_origins=["https://riversongai.com"])
    assert s.cors_origins == ["https://riversongai.com"]


def test_cors_wildcard_allowed_in_development():
    s = _settings(environment="development", cors_origins=["*"])
    assert "*" in s.cors_origins


def test_allowed_hosts_wildcard_still_rejected_in_production():
    # Guard against regressing the pre-existing ALLOWED_HOSTS validator.
    with pytest.raises(ValidationError):
        _settings(allowed_hosts=["*"])
