import asyncio
import logging
from datetime import datetime

from config.settings import get_settings
from core.timeutil import local_tz

logger = logging.getLogger(__name__)

async def generate_morning_brief(user_id: str, memory_manager) -> str:
    """Generates the morning brief for the user."""
    # This will be expanded as other systems (garage, inventory) come online.
    # For now, it compiles weather and calendar.
    
    sections = []
    
    s = get_settings()
    if s.latitude and s.longitude:
        from providers.feeds.weather import fetch_nws_alerts
        alerts = await fetch_nws_alerts(s.latitude, s.longitude)
        if alerts:
            alert_names = [a.get("event", "Alert") for a in alerts]
            sections.append(f"**Weather Alerts:** {', '.join(alert_names)}")
        else:
            sections.append("No active weather alerts today.")
            
    # Proactive items missed
    store = memory_manager._store
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
