"""
tests/test_vexa_api.py

River Vexa driving-companion API (/api/vexa): claim → session → telemetry →
trip summary, the command poll queue, and the voice_task_request → tool →
confirmation-command round trip.
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
def vexa_unit(admin_headers):
    r = client.post("/api/vexa/units/claim",
                    json={"name": "Test Helmet"}, headers=admin_headers)
    assert r.status_code == 200
    unit_id = r.json()["unit_id"]
    device = {"X-Unit-Token": r.json()["unit_token"]}
    yield unit_id, device
    client.delete(f"/api/vexa/units/{unit_id}", headers=admin_headers)


def _poll(unit_id, device):
    r = client.get(f"/api/vexa/commands/poll?unit_id={unit_id}",
                   headers=device)
    assert r.status_code == 200
    return r.json()["commands"]


def test_device_endpoints_require_unit_token():
    r = client.post("/api/vexa/session/start",
                    json={"unit_id": "nope", "rider_id": "r",
                          "vehicle_type": "motorcycle"})
    assert r.status_code == 401
    r = client.get("/api/vexa/commands/poll?unit_id=nope")
    assert r.status_code == 401


def test_admin_endpoints_require_auth():
    assert client.get("/api/vexa/units").status_code == 401
    assert client.post("/api/vexa/units/claim",
                       json={"name": "x"}).status_code == 401


def test_session_telemetry_summary_lifecycle(vexa_unit, admin_headers):
    unit_id, device = vexa_unit

    # Invalid vehicle_type rejected
    r = client.post("/api/vexa/session/start",
                    json={"unit_id": unit_id, "rider_id": "chris",
                          "vehicle_type": "boat"},
                    headers=device)
    assert r.status_code == 422

    # Start a ride
    r = client.post("/api/vexa/session/start",
                    json={"unit_id": unit_id, "rider_id": "chris",
                          "vehicle_type": "motorcycle"},
                    headers=device)
    assert r.status_code == 200
    session_id = r.json()["session_id"]
    assert r.json()["started_at"]

    # Presence flipped to driving
    r = client.get("/api/vexa/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["unit_id"] == unit_id)
    assert unit["presence"] == "driving"
    assert unit["active_session_id"] == session_id

    # Batched telemetry (bike: obd is null)
    samples = [
        {"ts": "2026-06-12T10:00:00Z", "lat": 30.1, "lon": -97.7,
         "speed_mph": 41.0,
         "imu": {"accel_x": 0.1, "accel_y": 0.0, "accel_z": 9.8,
                 "lean_angle_deg": 12.5},
         "obd": None},
        {"ts": "2026-06-12T10:00:05Z", "lat": 30.2, "lon": -97.6,
         "speed_mph": 55.0, "imu": None, "obd": None},
    ]
    r = client.post("/api/vexa/telemetry",
                    json={"session_id": session_id, "samples": samples},
                    headers=device)
    assert r.status_code == 200
    assert r.json()["accepted"] == 2

    # Telemetry for an unknown session → 404
    r = client.post("/api/vexa/telemetry",
                    json={"session_id": "missing", "samples": samples},
                    headers=device)
    assert r.status_code == 404

    # Safety event is accepted and logged
    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id, "event_type": "fuel_low",
                          "payload": {"fuel_pct": 9}},
                    headers=device)
    assert r.status_code == 200
    assert r.json()["acknowledged"] is True

    # End the ride → summary generated from ingested telemetry
    r = client.post("/api/vexa/session/end",
                    json={"session_id": session_id}, headers=device)
    assert r.status_code == 200
    assert r.json()["ended_at"]
    assert r.json()["summary_ready"] is True

    # Presence back to idle
    r = client.get("/api/vexa/units", headers=admin_headers)
    unit = next(u for u in r.json()["units"] if u["unit_id"] == unit_id)
    assert unit["presence"] == "idle"
    assert unit["active_session_id"] is None

    # Admin can read the trip summary
    r = client.get(f"/api/vexa/units/{unit_id}/sessions",
                   headers=admin_headers)
    session = next(s for s in r.json()["sessions"]
                   if s["session_id"] == session_id)
    assert session["summary"]["samples"] == 2
    assert session["summary"]["max_speed_mph"] == 55.0

    # Ending again is idempotent
    r = client.post("/api/vexa/session/end",
                    json={"session_id": session_id}, headers=device)
    assert r.status_code == 200
    assert r.json()["summary_ready"] is True


def test_command_queue_poll_drains(vexa_unit, admin_headers):
    unit_id, device = vexa_unit

    # Empty queue → 200 with empty list (Vexa polls every few seconds)
    assert _poll(unit_id, device) == []

    # River Song queues a speak command; the unit picks it up once
    r = client.post(f"/api/vexa/units/{unit_id}/command",
                    json={"type": "speak",
                          "payload": {"text": "Storm ahead in 10 miles."}},
                    headers=admin_headers)
    assert r.status_code == 200
    command_id = r.json()["command_id"]

    commands = _poll(unit_id, device)
    assert len(commands) == 1
    assert commands[0]["command_id"] == command_id
    assert commands[0]["type"] == "speak"
    assert commands[0]["payload"] == {"text": "Storm ahead in 10 miles."}

    # Delivered commands are not re-sent
    assert _poll(unit_id, device) == []


def test_voice_task_request_shopping_round_trip(vexa_unit):
    # shopping_item runs against the real local executor (SQLite-backed)
    unit_id, device = vexa_unit
    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id,
                          "event_type": "voice_task_request",
                          "payload": {"kind": "shopping_item",
                                      "text": "milk"}},
                    headers=device)
    assert r.status_code == 200
    assert r.json()["acknowledged"] is True

    commands = _poll(unit_id, device)
    assert len(commands) == 1
    assert commands[0]["type"] == "shopping_item_added"
    assert commands[0]["payload"] == {"item": "milk"}


def test_voice_task_request_task_round_trip(vexa_unit, monkeypatch):
    # Google Tasks needs a linked account — stub the tool dispatch and
    # assert the route wiring + confirmation command.
    unit_id, device = vexa_unit
    calls = {}

    async def fake_execute_tool(tool_name, tool_input, context):
        calls["tool"] = tool_name
        calls["input"] = tool_input
        calls["user"] = context.get("user_id")
        return f"Successfully added task: '{tool_input['title']}'."

    monkeypatch.setattr("core.tools.execute_tool", fake_execute_tool)

    # Rider context comes from the active session
    r = client.post("/api/vexa/session/start",
                    json={"unit_id": unit_id, "rider_id": "chris",
                          "vehicle_type": "car"},
                    headers=device)
    session_id = r.json()["session_id"]

    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id,
                          "event_type": "voice_task_request",
                          "payload": {"kind": "task",
                                      "text": "pick up the dry cleaning"}},
                    headers=device)
    assert r.status_code == 200
    assert calls["tool"] == "add_google_task"
    assert calls["input"] == {"title": "pick up the dry cleaning"}
    assert calls["user"] == "chris"

    commands = _poll(unit_id, device)
    assert [c["type"] for c in commands] == ["task_created"]
    assert commands[0]["payload"] == {"title": "pick up the dry cleaning"}

    client.post("/api/vexa/session/end",
                json={"session_id": session_id}, headers=device)


def test_voice_task_request_reminder_with_due_at(vexa_unit, monkeypatch):
    unit_id, device = vexa_unit
    calls = {}

    async def fake_execute_tool(tool_name, tool_input, context):
        calls["tool"] = tool_name
        calls["input"] = tool_input
        return "Reminder set."

    monkeypatch.setattr("core.tools.execute_tool", fake_execute_tool)

    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id,
                          "event_type": "voice_task_request",
                          "payload": {"kind": "reminder",
                                      "text": "take out the trash",
                                      "due_at": "2026-06-13T18:00:00Z"}},
                    headers=device)
    assert r.status_code == 200
    assert calls["tool"] == "set_reminder"
    assert calls["input"] == {"message": "take out the trash",
                              "datetime_str": "2026-06-13T18:00:00Z"}

    commands = _poll(unit_id, device)
    assert commands[0]["type"] == "reminder_created"
    assert commands[0]["payload"] == {"title": "take out the trash",
                                      "due_at": "2026-06-13T18:00:00Z"}


def test_voice_task_request_reminder_missing_due_at_speaks(vexa_unit):
    unit_id, device = vexa_unit
    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id,
                          "event_type": "voice_task_request",
                          "payload": {"kind": "reminder",
                                      "text": "take out the trash"}},
                    headers=device)
    assert r.status_code == 200

    commands = _poll(unit_id, device)
    assert commands[0]["type"] == "speak"
    assert "time" in commands[0]["payload"]["text"].lower()


def test_voice_task_request_tool_failure_speaks(vexa_unit, monkeypatch):
    unit_id, device = vexa_unit

    async def failing_execute_tool(tool_name, tool_input, context):
        return ("I tried to add the task, but encountered an error: "
                "Google is not linked.")

    monkeypatch.setattr("core.tools.execute_tool", failing_execute_tool)

    r = client.post("/api/vexa/event",
                    json={"unit_id": unit_id,
                          "event_type": "voice_task_request",
                          "payload": {"kind": "task", "text": "call mom"}},
                    headers=device)
    assert r.status_code == 200

    commands = _poll(unit_id, device)
    assert commands[0]["type"] == "speak"
    assert "didn't go through" in commands[0]["payload"]["text"]


def test_tts_returns_wav(vexa_unit, monkeypatch):
    unit_id, device = vexa_unit

    class FakeTTS:
        async def synthesize(self, text):
            return b"RIFFfakewav"

    monkeypatch.setattr("api.routes.vexa._get_tts", lambda: FakeTTS())

    r = client.post("/api/vexa/tts",
                    json={"unit_id": unit_id, "text": "Fuel is low."},
                    headers=device)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    assert r.content == b"RIFFfakewav"


def test_tts_unavailable_returns_503(vexa_unit, monkeypatch):
    unit_id, device = vexa_unit

    def broken_tts():
        raise FileNotFoundError("piper not installed")

    monkeypatch.setattr("api.routes.vexa._get_tts", broken_tts)

    r = client.post("/api/vexa/tts",
                    json={"unit_id": unit_id, "text": "hello"},
                    headers=device)
    assert r.status_code == 503
