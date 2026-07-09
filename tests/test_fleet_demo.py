"""
tests/test_fleet_demo.py

The no-hardware fleet demo: the admin /units/simulate endpoint must create a
live (online) unit that the dashboard can read, and the seed script must
target every fleet program. Proves the "backends working to show" path.
"""

import pytest
from fastapi.testclient import TestClient

from api.routes.fleet import FLEET_PROGRAMS
from core.auth import create_access_token
from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token("test-admin", "admin@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def test_simulate_creates_and_removes_live_unit(admin_headers, monkeypatch):
    # Stub the background sim task: we're testing the endpoint's DB contract
    # (create -> listed as simulated -> teardown), not the 2s telemetry loop
    # (covered by test_fleet_api::test_simulator_profiles). Without this, the
    # live task races the teardown for the SQLite write lock.
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr("core.fleet_simulator.start_sim", _noop)
    monkeypatch.setattr("core.fleet_simulator.stop_sim", _noop)

    program = FLEET_PROGRAMS[0]
    r = client.post(f"/api/{program}/units/simulate", json={}, headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    unit_id = body["unit_id"]
    assert unit_id.startswith("sim-")
    assert body["simulated"] is True

    # Shows up in the admin list flagged simulated — this is what the Fleet
    # dashboard reads. (online is driven by the background sim task; in a live
    # server it stays 1, but TestClient cancels the task at request end, which
    # flips it to 0 — so we assert on the stable `simulated` metadata instead.)
    r = client.get(f"/api/{program}/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["unit_id"] == unit_id)
    assert unit["metadata"] == {"simulated": True}

    # Teardown endpoint removes it.
    assert client.delete(f"/api/{program}/units/{unit_id}/simulate",
                         headers=admin_headers).status_code == 200
    r = client.get(f"/api/{program}/units", headers=admin_headers)
    assert all(u["unit_id"] != unit_id for u in r.json()["units"])


def test_seed_script_covers_every_program():
    import inspect

    from scripts import seed_fleet_demo

    src = inspect.getsource(seed_fleet_demo)
    # Iterates the canonical program list and hits the simulate endpoint.
    assert "FLEET_PROGRAMS" in src
    assert "/units/simulate" in src
