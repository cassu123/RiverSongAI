import pytest
from fastapi.testclient import TestClient
from main import get_app
from providers.memory.sqlite_store import SQLiteStore
import asyncio

app = get_app()
client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    store = SQLiteStore()
    # Ensure tables exist
    asyncio.run(store.initialize())
    yield

def test_register_unit():
    response = client.post("/api/vector/register", json={
        "unit_id": "test_smoke_unit_1",
        "name": "Test Mower",
        "platform": "riding",
        "hardware": {"test": "data"}
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["registered", "ok"]
    assert "unit_token" in data
    
    # Unhappy path - telemetry without token
    response = client.post("/api/vector/telemetry", json={
        "unit_id": "test_smoke_unit_1",
        "battery_pct": 100.0
    })
    assert response.status_code == 401

    # Happy path - telemetry with token
    token = data["unit_token"]
    response = client.post("/api/vector/telemetry", json={
        "unit_id": "test_smoke_unit_1",
        "battery_pct": 100.0
    }, headers={"X-Unit-Token": token})
    assert response.status_code == 200

def test_ui_endpoints_without_auth():
    response = client.get("/api/vector/units")
    assert response.status_code == 401 # Should block due to missing Bearer token
