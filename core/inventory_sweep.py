import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
import json
from config.settings import get_settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.routes.inventory import _DB_URL
from inventory.models import InvHome, InventoryItem
from core.push import send_push_notification

logger = logging.getLogger(__name__)

_engine = create_engine(
    _DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in _DB_URL else {},
)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


async def inventory_sweep_func(app):
    """
    Reminder sweep for inventory registry health, warranty expiry, and stale audits.
    """
    settings = get_settings()
    warranty_remind_days = getattr(settings, "inv_warranty_remind_days", 30)
    audit_stale_days = getattr(settings, "inv_audit_stale_days", 180)
    
    with _Session() as db:
        homes = db.query(InvHome).all()
        now = datetime.now(timezone.utc)
        
        for home in homes:
            owner_id = str(home.owner_id)
            
            # 1. Stale Audit
            last_audit = home.last_audit_date
            if last_audit:
                # Assuming last_audit_date is naive UTC or aware
                if last_audit.tzinfo is None:
                    last_audit = last_audit.replace(tzinfo=timezone.utc)
                    
                days_since_audit = (now - last_audit).days
                if days_since_audit >= audit_stale_days:
                    title = f"Stale Audit: {home.name}"
                    body = f"It has been {days_since_audit} days since your last audit of {home.name}. Consider running a sector sweep to verify assets."
                    await send_push_notification(
                        owner_id, 
                        title, 
                        body, 
                        data={"route": f"/inventory?home={home.id}"},
                        dedupe_key=f"inv_audit_stale_{home.id}_{now.strftime('%Y%m')}" # Nudge once a month if stale
                    )
            else:
                # Never audited
                title = f"Never Audited: {home.name}"
                body = f"You have never completed a full audit for {home.name}. Consider initiating an audit."
                await send_push_notification(
                    owner_id, 
                    title, 
                    body, 
                    data={"route": f"/inventory?home={home.id}"},
                    dedupe_key=f"inv_audit_never_{home.id}_{now.strftime('%Y%m')}"
                )
                
            # 2. Warranty Expiry & 3. Registry Health Gaps
            items = db.query(InventoryItem).filter(InventoryItem.home_id == home.id).all()
            
            expiring_warranties = []
            missing_health = []
            
            for item in items:
                # Warranty
                if item.warranty_expiry_date:
                    w_date = item.warranty_expiry_date
                    if isinstance(w_date, str):
                        try:
                            w_date = datetime.strptime(w_date, "%Y-%m-%d").date()
                        except:
                            pass
                    if not isinstance(w_date, str):
                        w_dt = datetime(w_date.year, w_date.month, w_date.day, tzinfo=timezone.utc)
                        days_to_expiry = (w_dt - now).days
                        
                        if 0 <= days_to_expiry <= warranty_remind_days:
                            expiring_warranties.append((item, days_to_expiry))
                
                # Health
                issues = []
                if not item.serial_number: issues.append("serial")
                if not item.purchase_price and not item.replacement_cost: issues.append("value")
                
                # Check for primary photo presence
                has_photo = any(a.is_primary for a in item.attachments) if getattr(item, "attachments", None) else False
                if not has_photo and not item.receipt_image_path:
                    issues.append("photo")
                
                if issues:
                    missing_health.append((item, issues))
                    
            if expiring_warranties:
                for item, days in expiring_warranties:
                    title = f"Warranty Expiring: {item.name}"
                    body = f"The warranty for {item.name} expires in {days} days."
                    await send_push_notification(
                        owner_id,
                        title,
                        body,
                        data={"route": f"/inventory?item={item.id}"},
                        dedupe_key=f"inv_warranty_exp_{item.id}"
                    )
                    
            if missing_health:
                title = f"Registry Health: {home.name}"
                body = f"You have {len(missing_health)} items in {home.name} missing claim-readiness details (serials, values, or photos)."
                await send_push_notification(
                    owner_id,
                    title,
                    body,
                    data={"route": f"/inventory?home={home.id}"},
                    dedupe_key=f"inv_health_gaps_{home.id}_{now.strftime('%Y%V')}" # Nudge once a week
                )
