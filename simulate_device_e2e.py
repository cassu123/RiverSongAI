import asyncio
import json
import httpx
from datetime import datetime, timezone
from core.auth import create_access_token

UNIT_ID = "VOY-RV-001"
UNIT_TOKEN = "valid_token_123"
BASE_URL = "http://localhost:8000"

async def browser_sse_listener(token: str, stop_event: asyncio.Event):
    print("[Browser] Connecting to SSE stream...")
    async with httpx.AsyncClient() as client:
        async with client.stream("GET", f"{BASE_URL}/api/vector/units/stream", headers={"Authorization": f"Bearer {token}"}) as response:
            async for line in response.aiter_lines():
                if stop_event.is_set():
                    break
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    unit = next((u for u in data if u["unit_id"] == UNIT_ID), None)
                    if unit:
                        print(f"[Browser] SSE Update Received -> Mode: {unit.get('operating_mode')}, Battery: {unit.get('last_battery_pct')}%, Lat: {unit.get('last_lat')}")

async def device_long_poll(stop_event: asyncio.Event):
    print("[Device] Starting long poll for commands...")
    async with httpx.AsyncClient(timeout=35.0) as client:
        while not stop_event.is_set():
            try:
                res = await client.get(f"{BASE_URL}/api/vector/command/stream/{UNIT_ID}", headers={"X-Unit-Token": UNIT_TOKEN})
                if res.status_code == 200:
                    cmd = res.json()
                    print(f"[Device] Received command: {cmd['action']} (ID: {cmd['command_id']})")
                    # Ack
                    await client.post(f"{BASE_URL}/api/vector/command/{cmd['command_id']}/ack", headers={"X-Unit-Token": UNIT_TOKEN}, json={"status": "acknowledged"})
                    print(f"[Device] Acknowledged command.")
                    # Complete
                    await asyncio.sleep(1)
                    await client.post(f"{BASE_URL}/api/vector/command/{cmd['command_id']}/complete", headers={"X-Unit-Token": UNIT_TOKEN}, json={"status": "success", "result": "{}"})
                    print(f"[Device] Completed command.")
                    break
                elif res.status_code == 204:
                    continue
            except Exception as e:
                print(f"[Device] Long poll error: {e}")
                break

async def run_e2e():
    browser_token = create_access_token("test_admin", "admin@test.com", "admin")
    stop_sse = asyncio.Event()
    
    # 1. Start browser SSE listener
    sse_task = asyncio.create_task(browser_sse_listener(browser_token, stop_sse))
    await asyncio.sleep(1) # wait for connection
    
    async with httpx.AsyncClient() as client:
        # 2. Device Registration
        print("\n[Device] Registering...")
        res = await client.post(f"{BASE_URL}/api/vector/register", headers={"X-Unit-Token": UNIT_TOKEN}, json={
            "unit_id": UNIT_ID, "firmware_version": "1.0.0", "connectivity_tier": "lan"
        })
        print("[Device] Register response:", res.status_code, res.text)
        
        # 3. Pull Config
        print("\n[Device] Pulling config...")
        res = await client.get(f"{BASE_URL}/api/vector/config/{UNIT_ID}", headers={"X-Unit-Token": UNIT_TOKEN})
        print("[Device] Config version:", res.headers.get("x-config-version"))
        
        # 4. Device Posts Telemetry
        print("\n[Device] Posting telemetry batch...")
        now = datetime.now(timezone.utc).isoformat()
        res = await client.post(f"{BASE_URL}/api/vector/telemetry", headers={"X-Unit-Token": UNIT_TOKEN}, json={
            "unit_id": UNIT_ID,
            "snapshots": [{
                "timestamp": now,
                "operating_mode": "auto",
                "lat": 40.7128,
                "lng": -74.0060,
                "battery_pct": 85.5
            }]
        })
        print("[Device] Telemetry response:", res.status_code)
        
        # Give SSE time to print the telemetry update
        await asyncio.sleep(2)
        
        # 5. Device starts long polling
        poll_task = asyncio.create_task(device_long_poll(stop_sse))
        await asyncio.sleep(1) # ensure it is waiting
        
        # 6. Browser issues a command
        print("\n[Browser] Issuing 'mow_start' command to unit...")
        res = await client.post(f"{BASE_URL}/api/vector/units/{UNIT_ID}/command", headers={"Authorization": f"Bearer {browser_token}"}, json={
            "action": "mow_start", "params": {}
        })
        print("[Browser] Command issue response:", res.status_code, res.text)
        
        # Wait for device to process command
        await poll_task
        
    # Shutdown
    print("\n[System] E2E Complete. Shutting down...")
    stop_sse.set()
    await sse_task

if __name__ == "__main__":
    asyncio.run(run_e2e())
