import pytest
from fastapi.testclient import TestClient
from main import app
from providers.memory.sqlite_store import SQLiteStore
import asyncio

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    store = SQLiteStore()
    # Ensure tables exist
    asyncio.run(store.initialize())
    yield

def test_register_unit():
    # Units must be claimed (created with a token) before they can register,
    # so seed a claimed unit directly in the store.
    from datetime import datetime, timezone
    store = SQLiteStore()
    token = "test-unit-token-123"
    now = datetime.now(timezone.utc).isoformat()
    asyncio.run(store.execute_write_async(
        "DELETE FROM vector_units WHERE unit_id=?", ("test_smoke_unit_1",)))
    asyncio.run(store.insert_vector_unit(
        "test_smoke_unit_1", "Test Mower", "riding", token, now, now))

    # Unhappy path - register without token
    response = client.post("/api/vector/register", json={
        "unit_id": "test_smoke_unit_1",
        "firmware_version": "1.0.0",
    })
    assert response.status_code == 401

    # Happy path - register with token
    response = client.post("/api/vector/register", json={
        "unit_id": "test_smoke_unit_1",
        "firmware_version": "1.0.0",
    }, headers={"X-Unit-Token": token})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    telemetry_body = {
        "unit_id": "test_smoke_unit_1",
        "snapshots": [{"timestamp": now, "battery_pct": 100.0}],
    }

    # Unhappy path - telemetry without token
    response = client.post("/api/vector/telemetry", json=telemetry_body)
    assert response.status_code == 401

    # Happy path - telemetry with token
    response = client.post("/api/vector/telemetry", json=telemetry_body,
                           headers={"X-Unit-Token": token})
    assert response.status_code == 200

def test_ui_endpoints_without_auth():
    response = client.get("/api/vector/units")
    assert response.status_code == 401 # Should block due to missing Bearer token
