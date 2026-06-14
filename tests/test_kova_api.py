"""
tests/test_kova_api.py

River Kova chore-robot API (/api/kova): claim → register → heartbeat →
task queue round trip → telemetry → alerts, plus the kova_chores voice
intent dispatching into a unit's task queue.

The device-side contract lives in cassu123/river-kova
connectivity/api_client.py: bearer api_key + X-Kova-Unit header.
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


@pytest.fixture()
def kova_unit(admin_headers):
    r = client.post("/api/kova/units/claim",
                    json={"robot_id": "kova-test-01", "name": "Test Kova"},
                    headers=admin_headers)
    assert r.status_code == 200
    robot_id = r.json()["robot_id"]
    device = {"Authorization": f"Bearer {r.json()['api_key']}",
              "X-Kova-Unit": robot_id}
    yield robot_id, device
    client.delete(f"/api/kova/units/{robot_id}", headers=admin_headers)


def test_device_endpoints_require_auth():
    r = client.post("/api/kova/heartbeat",
                    json={"robot_id": "nope", "state": "IDLE",
                          "safety_level": "NOMINAL", "battery_pct": 50})
    assert r.status_code == 401
    r = client.get("/api/kova/units/nope/tasks",
                   headers={"X-Kova-Unit": "nope",
                            "Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_admin_endpoints_require_auth():
    assert client.get("/api/kova/units").status_code == 401
    assert client.post("/api/kova/units/claim",
                       json={"robot_id": "x"}).status_code == 401


def test_full_unit_lifecycle(kova_unit, admin_headers):
    robot_id, device = kova_unit

    # Duplicate claim rejected
    r = client.post("/api/kova/units/claim",
                    json={"robot_id": robot_id}, headers=admin_headers)
    assert r.status_code == 409

    # Register on boot
    r = client.post("/api/kova/units/register",
                    json={"robot_id": robot_id, "timestamp": 1765500000.0},
                    headers=device)
    assert r.status_code == 200

    # robot_id in body must match X-Kova-Unit
    r = client.post("/api/kova/units/register",
                    json={"robot_id": "someone-else"}, headers=device)
    assert r.status_code == 403

    # Heartbeat with extra fields — latest stored on the unit row
    r = client.post("/api/kova/heartbeat",
                    json={"robot_id": robot_id, "state": "IDLE",
                          "safety_level": "NOMINAL", "battery_pct": 87.5,
                          "timestamp": 1765500060.0,
                          "active_task": None, "wifi_rssi": -58},
                    headers=device)
    assert r.status_code == 200

    r = client.get("/api/kova/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["robot_id"] == robot_id)
    assert unit["online"] == 1
    assert unit["state"] == "IDLE"
    assert unit["safety_level"] == "NOMINAL"
    assert unit["battery_pct"] == 87.5
    assert unit["heartbeat_extra"]["wifi_rssi"] == -58

    # Admin queues a chore; bad chore types rejected
    r = client.post(f"/api/kova/units/{robot_id}/tasks",
                    json={"chore_type": "JUGGLE"}, headers=admin_headers)
    assert r.status_code == 400

    r = client.post(f"/api/kova/units/{robot_id}/tasks",
                    json={"chore_type": "VACUUM", "room": "kitchen",
                          "priority": 8},
                    headers=admin_headers)
    assert r.status_code == 200
    task_id = r.json()["task_id"]

    # Device polls its queue and receives the task once
    r = client.get(f"/api/kova/units/{robot_id}/tasks", headers=device)
    assert r.status_code == 200
    tasks = r.json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["id"] == task_id
    assert tasks[0]["chore_type"] == "VACUUM"
    assert tasks[0]["room"] == "kitchen"
    assert tasks[0]["priority"] == 8

    r = client.get(f"/api/kova/units/{robot_id}/tasks", headers=device)
    assert r.json()["tasks"] == []

    # Status reports: invalid value rejected, valid ones recorded
    r = client.post(f"/api/kova/tasks/{task_id}/status",
                    json={"robot_id": robot_id, "status": "DANCING"},
                    headers=device)
    assert r.status_code == 400

    r = client.post(f"/api/kova/tasks/{task_id}/status",
                    json={"robot_id": robot_id, "status": "RUNNING"},
                    headers=device)
    assert r.status_code == 200
    r = client.post(f"/api/kova/tasks/{task_id}/status",
                    json={"robot_id": robot_id, "status": "COMPLETED",
                          "message": "kitchen done"},
                    headers=device)
    assert r.status_code == 200

    # Unknown task → 404
    r = client.post("/api/kova/tasks/not-a-task/status",
                    json={"robot_id": robot_id, "status": "COMPLETED"},
                    headers=device)
    assert r.status_code == 404

    # Telemetry snapshot
    r = client.post("/api/kova/telemetry",
                    json={"robot_id": robot_id, "timestamp": 1765500120.0,
                          "metrics": {"cpu_temp_c": 61.2, "battery_pct": 86}},
                    headers=device)
    assert r.status_code == 200

    # Deregister on shutdown
    r = client.post("/api/kova/units/deregister",
                    json={"robot_id": robot_id}, headers=device)
    assert r.status_code == 200
    r = client.get("/api/kova/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["robot_id"] == robot_id)
    assert unit["online"] == 0
    assert unit["state"] == "SHUTDOWN"


def test_alerts_surface_and_critical_pushes(kova_unit, admin_headers,
                                            monkeypatch):
    robot_id, device = kova_unit
    pushed = []

    async def fake_notify_user(store, user_id, title, body):
        pushed.append((user_id, title, body))

    monkeypatch.setattr("providers.push.notifier.notify_user",
                        fake_notify_user)

    r = client.post("/api/kova/alerts",
                    json={"robot_id": robot_id, "level": "WARN",
                          "message": "Battery below 20 percent"},
                    headers=device)
    assert r.status_code == 200
    assert pushed == []  # WARN does not page anyone

    r = client.post("/api/kova/alerts",
                    json={"robot_id": robot_id, "level": "CRITICAL",
                          "message": "ESTOP triggered: human in 1m zone"},
                    headers=device)
    assert r.status_code == 200

    r = client.get(f"/api/kova/units/{robot_id}/alerts",
                   headers=admin_headers)
    levels = [a["level"] for a in r.json()["alerts"]]
    assert "WARN" in levels and "CRITICAL" in levels

    # Push fan-out only fires for CRITICAL, one per admin/operator user
    for _user_id, title, _body in pushed:
        assert "CRITICAL" in title


@pytest.mark.asyncio
async def test_voice_chore_dispatches_to_task_queue(kova_unit, monkeypatch):
    robot_id, device = kova_unit

    async def always_enabled(user_id, feature_key):
        return True

    monkeypatch.setattr("core.family.is_feature_enabled_for", always_enabled)

    from core.intent_router import IntentRouter
    intent_name, spoken = await IntentRouter().route(
        "have kova vacuum the kitchen", "test-user")

    assert intent_name == "kova_chores"
    assert "vacuum" in spoken.lower()

    r = client.get(f"/api/kova/units/{robot_id}/tasks", headers=device)
    tasks = r.json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["chore_type"] == "VACUUM"
    assert tasks[0]["room"] == "kitchen"
    assert tasks[0]["priority"] == 7
    assert tasks[0]["source"] == "voice"
    assert tasks[0]["requested_by"] == "test-user"


@pytest.mark.asyncio
async def test_voice_chore_without_units(admin_headers, monkeypatch):
    # Make sure no unit (including leftovers from aborted runs) can match.
    r = client.get("/api/kova/units", headers=admin_headers)
    for u in r.json()["units"]:
        client.delete(f"/api/kova/units/{u['robot_id']}",
                      headers=admin_headers)

    async def always_enabled(user_id, feature_key):
        return True

    monkeypatch.setattr("core.family.is_feature_enabled_for", always_enabled)

    from core.intent_router import IntentRouter
    intent_name, spoken = await IntentRouter().route(
        "tell kova to mop the bathroom", "test-user")

    assert intent_name == "kova_chores"
    # No kova units claimed in this test → graceful message
    assert "no kova units" in spoken.lower()
