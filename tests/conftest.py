"""
tests/conftest.py

Shared pytest setup. Settings are validated at import time, so required
secrets must exist in the environment before any app module is imported.
These are test-only values — never use them outside the test suite.
"""

import os

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("ALLOWED_HOSTS", '["*"]')
os.environ.setdefault("JWT_SECRET_KEY", "test-only-jwt-secret-key-0123456789abcdef")
os.environ.setdefault("DAEMON_INTERNAL_SECRET", "test-only-daemon-secret-0123456789")
os.environ.setdefault(
    "TOKEN_ENCRYPTION_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
)
