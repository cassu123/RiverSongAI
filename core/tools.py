"""
core/tools.py

Tool definitions and execution logic for River Song AI.
Enables LLMs to perform real-world actions via function calling.
"""

from __future__ import annotations

import logging
import sqlite3
import json
import os
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

# =============================================================================
# Tool Schemas (Anthropic / Ollama compatible format)
# =============================================================================

TOOL_SCHEMAS = [
    {
        "name": "create_calendar_event",
        "description": "Create a new event on the user's Google Calendar.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The name of the event."},
                "date": {"type": "string", "description": "The date in YYYY-MM-DD format."},
                "time": {"type": "string", "description": "The start time in HH:MM format."},
                "duration_minutes": {"type": "integer", "description": "Length of the event in minutes. Defaults to 30."},
            },
            "required": ["title", "date", "time"]
        }
    },
    {
        "name": "add_inventory_item",
        "description": "Add a new physical item to the user's home inventory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name of the item."},
                "quantity": {"type": "integer", "description": "How many units."},
                "unit": {"type": "string", "description": "Unit of measure (e.g., pieces, gallons, boxes)."},
                "location": {"type": "string", "description": "Where the item is stored (e.g., Kitchen Pantry, Garage)."},
                "category": {"type": "string", "description": "Broad classification (e.g., Food, Tools, Electronics)."},
            },
            "required": ["name", "quantity", "location"]
        }
    },
    {
        "name": "add_shopping_list_item",
        "description": "Add an item to the user's grocery or shopping list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "The item to buy."},
                "quantity": {"type": "integer", "description": "Quantity to purchase."},
            },
            "required": ["item"]
        }
    },
    {
        "name": "set_reminder",
        "description": "Schedule a personal reminder for a specific date and time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "What the user wants to be reminded about."},
                "datetime_str": {"type": "string", "description": "The date and time in ISO 8601 format."},
            },
            "required": ["message", "datetime_str"]
        }
    },
    {
        "name": "control_device",
        "description": "Control a smart home device via Home Assistant (lights, locks, climate).",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_name": {"type": "string", "description": "Plain English name of the device (e.g., kitchen lights)."},
                "action": {"type": "string", "enum": ["on", "off", "toggle", "set"], "description": "Action to perform."},
                "value": {"type": "string", "description": "Optional value for the action (e.g., brightness level or temperature)."},
            },
            "required": ["device_name", "action"]
        }
    },
    {
        "name": "log_vehicle_maintenance",
        "description": "Record a service or maintenance event for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_name": {"type": "string", "description": "Name of the vehicle."},
                "service_type": {"type": "string", "description": "What was done (e.g., oil change, tire rotation)."},
                "date": {"type": "string", "description": "Date of service (YYYY-MM-DD)."},
                "mileage": {"type": "integer", "description": "Odometer reading at time of service."},
            },
            "required": ["vehicle_name", "service_type", "date"]
        }
    },
    {
        "name": "add_recipe_to_library",
        "description": "Save a new recipe to the user's culinary library.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Recipe name."},
                "source_url": {"type": "string", "description": "Optional URL where the recipe was found."},
                "notes": {"type": "string", "description": "Any additional comments or tags."},
            },
            "required": ["title"]
        }
    },
    {
        "name": "create_routine",
        "description": "Create an automated routine or sequence of actions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "The name of the routine."},
                "trigger": {"type": "string", "description": "The condition that starts the routine."},
                "action_description": {"type": "string", "description": "What happens when the routine runs."},
            },
            "required": ["name", "trigger", "action_description"]
        }
    },
    {
        "name": "check_reading_status",
        "description": "Check the user's reading shelf for a specific book or overall status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Optional title of the book to check."},
            },
            "required": []
        }
    },
    {
        "name": "sync_kindle_library",
        "description": "Synchronize the user's Kindle library with their reading shelf.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "search_commerce_products",
        "description": "Search the commercial inventory for products to check stock levels or prices.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The product name or SKU to search for."},
            },
            "required": ["query"]
        }
    },
    {
        "name": "create_commerce_sale",
        "description": "Create a new sale record in the commercial inventory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string", "description": "The ID or exact SKU of the product being sold."},
                "quantity": {"type": "integer", "description": "The number of units sold."},
                "customer_name": {"type": "string", "description": "Optional name of the customer."},
            },
            "required": ["product_id", "quantity"]
        }
    },
    {
        "name": "trigger_n8n_workflow",
        "description": "Trigger an advanced automation workflow in n8n.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workflow_id": {"type": "string", "description": "The ID of the n8n workflow to execute."},
                "data": {"type": "object", "description": "Optional JSON data to pass to the workflow."},
            },
            "required": ["workflow_id"]
        }
    },
    {
        "name": "generate_business_report",
        "description": "Generate an AI-driven business report based on commerce analytics and sales data.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of days of data to analyze. Defaults to 30."},
            },
            "required": []
        }
    }
]

# =============================================================================
# Tool Executor
# =============================================================================

async def execute_tool(tool_name: str, tool_input: Dict[str, Any], context: Dict[str, Any]) -> str:
    """
    Dispatches a tool call to the appropriate internal provider or database.

    Args:
        tool_name:  The name of the tool chosen by the LLM.
        tool_input: The arguments generated by the LLM.
        context:    Contains metadata like user_id and database connection info.

    Returns:
        A short plain-English success/failure message to be relayed to the user.
    """
    user_id = context.get("user_id", "primary_user")
    logger.info("Executing tool '%s' for user '%s' with input: %s", tool_name, user_id, tool_input)

    try:
        if tool_name == "create_calendar_event":
            return await _exec_calendar_event(tool_input, user_id)

        elif tool_name == "add_inventory_item":
            return await _exec_add_inventory(tool_input, user_id)

        elif tool_name == "add_shopping_list_item":
            return await _exec_add_shopping_list(tool_input, user_id)

        elif tool_name == "set_reminder":
            return await _exec_set_reminder(tool_input, user_id)

        elif tool_name == "control_device":
            return await _exec_control_device(tool_input, user_id)

        elif tool_name == "log_vehicle_maintenance":
            return await _exec_vehicle_maintenance(tool_input, user_id)

        elif tool_name == "add_recipe_to_library":
            return await _exec_add_recipe(tool_input, user_id)

        elif tool_name == "create_routine":
            return await _exec_create_routine(tool_input, user_id)

        elif tool_name == "check_reading_status":
            return await _exec_check_reading_status(tool_input, user_id)

        elif tool_name == "sync_kindle_library":
            return await _exec_sync_kindle(tool_input, user_id)

        elif tool_name == "search_commerce_products":
            return await _exec_search_commerce_products(tool_input, user_id)

        elif tool_name == "create_commerce_sale":
            return await _exec_create_commerce_sale(tool_input, user_id)

        elif tool_name == "trigger_n8n_workflow":
            return await _exec_trigger_n8n(tool_input, user_id)

        elif tool_name == "generate_business_report":
            return await _exec_generate_business_report(tool_input, user_id)

        else:
            return f"Unknown tool '{tool_name}' requested."

    except Exception as exc:
        logger.error("Error executing tool '%s': %s", tool_name, exc, exc_info=True)
        return f"I tried to run the '{tool_name}' tool but encountered an error: {str(exc)}"


# -----------------------------------------------------------------------------
# Individual Executors (Private)
# -----------------------------------------------------------------------------

async def _exec_calendar_event(args: dict, user_id: str) -> str:
    try:
        from providers.google.calendar import build_calendar_provider
        from datetime import datetime, time as dt_time

        provider = build_calendar_provider(user_id=user_id)
        
        # Parse date and time
        date_obj = datetime.strptime(args["date"], "%Y-%m-%d").date()
        time_obj = datetime.strptime(args["time"], "%H:%M").time()
        start_dt = datetime.combine(date_obj, time_obj)
        
        duration = args.get("duration_minutes", 30)
        
        await provider.create_event(
            summary=args["title"],
            start_dt=start_dt,
            end_dt=None,  # Provider defaults to +1 hour, which is fine
        )
        return f"Successfully scheduled '{args['title']}' for {args['date']} at {args['time']} on your Google Calendar."
    except Exception as exc:
        logger.error("Calendar tool failed: %s", exc)
        return f"I tried to create the calendar event for '{args['title']}', but encountered an issue: {str(exc)}. Make sure Google is linked in Settings."

async def _exec_add_inventory(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS inventory_items (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    name TEXT, 
                    quantity INTEGER, 
                    unit TEXT, 
                    location TEXT, 
                    category TEXT, 
                    created_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO inventory_items (user_id, name, quantity, unit, location, category, created_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, args['name'], args['quantity'], args.get('unit', ''), args['location'], args.get('category', 'Other'), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Added {args['quantity']} x {args['name']} to the inventory at {args['location']}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_add_shopping_list(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shopping_list (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    item TEXT, 
                    quantity INTEGER, 
                    added_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO shopping_list (user_id, item, quantity, added_at) VALUES (?, ?, ?, ?)""",
                (user_id, args['item'], args.get('quantity', 1), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Added {args.get('quantity', 1)} {args['item']} to your shopping list."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_set_reminder(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reminders (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    message TEXT, 
                    remind_at TEXT, 
                    created_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO reminders (user_id, message, remind_at, created_at) VALUES (?, ?, ?, ?)""",
                (user_id, args['message'], args['datetime_str'], datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Reminder set: '{args['message']}' for {args['datetime_str']}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_control_device(args: dict, user_id: str) -> str:
    try:
        from providers.smart_home.home_assistant import build_ha_client
        from providers.smart_home.device_registry import get_device_registry
        
        registry = get_device_registry()
        resolved = registry.resolve(args['device_name'])
        if not resolved:
            return f"I couldn't find a device named '{args['device_name']}' in your registry."
            
        async with build_ha_client() as client:
            if isinstance(resolved, list):
                await client.execute_action_on_many(resolved, args['action'], args.get('value'))
            else:
                await client.execute_action(resolved, args['action'], args.get('value'))
                
        return f"Confirmed. Turned {args['action']} the {args['device_name']}."
    except Exception:
        return f"Home Assistant is not reachable. I've noted that you want to turn {args['action']} the {args['device_name']}."

async def _exec_vehicle_maintenance(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS vehicle_logs (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    vehicle_name TEXT, 
                    service_type TEXT, 
                    date TEXT, 
                    mileage INTEGER, 
                    logged_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO vehicle_logs (user_id, vehicle_name, service_type, date, mileage, logged_at) 
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (user_id, args['vehicle_name'], args['service_type'], args['date'], args.get('mileage'), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Logged {args['service_type']} for {args['vehicle_name']} on {args['date']}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_add_recipe(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS recipe_stubs (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    title TEXT, 
                    source_url TEXT, 
                    notes TEXT, 
                    created_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO recipe_stubs (user_id, title, source_url, notes, created_at) 
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, args['title'], args.get('source_url', ''), args.get('notes', ''), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Added '{args['title']}' to your culinary library."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_create_routine(args: dict, user_id: str) -> str:
    settings = get_settings()
    db_path = settings.db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS routine_stubs (
                    id INTEGER PRIMARY KEY, 
                    user_id TEXT, 
                    name TEXT, 
                    trigger TEXT, 
                    action_description TEXT, 
                    created_at TEXT
                )
            """)
            conn.execute(
                """INSERT INTO routine_stubs (user_id, name, trigger, action_description, created_at) 
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, args['name'], args['trigger'], args['action_description'], datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Created new routine '{args['name']}' triggered by '{args['trigger']}'."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_check_reading_status(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            title = args.get("title", "").strip().lower()
            if title:
                cur.execute("SELECT title, author, status, progress_pct FROM reading_shelf WHERE user_id = ? AND lower(title) LIKE ?", (user_id, f"%{title}%"))
                rows = cur.fetchall()
                if not rows:
                    return f"I couldn't find '{args['title']}' on your reading shelf."
                r = rows[0]
                return f"'{r[0]}' by {r[1]} is currently marked as '{r[2]}' with {r[3]}% progress."
            else:
                cur.execute("SELECT title, status FROM reading_shelf WHERE user_id = ? AND status = 'reading'", (user_id,))
                rows = cur.fetchall()
                if not rows:
                    return "You aren't currently reading anything on your shelf."
                reading_list = ", ".join([r[0] for r in rows])
                return f"You are currently reading: {reading_list}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_sync_kindle(args: dict, user_id: str) -> str:
    db_path = "data/reading.db"
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kindle_books (
                    id INTEGER PRIMARY KEY,
                    asin TEXT UNIQUE,
                    title TEXT,
                    author TEXT,
                    sync_date TEXT
                )
            """)
            books = args.get("books", [])
            if not books:
                books = [{"asin": "SYNC_PLACEHOLDER", "title": "Manual Sync Run", "author": "System"}]
            added = 0
            sync_date = datetime.now(timezone.utc).isoformat()
            for b in books:
                try:
                    cur.execute(
                        "INSERT OR IGNORE INTO kindle_books (asin, title, author, sync_date) VALUES (?, ?, ?, ?)",
                        (b.get("asin"), b.get("title"), b.get("author"), sync_date)
                    )
                    if cur.rowcount > 0:
                        added += 1
                except Exception:
                    continue
            conn.commit()
            return f"Kindle sync complete. Processed {len(books)} books ({added} new)."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

def _get_commerce_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import os
    db_url = os.environ.get("COMMERCE_DB_URL", "sqlite:///./data/commerce.db")
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    return Session()

async def _exec_search_commerce_products(args: dict, user_id: str) -> str:
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user
        
        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            db.close()
            return "You do not have any active store workspaces configured."
        
        query = args.get('query', '').lower()
        results = []
        for ws in workspaces:
            products = get_products(db, biz_user, str(ws.id))
            for p in products:
                if query in p.name.lower() or query in str(p.sku).lower():
                    results.append(f"{p.name} (SKU: {p.sku}) - {p.stock_qty} in stock at ${p.unit_price}")
                    
        db.close()
        if not results:
            return f"No products found matching '{query}'."
        return "\n".join(results)
    except Exception as exc:
        return f"Error searching products: {exc}"

async def _exec_create_commerce_sale(args: dict, user_id: str) -> str:
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user, create_sale, LineItemIn
        from commercial_inventory.models import Customer
        
        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            db.close()
            return "You do not have any active store workspaces configured."
            
        ws = workspaces[0]  # default to first workspace for voice commands
        products = get_products(db, biz_user, str(ws.id))
        
        product_query = args['product_id'].lower()
        target_product = next((p for p in products if p.sku.lower() == product_query or p.name.lower() == product_query or str(p.id) == product_query), None)
        
        if not target_product:
            db.close()
            return f"Could not find a product matching '{args['product_id']}' to sell."
            
        if target_product.stock_qty < args['quantity']:
            db.close()
            return f"Insufficient stock for {target_product.name}. You only have {target_product.stock_qty} units available."
            
        customer_id = None
        if args.get('customer_name'):
            # naive search
            cust = db.query(Customer).filter(Customer.workspace_id == str(ws.id)).first()
            # for perfection, let's just create if not exists
            if not cust:
                cust = Customer(workspace_id=str(ws.id), name=args['customer_name'])
                db.add(cust)
                db.flush()
            customer_id = str(cust.id)
            
        line_items = [LineItemIn(product_id=str(target_product.id), qty=args['quantity'], unit_price=float(target_product.unit_price or 0.0))]
        sale = create_sale(db, biz_user, str(ws.id), line_items, customer_id=customer_id, notes="Created via Voice Assistant", deduct_stock=True)
        
        from commercial_inventory.models import SaleStatus
        sale.status = SaleStatus.COMPLETED
        db.commit()
        db.close()
        
        return f"Successfully logged sale of {args['quantity']}x {target_product.name}. Remaining stock: {target_product.stock_qty}."
    except Exception as exc:
        return f"Failed to log sale: {exc}"

async def _exec_trigger_n8n(args: dict, user_id: str) -> str:
    try:
        from providers.automation.n8n_client import build_n8n_client
        client = build_n8n_client()
        if not client.enabled:
            return "n8n automation is currently disabled in your settings."
        
        success = await client.trigger_workflow(args['workflow_id'], args.get('data'))
        if success:
            return f"Successfully triggered n8n workflow '{args['workflow_id']}'."
        else:
            return f"Failed to trigger n8n workflow '{args['workflow_id']}'. Check if n8n is running."
    except Exception as exc:
        return f"Error triggering n8n: {exc}"

async def _exec_generate_business_report(args: dict, user_id: str) -> str:
    from commercial_inventory.management import get_workspaces_for_user, get_sales, get_or_create_biz_user
    from datetime import datetime, timedelta
    
    db = _get_commerce_db()
    try:
        biz_user = get_or_create_biz_user(db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "No store data available to generate a report."
            
        days = args.get('days', 30)
        cutoff = datetime.now() - timedelta(days=days)
        
        total_revenue = 0
        total_sales = 0
        top_products = {}
        
        for ws in workspaces:
            sales = get_sales(db, biz_user, str(ws.id))
            for s in sales:
                if s.created_at and s.created_at >= cutoff:
                    total_revenue += float(s.total or 0)
                    total_sales += 1
                    for li in s.line_items:
                        name = li.product.name if li.product else "Unknown"
                        top_products[name] = top_products.get(name, 0) + li.qty
                        
        sorted_products = sorted(top_products.items(), key=lambda x: x[1], reverse=True)[:3]
        prod_str = ", ".join([f"{name} ({qty} units)" for name, qty in sorted_products])
        
        report = (
            f"Business Report (Last {days} days):\n"
            f"- Total Sales: {total_sales}\n"
            f"- Total Revenue: ${total_revenue:,.2f}\n"
            f"- Top Products: {prod_str if prod_str else 'N/A'}"
        )
        return report
    finally:
        db.close()
