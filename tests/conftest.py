"""
tests/conftest.py

Shared pytest setup.

Two jobs, both of which must happen before any app module is imported.

**Secrets.** Settings are validated at import time, so the required ones have
to exist in the environment first. These are test-only values — never use them
outside the test suite.

**Isolation.** Every database the suite writes to is redirected into a
throwaway directory. Without this, `pytest` creates users, fleet units,
pairing records, recipes and cooking sessions in whatever database the ambient
`.env` points at — which on the production box is the live one. That makes
running the suite as a deploy gate unsafe, and quietly pollutes a developer's
own data the rest of the time.

The database variables are set with plain assignment rather than
`setdefault`: a `.env` in the working directory would otherwise win, and that
is precisely the case being guarded against. The secrets keep `setdefault` so
CI and a developer shell can still override them.

Set `RS_TEST_KEEP_DATA=1` to keep the directory after a run for inspection.
"""

import atexit
import os
import shutil
import tempfile

# --- Secrets: overridable, because CI and local shells legitimately set them.
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("ALLOWED_HOSTS", '["*"]')
os.environ.setdefault("JWT_SECRET_KEY", "test-only-jwt-secret-key-0123456789abcdef")
os.environ.setdefault("DAEMON_INTERNAL_SECRET", "test-only-daemon-secret-0123456789")
os.environ.setdefault(
    "TOKEN_ENCRYPTION_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
)

# --- Isolation: not overridable, because the whole point is to beat .env.
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="riversong-tests-")
os.makedirs(_TEST_DATA_DIR, exist_ok=True)


def _sqlite_url(name: str) -> str:
    return "sqlite:///" + os.path.join(_TEST_DATA_DIR, name)


# The main store, read through config.settings.
os.environ["DB_PATH"] = os.path.join(_TEST_DATA_DIR, "river_song.db")
os.environ["CHROMA_PATH"] = os.path.join(_TEST_DATA_DIR, "chroma")

# The SQLAlchemy modules each own a separate file and read their own variable.
os.environ["CULINARY_DB_URL"] = _sqlite_url("culinary.db")
os.environ["INVENTORY_DB_URL"] = _sqlite_url("inventory.db")
os.environ["VEHICLES_DB_URL"] = _sqlite_url("vehicles.db")
os.environ["COMMERCE_DB_URL"] = _sqlite_url("commerce.db")


@atexit.register
def _cleanup_test_data() -> None:
    if os.environ.get("RS_TEST_KEEP_DATA"):
        print(f"\n[conftest] test data kept at {_TEST_DATA_DIR}")
        return
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
