"""
core/tools_routines.py

Routine management tool executors.
Split out of core/tools.py (god-file audit #3); re-exported by core.tools
so the dispatcher and any external callers are unchanged.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def _exec_create_routine(args: dict, user_id: str) -> str:
    import uuid
    import json
    settings = get_settings()
    db_path = settings.db_path
    
    name = args.get("name", "Untitled Routine")
    trigger = args.get("trigger", "manual")
    prompt = args.get("action_description", "")
    days = args.get("days", [])
    severity = args.get("severity", "info")
    
    # Try to parse trigger as time if it looks like HH:MM
    time_val = None
    if ":" in trigger and any(c.isdigit() for c in trigger):
        time_val = trigger.strip()
        trigger = "schedule"
        
    rid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO routines
                    (id, user_id, name, trigger, time, days, prompt, type, severity, enabled, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (rid, user_id, name, trigger, time_val, json.dumps(days), prompt, "simple", severity, 1, now, now)
            )
            conn.commit()
            return f"Created routine '{name}' with ID {rid}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


async def _exec_list_routines(user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute("SELECT id, name, trigger, time, days, prompt, severity, enabled FROM routines WHERE user_id = ?", (user_id,)).fetchall()
            if not rows:
                return "You have no routines configured."
            lines = ["Here are your routines:"]
            import json
            for r in rows:
                days = json.loads(r[4])
                days_str = "every day" if not days else ", ".join(days)
                t = r[3] if r[3] else r[2]
                en = "" if r[7] else " (disabled)"
                lines.append(f"- {r[1]} (ID: {r[0]}){en}: runs at {t} on {days_str}. Action: {r[5]}")
            return "\n".join(lines)
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_update_routine(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            if not rid:
                return "routine_id is required."
            
            allowed = {"name", "trigger", "action_description", "days", "severity"}
            set_parts, vals = [], []
            import json
            for k, v in args.items():
                if k not in allowed: continue
                db_k = k
                if k == "action_description": db_k = "prompt"
                
                if k == "days":
                    v = json.dumps(v)
                elif k == "trigger":
                    if ":" in v and any(c.isdigit() for c in v):
                        set_parts.append("time = ?")
                        vals.append(v.strip())
                        v = "schedule"
                
                set_parts.append(f"{db_k} = ?")
                vals.append(v)
            
            if not set_parts:
                return "No fields to update."
            
            set_parts.append("updated_at = ?")
            vals.append(datetime.now(timezone.utc).isoformat())
            
            vals.extend([rid, user_id])
            
            conn.execute(f"UPDATE routines SET {', '.join(set_parts)} WHERE id = ? AND user_id = ?", vals)
            conn.commit()
            return f"Routine {rid} updated."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_delete_routine(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            conn.execute("DELETE FROM routines WHERE id = ? AND user_id = ?", (rid, user_id))
            conn.commit()
            return f"Routine {rid} deleted."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_run_routine_now(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            row = conn.execute("SELECT name, prompt, type, severity FROM routines WHERE id = ? AND user_id = ?", (rid, user_id)).fetchone()
            if not row:
                return "Routine not found."
            return (row[0], row[1], row[2], row[3])
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, _sync_work)
    if isinstance(res, str):
        return res
    name, prompt, r_type, severity = res
    if r_type != "simple":
        return f"Only 'simple' routines can be manually triggered with this tool. This is type {r_type}."
    
    # Actually run it
    from core.routines_scheduler import _run_simple_routine
    # Need to trigger it via background task so it doesn't block
    asyncio.create_task(_run_simple_routine(user_id, rid, name, prompt, severity))
    return f"Triggered routine '{name}' in the background."

