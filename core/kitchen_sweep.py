import asyncio
import logging
import json
from datetime import datetime, timezone, timedelta

from database.core import engine
from sqlalchemy.orm import sessionmaker

from api.routes.culinary import _ws_manager, get_db, _get_household
from culinary.models import Household, Recipe, StockroomItem, ShoppingListItem, MealPlanEntry
from core.proactive import get_delivery_router, ProactiveItem

logger = logging.getLogger(__name__)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

async def kitchen_sweep_func():
    db = SessionLocal()
    try:
        households = db.query(Household).all()
        for hh in households:
            # check config for weekly plan
            # currently, we'll just run daily at 15:00 if no dinner is planned
            # Check local time
            now_utc = datetime.now(timezone.utc)
            # Default timezone to local, we assume UTC for now. 15:00 UTC = ?
            # Let's say if it's past 15:00 locally.
            # In a real app we'd get the timezone.
            # For simplicity, if current hour >= 15 and no meal planned for today, create a proposal.
            
            # Check low stock staples
            staples_low = db.query(StockroomItem).filter(
                StockroomItem.household_id == hh.id,
                StockroomItem.min_quantity > 0,
                StockroomItem.status.in_(["Low", "Out"])
            ).all()
            
            if staples_low:
                names = [s.name for s in staples_low]
                # Emit proactive item
                router = get_delivery_router()
                if router:
                    for uid in [hh.created_by]: # simplistic
                        if uid:
                            await router.route(
                                ProactiveItem(
                                    user_id=uid,
                                    module="culinary",
                                    content=f"Shopping day awareness: You are low/out of {len(names)} staples ({', '.join(names[:3])}{'...' if len(names)>3 else ''}).",
                                    priority=1
                                )
                            )
                            
            # Check today's plan
            today = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            today_entry = db.query(MealPlanEntry).filter(
                MealPlanEntry.household_id == hh.id,
                MealPlanEntry.plan_date == today
            ).first()
            
            if not today_entry and now_utc.hour >= 15:
                # Propose something
                recipes = db.query(Recipe).filter_by(household_id=hh.id).all()
                if recipes:
                    import random
                    rec = random.choice(recipes)
                    router = get_delivery_router()
                    if router:
                        for uid in [hh.created_by]:
                            if uid:
                                await router.route(
                                    ProactiveItem(
                                        user_id=uid,
                                        module="culinary",
                                        content=f"Dinner Proposal: How about {rec.name} tonight?",
                                        priority=1,
                                        actionable=True,
                                        action_payload=json.dumps({"type": "dinner_proposal", "recipe_id": rec.id})
                                    )
                                )
    except Exception as e:
        logger.error(f"Kitchen sweep failed: {e}")
    finally:
        db.close()
