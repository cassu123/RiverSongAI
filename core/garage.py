import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
import json
from config.settings import get_settings
from api.routes.vehicles import get_db, get_maintenance_timeline, _DB_URL
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from vehicles.models import Vehicle

logger = logging.getLogger(__name__)

# Re-use engine from vehicles if needed, but get_db should work if called correctly.
# Wait, get_db() yields a session.
_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def get_due_maintenance(user_id: str) -> List[dict]:
    """
    Returns a list of maintenance items due or overdue for all vehicles
    accessible to the user.
    """
    due_items = []
    settings = get_settings()
    remind_miles = getattr(settings, "maint_remind_miles", 500)
    remind_days = getattr(settings, "maint_remind_days", 14)
    
    with _Session() as db:
        # Note: get_maintenance_timeline uses get_vehicles which requires db and user_id
        from api.routes.vehicles import get_vehicles
        try:
            vehicles = get_vehicles(db, user_id)
        except Exception as e:
            logger.error("Failed to get vehicles for %s: %s", user_id, e)
            return []
            
        for v in vehicles:
            try:
                timeline = get_maintenance_timeline(
                    vehicle_id=str(v.id),
                    current_odometer=None,
                    current_date=None,
                    db=db,
                    user_id=user_id
                )
            except Exception as e:
                logger.error("Failed to get timeline for %s: %s", v.id, e)
                continue
                
            eff_odometer = timeline.get("eff_odometer")
            next_up = timeline.get("next_up")
            upcoming = timeline.get("upcoming", [])
            
            all_items = []
            if next_up:
                all_items.append(next_up)
            all_items.extend(upcoming)
            
            for item in all_items:
                delta_miles = item.get("delta_miles", float('inf'))
                delta_days = item.get("delta_days", float('inf'))
                is_overdue = item.get("is_overdue", False)
                
                if is_overdue or delta_miles <= remind_miles or delta_days <= remind_days:
                    due_items.append({
                        "vehicle_name": v.nickname or v.model,
                        "vehicle_id": str(v.id),
                        "item": item["description"],
                        "delta_miles": delta_miles if delta_miles != float('inf') else None,
                        "delta_days": delta_days if delta_days != float('inf') else None,
                        "is_overdue": is_overdue,
                        "odometer_estimated": timeline.get("odometer_estimated", False),
                        "eff_odometer": eff_odometer
                    })
                    
    return due_items


async def garage_sweep_func(app):
    """
    Reminder sweep for vehicle maintenance.
    """
    settings = get_settings()
    remind_miles = getattr(settings, "maint_remind_miles", 500)
    remind_days = getattr(settings, "maint_remind_days", 14)
    cooldown_days = getattr(settings, "maint_remind_cooldown_days", 7)
    stale_days = getattr(settings, "maint_odo_stale_days", 30)

    # In a real app we'd query users with vehicles. 
    # For now we can fetch all vehicles and map to users.
    from core.push import send_push_notification
    from api.routes.vehicles import get_vehicles, get_maintenance_timeline
    
    with _Session() as db:
        vehicles = db.query(Vehicle).all()
        for v in vehicles:
            owner_id = v.external_user_id
            
            # Determine who to notify
            notify_users = [owner_id]
            if v.assignments:
                notify_users.extend([a.person.external_user_id for a in v.assignments])
            notify_users = list(set(notify_users))
            
            try:
                timeline = get_maintenance_timeline(
                    vehicle_id=str(v.id),
                    current_odometer=None,
                    current_date=None,
                    db=db,
                    user_id=owner_id
                )
            except Exception as e:
                logger.error("Timeline error for vehicle %s: %s", v.id, e)
                continue
                
            # 1. Staleness nudge
            odometer_estimated = timeline.get("odometer_estimated", False)
            last_reading_at = timeline.get("last_reading_at")
            if odometer_estimated and last_reading_at:
                lr_dt = datetime.fromisoformat(last_reading_at.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - lr_dt).days > stale_days:
                    # Queue a mileage ask
                    for user in notify_users:
                        # Need to dedupe this somehow, perhaps via proactive_log
                        # but simple push for now if we have push
                        await send_push_notification(
                            user_id=user,
                            title=f"{v.nickname or v.model} Mileage Request",
                            body="It's been a while since your last reading. Please update the odometer."
                        )
                        
            # 2. Maintenance reminders
            next_up = timeline.get("next_up")
            upcoming = timeline.get("upcoming", [])
            items = []
            if next_up:
                items.append(next_up)
            items.extend(upcoming)
            
            for item in items:
                delta_miles = item.get("delta_miles", float('inf'))
                delta_days = item.get("delta_days", float('inf'))
                is_overdue = item.get("is_overdue", False)
                
                if is_overdue or delta_miles <= remind_miles or delta_days <= remind_days:
                    # Notify
                    # Ideally we dedupe using proactive_log, but we'll use a simple push for now
                    msg = f"{item['description']} is due soon."
                    if is_overdue:
                        msg = f"{item['description']} is OVERDUE."
                    for user in notify_users:
                        await send_push_notification(
                            user_id=user,
                            title=f"Maintenance Due: {v.nickname or v.model}",
                            body=msg
                        )
