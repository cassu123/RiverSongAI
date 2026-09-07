"""
core/tools_routines.py

Routine management tool executors.
Split out of core/tools.py (god-file audit #3); re-exported by core.tools
so the dispatcher and any external callers are unchanged.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid

from providers.memory.sqlite_store import get_shared_store

logger = logging.getLogger(__name__)

_background_tasks: set = set()


async def _exec_create_routine(args: dict, user_id: str) -> str:
    name = args.get("name", "Untitled Routine")
    trigger = args.get("trigger", "manual")
    prompt = args.get("action_description", "")
    days = args.get("days", [])
    severity = args.get("severity", "info")
    
    time_val = None
    if ":" in trigger and any(c.isdigit() for c in trigger):
        time_val = trigger.strip()
        trigger = "schedule"
        
    rid = str(uuid.uuid4())
    store = get_shared_store()
    await store.create_routine({
        "id": rid,
        "user_id": user_id,
        "name": name,
        "trigger": trigger,
        "time": time_val,
        "days": days,
        "prompt": prompt,
        "type": "simple",
        "severity": severity,
        "enabled": True,
    })
    return f"Created routine '{name}' with ID {rid}."


async def _exec_list_routines(user_id: str) -> str:
    store = get_shared_store()
    routines = await store.list_routines(user_id)
    if not routines:
        return "You have no routines configured."
    lines = ["Here are your routines:"]
    for r in routines:
        days = r.get("days") or []
        if isinstance(days, str):
            try:
                days = json.loads(days)
            except Exception:
                days = []
        days_str = "every day" if not days else ", ".join(days)
        t = r.get("time") or r.get("trigger")
        en = "" if r.get("enabled") else " (disabled)"
        lines.append(f"- {r.get('name')} (ID: {r.get('id')}){en}: runs at {t} on {days_str}. Action: {r.get('prompt')}")
    return "\n".join(lines)


async def _exec_update_routine(args: dict, user_id: str) -> str:
    rid = args.get("routine_id")
    if not rid:
        return "routine_id is required."
    store = get_shared_store()
    fields = {}
    if "name" in args:
        fields["name"] = args["name"]
    if "action_description" in args:
        fields["prompt"] = args["action_description"]
    if "days" in args:
        fields["days"] = args["days"]
    if "severity" in args:
        fields["severity"] = args["severity"]
    if "trigger" in args:
        v = args["trigger"]
        if ":" in v and any(c.isdigit() for c in v):
            fields["time"] = v.strip()
            fields["trigger"] = "schedule"
        else:
            fields["trigger"] = v

    if not fields:
        return "No fields to update."

    updated = await store.update_routine(rid, user_id, fields)
    if not updated:
        return f"Routine {rid} not found or no changes made."
    return f"Routine {rid} updated."


async def _exec_delete_routine(args: dict, user_id: str) -> str:
    rid = args.get("routine_id")
    if not rid:
        return "routine_id is required."
    store = get_shared_store()
    deleted = await store.delete_routine(rid, user_id)
    if deleted:
        return f"Routine {rid} deleted."
    return f"Routine {rid} not found."


async def _exec_run_routine_now(args: dict, user_id: str) -> str:
    rid = args.get("routine_id")
    if not rid:
        return "routine_id is required."
    store = get_shared_store()
    row = await store.execute_read_one_async(
        "SELECT name, prompt, type, severity FROM routines WHERE id = ? AND user_id = ?",
        (rid, user_id)
    )
    if not row:
        return "Routine not found."
    name = row["name"]
    prompt = row["prompt"]
    r_type = row["type"]
    severity = row["severity"]
    if r_type != "simple":
        return f"Only 'simple' routines can be manually triggered with this tool. This is type {r_type}."
    
    from core.routines_scheduler import _run_simple_routine
    task = asyncio.create_task(_run_simple_routine(user_id, rid, name, prompt, severity))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return f"Triggered routine '{name}' in the background."

