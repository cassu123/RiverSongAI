import asyncio
import logging
from datetime import datetime

from core.timeutil import local_tz

logger = logging.getLogger(__name__)

async def _weather_section(store, user_id: str) -> str:
    """Today's weather and any alerts, for the user's own saved location.

    This used to read settings.latitude / settings.longitude, which do not
    exist, so every brief died with AttributeError before it said anything;
    and it only ever reported alerts, never the forecast.
    """
    from fastapi import HTTPException
    from api.services.feed_service import FeedService
    from providers.feeds.weather import fetch_nws_alerts

    try:
        data = await FeedService.get_weather(store, user_id)
    except HTTPException:
        return ""  # no location saved
    except Exception as exc:
        logger.warning("Brief weather failed for %s: %s", user_id, exc)
        return ""

    lines = []
    cur = data.get("current") or {}
    today = (data.get("daily") or [{}])[0]
    unit = cur.get("unit") or ""
    if cur.get("temperature") is not None:
        lines.append(f"Now {round(cur['temperature'])}{unit}, "
                     f"{(cur.get('condition') or '').lower()}.")
    if today.get("temp_max") is not None and today.get("temp_min") is not None:
        lines.append(f"Today {(today.get('condition') or '').lower()}, "
                     f"high {round(today['temp_max'])}{unit}, "
                     f"low {round(today['temp_min'])}{unit}.")
    if data.get("outlook"):
        lines.append(data["outlook"])

    alerts = await fetch_nws_alerts(data.get("lat"), data.get("lon"))
    if alerts:
        lines.append("Alerts: " + ", ".join(a.get("event", "Alert") for a in alerts) + ".")

    return "**Weather:** " + " ".join(lines) if lines else ""


async def generate_morning_brief(user_id: str, memory_manager) -> str:
    """Generates the morning brief for the user."""
    # This will be expanded as other systems (garage, inventory) come online.
    # For now, it compiles weather and calendar.
    
    sections = []
    store = memory_manager._store

    weather = await _weather_section(store, user_id)
    if weather:
        sections.append(weather)

    # Proactive items missed
    overnight = await store.execute_read_async(
        "SELECT * FROM proactive_log WHERE user_id = ? AND delivered = 0 ORDER BY created_at ASC",
        (user_id,)
    )
    if overnight:
        sections.append(f"**Overnight Updates:** You missed {len(overnight)} notifications.")
        
    return "\n\n".join(sections) if sections else "Good morning! No new updates for today."

async def brief_sweep_func():
    from main import app
    from core.proactive import get_delivery_router, ProactiveItem
    
    router = get_delivery_router()
    if not router:
        return
        
    store = app.state.memory_manager._store
    # `users` has no timezone column and never has, so this query used to
    # raise OperationalError and the briefing sweep never produced anything.
    # There is no per-user timezone in the schema to read instead, so the
    # system default is what "7 AM local" means here. If per-user timezones
    # are ever added, core.timeutil is the one place that needs to change.
    tz = local_tz()

    users = await store.execute_read_async("SELECT id FROM users")

    for row in users:
        uid = row["id"]
            
        now_local = datetime.now(tz)
        
        # Check if it's 7 AM local time. We'll use 7 AM as default.
        if now_local.hour == 7 and 0 <= now_local.minute < 15:
            # Did we already generate one today?
            today_str = now_local.strftime("%Y-%m-%d")
            dedupe = f"brief_{today_str}"
            
            existing = await store.execute_read_one_async(
                "SELECT id FROM proactive_log WHERE user_id = ? AND dedupe_key = ?",
                (uid, dedupe)
            )
            if existing:
                continue
                
            brief_text = await generate_morning_brief(uid, app.state.memory_manager)
            
            await router.submit(ProactiveItem(
                user_id=uid,
                kind="brief",
                key=dedupe,
                severity="info",
                title="Morning Briefing",
                message=brief_text,
                speak=True
            ))
