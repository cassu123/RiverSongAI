"""
tests/test_fleet_api.py

Generic satellite fleet API (/api/horizon, /api/sentinel, /api/vortex):
claim → register → heartbeat → telemetry → command round-trip.
(Kova graduated to a dedicated router — see test_kova_api.py.)
"""

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token("test-admin", "admin@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def test_device_endpoints_require_unit_token():
    r = client.post("/api/horizon/telemetry",
                    json={"unit_id": "nope", "snapshots": []})
    assert r.status_code == 401


def test_admin_endpoints_require_auth():
    assert client.get("/api/sentinel/units").status_code == 401
    assert client.post("/api/sentinel/units/claim", json={"name": "x"}).status_code == 401


def test_full_unit_lifecycle(admin_headers):
    # Claim (admin)
    r = client.post("/api/horizon/units/claim",
                    json={"name": "Test Drone"}, headers=admin_headers)
    assert r.status_code == 200
    unit_id = r.json()["unit_id"]
    token = r.json()["unit_token"]
    device = {"X-Unit-Token": token}

    # Register (device)
    r = client.post("/api/horizon/register",
                    json={"unit_id": unit_id, "metadata": {"fw": "1.0"}},
                    headers=device)
    assert r.status_code == 200

    # Wrong token rejected
    r = client.post("/api/horizon/register",
                    json={"unit_id": unit_id},
                    headers={"X-Unit-Token": "wrong"})
    assert r.status_code == 401

    # Heartbeat + telemetry
    assert client.post("/api/horizon/heartbeat",
                       json={"unit_id": unit_id}, headers=device).status_code == 200
    r = client.post("/api/horizon/telemetry",
                    json={"unit_id": unit_id,
                          "snapshots": [{"timestamp": "2026-06-10T00:00:00Z",
                                         "battery_pct": 88}]},
                    headers=device)
    assert r.status_code == 200
    assert r.json()["stored"] == 1

    # Oversized batch rejected
    r = client.post("/api/horizon/telemetry",
                    json={"unit_id": unit_id, "snapshots": [{}] * 51},
                    headers=device)
    assert r.status_code == 413

    # No pending commands → 204
    r = client.get(f"/api/horizon/commands?unit_id={unit_id}", headers=device)
    assert r.status_code == 204

    # Admin queues a command; device polls and acks it
    r = client.post(f"/api/horizon/units/{unit_id}/command",
                    json={"command": "return_home", "params": {"speed": "slow"}},
                    headers=admin_headers)
    assert r.status_code == 200
    command_id = r.json()["command_id"]

    r = client.get(f"/api/horizon/commands?unit_id={unit_id}", headers=device)
    assert r.status_code == 200
    assert r.json()["command_id"] == command_id
    assert r.json()["command"] == "return_home"

    r = client.post(f"/api/horizon/commands/{command_id}/ack",
                    json={"status": "completed"}, headers=device)
    assert r.status_code == 200

    # Acked command no longer pending
    r = client.get(f"/api/horizon/commands?unit_id={unit_id}", headers=device)
    assert r.status_code == 204

    # Unit shows online in admin list
    r = client.get("/api/horizon/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["unit_id"] == unit_id)
    assert unit["online"] == 1
    assert unit["metadata"] == {"fw": "1.0"}

    # Cleanup
    assert client.delete(f"/api/horizon/units/{unit_id}",
                         headers=admin_headers).status_code == 200


def test_programs_are_isolated(admin_headers):
    # A sentinel unit's token must not work on the vortex prefix.
    r = client.post("/api/sentinel/units/claim",
                    json={"name": "Sentinel Bot"}, headers=admin_headers)
    unit_id, token = r.json()["unit_id"], r.json()["unit_token"]
    r = client.post("/api/vortex/heartbeat",
                    json={"unit_id": unit_id},
                    headers={"X-Unit-Token": token})
    assert r.status_code == 401
    client.delete(f"/api/sentinel/units/{unit_id}", headers=admin_headers)
