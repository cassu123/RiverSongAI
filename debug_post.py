from fastapi.testclient import TestClient
from main import app
from core.auth import create_access_token

token = create_access_token("test_admin", "admin@test.com", "admin")
client = TestClient(app, base_url="http://localhost:8000")
res = client.post("/api/vector/schedules", headers={"Authorization": f"Bearer {token}"}, json={
    "name": "Live Test Schedule",
    "program_id": "test_id",
    "cron_utc": "* * * * *",
    "timezone_display": "UTC"
})
print("STATUS:", res.status_code)
print("TEXT:", res.text)
