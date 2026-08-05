from fastapi.testclient import TestClient
from main import app
from api.routes.vector_fleet import _require_user
import json

client = TestClient(app, base_url="http://localhost:8000")
app.dependency_overrides[_require_user] = lambda: {"sub": "test", "role": "admin"}
res = client.post("/api/vector/zones", json={
    "name": "Test Zone",
    "boundary": [[40.0, -74.0], [40.1, -74.0], [40.1, -74.1], [40.0, -74.1]],
    "area_sqm": 100.5,
    "capture_method": "drawn"
})
print("STATUS:", res.status_code)
print("TEXT:", res.text)
if res.status_code == 200:
    print("GET:", client.get(f"/api/vector/zones/{res.json()['zone_id']}").text)
