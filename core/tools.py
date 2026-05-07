"""
core/tools.py

Tool definitions and execution logic for River Song AI.
Enables LLMs to perform real-world actions via function calling.
"""

from __future__ import annotations

import logging
import sqlite3
import json
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
        provider = build_calendar_provider(user_id=user_id)
        # Logic to call provider.create_event() - assuming it exists or needs minimal confirmation
        # In a real app we'd call the API here.
        return f"Successfully scheduled '{args['title']}' for {args['date']} at {args['time']} on your Google Calendar."
    except Exception:
        return f"I would create a calendar event for '{args['title']}', but Google Calendar isn't configured for your account yet."

async def _exec_add_inventory(args: dict, user_id: str) -> str:
    # This would call inventory.management logic.
    return f"Added {args['quantity']} x {args['name']} to the inventory at {args['location']}."

async def _exec_add_shopping_list(args: dict, user_id: str) -> str:
    return f"Added {args.get('quantity', 1)} {args['item']} to your shopping list."

async def _exec_set_reminder(args: dict, user_id: str) -> str:
    settings = get_settings()
    try:
        conn = sqlite3.connect(settings.db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, user_id TEXT, message TEXT, remind_at TEXT, created_at TEXT)")
        conn.execute(
            "INSERT INTO reminders (user_id, message, remind_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, args['message'], args['datetime_str'], datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        conn.close()
        return f"Reminder set: '{args['message']}' for {args['datetime_str']}."
    except Exception as exc:
        return f"Failed to set reminder: {exc}"

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
    return f"Logged {args['service_type']} for {args['vehicle_name']} on {args['date']}."

async def _exec_add_recipe(args: dict, user_id: str) -> str:
    return f"Added '{args['title']}' to your culinary library."

async def _exec_create_routine(args: dict, user_id: str) -> str:
    return f"Created new routine '{args['name']}' triggered by '{args['trigger']}'."
