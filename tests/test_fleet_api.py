"""
tests/test_fleet_api.py

Generic satellite fleet API (/api/horizon, /api/kova, /api/sentinel,
/api/vortex): claim → register → heartbeat → telemetry → command round-trip.
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
    assert client.get("/api/kova/units").status_code == 401
    assert client.post("/api/kova/units/claim", json={"name": "x"}).status_code == 401


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
    # A kova unit's token must not work on the vortex prefix.
    r = client.post("/api/kova/units/claim",
                    json={"name": "Kova Bot"}, headers=admin_headers)
    unit_id, token = r.json()["unit_id"], r.json()["unit_token"]
    r = client.post("/api/vortex/heartbeat",
                    json={"unit_id": unit_id},
                    headers={"X-Unit-Token": token})
    assert r.status_code == 401
    client.delete(f"/api/kova/units/{unit_id}", headers=admin_headers)


def test_vexa_is_mounted(admin_headers):
    # Vexa (vehicles) must now be a real program prefix.
    r = client.post("/api/vexa/units/claim",
                    json={"name": "Test Car"}, headers=admin_headers)
    assert r.status_code == 200
    unit_id = r.json()["unit_id"]
    assert client.get("/api/vexa/units", headers=admin_headers).status_code == 200
    client.delete(f"/api/vexa/units/{unit_id}", headers=admin_headers)


def test_admin_reads_and_controls(admin_headers):
    r = client.post("/api/vortex/units/claim",
                    json={"name": "Hub One"}, headers=admin_headers)
    unit_id, token = r.json()["unit_id"], r.json()["unit_token"]
    device = {"X-Unit-Token": token}

    client.post("/api/vortex/telemetry",
                json={"unit_id": unit_id, "snapshots": [{"cpu_pct": 12}]},
                headers=device)
    client.post("/api/vortex/alerts",
                json={"unit_id": unit_id, "level": "warning", "message": "hot"},
                headers=device)

    # Single unit
    r = client.get(f"/api/vortex/units/{unit_id}", headers=admin_headers)
    assert r.status_code == 200 and r.json()["unit_id"] == unit_id

    # Telemetry read
    r = client.get(f"/api/vortex/units/{unit_id}/telemetry", headers=admin_headers)
    assert r.status_code == 200 and len(r.json()["telemetry"]) == 1

    # Alerts read + ack
    r = client.get(f"/api/vortex/units/{unit_id}/alerts", headers=admin_headers)
    assert r.status_code == 200 and len(r.json()["alerts"]) == 1
    alert_id = r.json()["alerts"][0]["id"]
    assert client.post(f"/api/vortex/units/{unit_id}/alerts/{alert_id}/ack",
                       headers=admin_headers).status_code == 200
    r = client.get(f"/api/vortex/units/{unit_id}/alerts", headers=admin_headers)
    assert len(r.json()["alerts"]) == 0

    # Command history
    client.post(f"/api/vortex/units/{unit_id}/command",
                json={"command": "cast"}, headers=admin_headers)
    r = client.get(f"/api/vortex/units/{unit_id}/commands", headers=admin_headers)
    assert r.status_code == 200 and len(r.json()["commands"]) == 1

    # Rotate token: old token stops working, new one works
    r = client.post(f"/api/vortex/units/{unit_id}/rotate-token", headers=admin_headers)
    new_token = r.json()["unit_token"]
    assert new_token != token
    assert client.post("/api/vortex/heartbeat", json={"unit_id": unit_id},
                       headers={"X-Unit-Token": token}).status_code == 401
    assert client.post("/api/vortex/heartbeat", json={"unit_id": unit_id},
                       headers={"X-Unit-Token": new_token}).status_code == 200

    client.delete(f"/api/vortex/units/{unit_id}", headers=admin_headers)


def test_simulator_profiles():
    # Profiles are pure functions — drive them directly, no event loop.
    from core.fleet_simulator import PROFILES

    h = PROFILES["horizon"]
    st = h["init"]()
    h["command"](st, "takeoff", {"altitude": 30})
    for _ in range(15):
        snap = h["step"](st)
    assert snap["altitude_m"] > 20  # climbed toward target
    h["command"](st, "land", {})
    for _ in range(15):
        snap = h["step"](st)
    assert snap["altitude_m"] == 0 and snap["mode"] == "idle"

    v = PROFILES["vexa"]
    st = v["init"]()
    assert st["locked"] is True
    v["command"](st, "unlock", {})
    assert v["step"](st)["locked"] is False
    v["command"](st, "summon", {})
    for _ in range(5):
        snap = v["step"](st)
    assert snap["speed_kph"] > 0 and snap["gear"] == "D"
