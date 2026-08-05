import asyncio
import json
import uuid
import httpx
from datetime import datetime, timezone
import sys
import os

sys.path.insert(0, os.path.abspath("."))

from providers.memory.sqlite_store import SQLiteStore
from api.routes.vector_fleet import _get_command_event

async def main():
    store = SQLiteStore()
    unit_id = "VOY-RV-001"
    
    # 1. Insert a command
    cmd_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    ttl_seconds = 30
    
    sql = """
    INSERT INTO vector_commands (command_id, unit_id, issued_by, issued_at, action, params, status, ttl_seconds)
    VALUES (?, ?, 'system', ?, 'mow_start', '{}', 'pending', ?)
    """
    await store.execute_write_async(sql, (cmd_id, unit_id, now, ttl_seconds))
    
    # 2. Trigger the event
    _get_command_event(unit_id).set()
    _get_command_event(unit_id).clear()
    
    print(f"Inserted command {cmd_id}")

if __name__ == "__main__":
    asyncio.run(main())
