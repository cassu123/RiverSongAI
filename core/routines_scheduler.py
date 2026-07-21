"""
core/routines_scheduler.py

Background task that checks for scheduled routines and executes them.
Supports proactive briefings (Phase 13).
"""

import asyncio
import logging
from datetime import datetime
import zoneinfo
from fastapi import FastAPI
from core.conversation_loop import ConversationLoop
from core.distiller import run_distiller, sweep_messages

logger = logging.getLogger(__name__)





async def _check_routines(app: FastAPI):
    memory_manager = app.state.memory_manager
    store = memory_manager._store

    # We need a list of all users who have routines.
    # For now, we'll assume we can list all routines in the DB.
    # Note: SQLiteStore.list_routines usually takes a user_id.
    # We might need a global list_all_enabled_routines.

    # Mocking global list for now since SQLiteStore might not have it
    # If the method doesn't exist, we'll skip for this turn.
    if not hasattr(store, "get_enabled_routines"):
        return

    routines = await store.get_enabled_routines()
    now_utc = datetime.now(zoneinfo.ZoneInfo("UTC"))

    for r in routines:
        user_id = r["user_id"]

        # 1. Check if it’s time to run (based on user’s timezone)
        user_settings = await store.get_llm_settings(user_id)

        # Safe attribute/item access for timezone
        if isinstance(user_settings, dict):
            tz_str = user_settings.get("timezone") or "UTC"
        else:
            tz_str = getattr(user_settings, "timezone", "UTC")

        try:
            user_tz = zoneinfo.ZoneInfo(tz_str)
        except Exception:
            user_tz = zoneinfo.ZoneInfo("UTC")

        now_local = now_utc.astimezone(user_tz)

        # Schedule check (e.g. "08:00")
        if r["trigger"] == "time" and r["time"] == now_local.strftime("%H:%M"):
            # Check days (empty = every day)
            days = r.get("days") or []
            if isinstance(days, str):
                import json
                try:
                    days = json.loads(days)
                except Exception:
                    days = []
            if days:
                today_str = now_local.strftime("%a").lower()  # e.g., "mon"
                if not any(d.lower().startswith(today_str) for d in days):
                    continue

            # Check if it ran recently to avoid double-triggers in the same
            # minute
            last_run = r.get("last_run")
            if last_run:
                try:
                    lr_dt = datetime.fromisoformat(last_run)
                    if (now_utc - lr_dt).total_seconds() < 120:
                        continue
                except ValueError:
                    logger.warning(
                        "Routine '%s' has malformed last_run timestamp '%s' — "
                        "running it now and resetting the value.",
                        r.get("name"), last_run
                    )
                    # Don't skip — let it run, which will write a fresh valid
                    # timestamp

            logger.info(
                "Triggering scheduled routine '%s' for user %s",
                r["name"],
                user_id)
            asyncio.create_task(_run_proactive_routine(app, user_id, r))


async def _run_proactive_routine(app: FastAPI, user_id: str, routine: dict):
    # Instead of direct sockets, we just run the agent and submit to DeliveryRouter
    output_parts = []
    receipts = []
    async def capture(event: dict):
        if event.get("type") == "response_chunk" and event.get("text"):
            output_parts.append(event["text"])
        elif event.get("type") == "response_complete" and event.get("text"):
            if not output_parts:
                output_parts.append(event["text"])
        elif event.get("type") == "tool_execution" and event.get("tool"):
            # build a receipt
            res = str(event.get("result", ""))
            if len(res) > 200:
                res = res[:197] + "..."
            receipts.append(f"- **{event['tool']}**: {res}")

    try:
        from core.conversation_loop import ConversationLoop
        loop = ConversationLoop(
            user_id=user_id,
            memory_manager=app.state.memory_manager
        )
        await loop.initialize()

        # Run the routine
        await loop.run_text(routine["prompt"], capture)
        final_text = "".join(output_parts)
        
        # Add receipts to text if any
        if receipts:
            final_text += "\n\n**Action Receipts:**\n" + "\n".join(receipts)

        # Submit via DeliveryRouter
        from core.proactive import get_delivery_router, ProactiveItem
        router = get_delivery_router()
        if router:
            await router.submit(ProactiveItem(
                user_id=user_id,
                kind="routine",
                dedupe_key=f"routine_{routine['id']}_{datetime.now(zoneinfo.ZoneInfo('UTC')).strftime('%Y%m%d%H%M')}",
                severity=routine.get("severity", "info"),
                title=f"Routine: {routine['name']}",
                message=final_text,
                url="/routines"
            ))

        # Update last run time
        store = app.state.memory_manager._store
        await store.update_routine(routine["id"], user_id, {
            "last_run": datetime.now(zoneinfo.ZoneInfo("UTC")).isoformat(),
            "last_output": final_text
        })

    except Exception as exc:
        logger.error(
            "Failed to run proactive routine for %s: %s",
            user_id,
            exc)

async def _run_simple_routine(user_id: str, routine_id: str, name: str, prompt: str, severity: str):
    from main import app
    routine = {
        "id": routine_id,
        "name": name,
        "prompt": prompt,
        "severity": severity
    }
    await _run_proactive_routine(app, user_id, routine)
