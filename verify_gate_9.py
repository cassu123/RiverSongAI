import asyncio
import httpx
import uuid
from datetime import datetime, timezone
import json
import sqlite3

def run():
    # 1. Generate token by importing from core
    from core.auth import create_access_token
    token = create_access_token("test_admin", "admin@test.com", "admin")
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Token generated: {token[:20]}...")

    # 2. Get or create a program
    conn = sqlite3.connect("/mnt/data/river-song/db/river_song.db")
    c = conn.cursor()
    c.execute("SELECT program_id FROM vector_programs LIMIT 1")
    row = c.fetchone()
    if not row:
        prog_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        c.execute("INSERT INTO vector_programs (program_id, name, zone_ids, pattern, obstacle_clearance_m, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (prog_id, "Test Prog", "[]", "stripes", 0.20, now, now))
        conn.commit()
    else:
        prog_id = row[0]
    print(f"Using program: {prog_id}")

    # 3. Create schedule via HTTP
    client = httpx.Client(base_url="http://localhost:8000")
    res = client.post("/api/vector/schedules", headers=headers, json={
        "name": "Live Test Schedule",
        "program_id": prog_id,
        "cron_utc": "* * * * *",
        "timezone_display": "UTC"
    })
    print(f"POST /schedules: {res.status_code} {res.text}")
    sched_id = res.json()["schedule_id"]

    # 4. Wait for daemon to fire
    print("Waiting for schedule daemon to fire (up to 65s)...")
    import time
    start_time = time.time()
    found = False
    while time.time() - start_time < 130:
        c.execute("SELECT * FROM vector_commands WHERE issued_by = ?", (f"schedule:{sched_id}",))
        cmd = c.fetchone()
        if cmd:
            print("Command found!")
            print(f"Command ID: {cmd[0]}")
            print(f"Issued By: {cmd[2]}")
            found = True
            break
        time.sleep(5)
    
    if not found:
        print("Schedule did not fire within 70 seconds.")

    c.execute("SELECT next_run FROM vector_schedules WHERE schedule_id = ?", (sched_id,))
    next_run = c.fetchone()[0]
    print(f"Schedule next_run advanced to: {next_run}")
    
    conn.close()

if __name__ == "__main__":
    import sys
    sys.path.append("/home/riversong/RiverSongAI")
    run()
