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


async def start_scheduler(app: FastAPI):
    """Polls for scheduled routines every minute."""
    logger.info("Routine scheduler started.")
    while True:
        try:
            await _check_routines(app)
        except Exception as exc:
            logger.error("Error in routine scheduler: %s", exc)
            
        try:
            await run_distiller(app)
            await sweep_messages(app)
        except Exception as exc:
            logger.error("Error in distiller scheduler: %s", exc)

        # Wait until the next minute
        now = datetime.now()
        sleep_secs = 60 - now.second
        await asyncio.sleep(sleep_secs)


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
    """Executes a routine and pushes the response to active WebSockets."""
    active_sockets = app.state.active_connections.get(user_id, [])
    if not active_sockets:
        logger.info(
            "No active WebSocket for user %s. Routine will run silently (save to history).",
            user_id)

    # Define a sender that broadcasts to all active tabs for this user
    async def broadcast(event: dict):
        for ws in active_sockets:
            try:
                await ws.send_json(event)
            except Exception:
                pass

    try:
        loop = ConversationLoop(
            user_id=user_id,
            memory_manager=app.state.memory_manager
        )
        await loop.initialize()

        # For proactive briefings, we use run_text with the routine prompt
        await broadcast({"type": "proactive_briefing_start", "name": routine["name"]})
        await loop.run_text(routine["prompt"], broadcast)  # type: ignore

        # Update last run time
        store = app.state.memory_manager._store
        await store.update_routine(routine["id"], user_id, {"last_run": datetime.now(zoneinfo.ZoneInfo("UTC")).isoformat()})

        # ── Notification fan-out — routes through the central helper so
        # Web Push, ntfy, and Apprise all fire together when configured,
        # and 410-Gone subscriptions are pruned automatically.
        try:
            from providers.push.notifier import notify_user
            await notify_user(
                store,
                user_id,
                title=f"River Song — {routine['name']}",
                body="New briefing ready.",
            )
        except Exception as push_exc:
            logger.warning(
                "Routine push fan-out failed for %s: %s",
                user_id,
                push_exc)

    except Exception as exc:
        logger.error(
            "Failed to run proactive routine for %s: %s",
            user_id,
            exc)
