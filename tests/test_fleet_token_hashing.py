"""
tests/test_fleet_token_hashing.py

Security regression for audit finding H-2: fleet device tokens must be
stored as a sha256 hash at rest, never in plaintext. A claim returns the
plaintext once; the database row must hold only the hash, and the plaintext
must still authenticate device calls while the stored hash must not.

The live device-token surface is the generic fleet factory
(api/routes/fleet.py), which serves /api/{program}/* for every program in
FLEET_PROGRAMS. The standalone api/routes/{vexa,kova}.py modules are not
mounted (see main.py) but were hardened with the same pattern for future
wiring; they are covered by the unit-level hash primitive test below.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from api.routes.fleet import FLEET_PROGRAMS
from core.auth import create_access_token
from core.webhook_tokens import constant_time_match, hash_token
from main import app
from providers.memory.sqlite_store import SQLiteStore

client = TestClient(app)


@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token("test-admin", "admin@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def _read_one(sql, params):
    return asyncio.run(SQLiteStore().execute_read_one_async(sql, params))


@pytest.mark.parametrize("program", FLEET_PROGRAMS)
def test_fleet_claim_stores_only_hash(program, admin_headers):
    r = client.post(f"/api/{program}/units/claim",
                    json={"name": f"Hash {program}"}, headers=admin_headers)
    assert r.status_code == 200
    unit_id, plaintext = r.json()["unit_id"], r.json()["unit_token"]

    row = _read_one(
        "SELECT unit_token FROM fleet_units WHERE program=? AND unit_id=?",
        (program, unit_id))
    # Stored value is the sha256 hash, never the plaintext.
    assert row["unit_token"] != plaintext
    assert row["unit_token"] == hash_token(plaintext)

    # Plaintext authenticates; the stored hash presented as a token does not.
    assert client.post(f"/api/{program}/register", json={"unit_id": unit_id},
                       headers={"X-Unit-Token": plaintext}).status_code == 200
    assert client.post(f"/api/{program}/register", json={"unit_id": unit_id},
                       headers={"X-Unit-Token": row["unit_token"]}).status_code == 401

    client.delete(f"/api/{program}/units/{unit_id}", headers=admin_headers)


def test_rotate_token_rehashes(admin_headers):
    program = FLEET_PROGRAMS[0]
    r = client.post(f"/api/{program}/units/claim",
                    json={"name": "Rotate"}, headers=admin_headers)
    unit_id, old = r.json()["unit_id"], r.json()["unit_token"]

    r = client.post(f"/api/{program}/units/{unit_id}/rotate-token",
                    headers=admin_headers)
    new = r.json()["unit_token"]
    assert new != old

    row = _read_one(
        "SELECT unit_token FROM fleet_units WHERE program=? AND unit_id=?",
        (program, unit_id))
    # New plaintext hashes to the stored value; old token no longer matches.
    assert row["unit_token"] == hash_token(new)
    assert not constant_time_match(row["unit_token"], hash_token(old))

    client.delete(f"/api/{program}/units/{unit_id}", headers=admin_headers)


def test_dormant_module_helpers_use_hashing():
    """The standalone vexa/kova modules (not mounted) must share the hashed
    pattern so re-wiring them later cannot reintroduce plaintext storage."""
    import inspect

    from api.routes import kova, vexa

    for mod in (vexa, kova):
        src = inspect.getsource(mod)
        assert "hash_token(" in src, f"{mod.__name__} must hash tokens at claim"
        assert "constant_time_match(" in src, \
            f"{mod.__name__} must compare tokens in constant time"
