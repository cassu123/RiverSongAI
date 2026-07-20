"""
core/tools.py

Tool definitions and execution logic for River Song AI.
Enables LLMs to perform real-world actions via function calling.
"""

from __future__ import annotations

import logging
import sqlite3
import os
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict

from config.settings import get_settings

logger = logging.getLogger(__name__)

# =============================================================================
# Tool Schemas (Anthropic / Ollama compatible format)
# =============================================================================

TOOL_SCHEMAS = [
    {
        "name": "deep_research",
        "description": "Perform an in-depth web research on a specific topic. Use this when the user explicitly asks for a deep dive, comprehensive research, or an in-depth report on a subject. Do NOT use for simple facts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The detailed topic or question to research."},
            },
            "required": ["query"]
        }
    },
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
                "cost": {"type": "number", "description": "Cost of the service."},
                "notes": {"type": "string", "description": "Any additional notes."}
            },
            "required": ["service_type"]
        }
    },
    {
        "name": "list_vehicles",
        "description": "List all vehicles in the family garage along with their current effective odometer.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "get_vehicle_status",
        "description": "Get the maintenance timeline status (next up, upcoming, overdue) for a specific vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_name": {"type": "string", "description": "Name or make/model of the vehicle."}
            },
            "required": ["vehicle_name"]
        }
    },
    {
        "name": "get_vehicle_spec",
        "description": "Look up checkpoint specs (torque, fluid, volume) for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_name": {"type": "string", "description": "Name of the vehicle."},
                "item": {"type": "string", "description": "What to look up (e.g., drain plug torque, engine oil)."}
            },
            "required": ["vehicle_name", "item"]
        }
    },
    {
        "name": "query_vehicle_manual",
        "description": "Ask a question about a vehicle by searching its uploaded owner's manual.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_name": {"type": "string", "description": "Name of the vehicle."},
                "question": {"type": "string", "description": "Question to answer from the manual."}
            },
            "required": ["vehicle_name", "question"]
        }
    },
    {
        "name": "record_odometer",
        "description": "Record a new odometer/mileage reading for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_name": {"type": "string", "description": "Name of the vehicle."},
                "value": {"type": "integer", "description": "Odometer reading."}
            },
            "required": ["vehicle_name", "value"]
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
                "trigger": {"type": "string", "description": "The condition that starts the routine (e.g. manual, scheduled time like '17:00')."},
                "action_description": {"type": "string", "description": "What happens when the routine runs."},
                "days": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of days to run (e.g. ['Mon', 'Wed']). Empty means every day."
                },
                "severity": {"type": "string", "description": "info, warning, or critical"}
            },
            "required": ["name", "trigger", "action_description"]
        }
    },
    {
        "name": "list_routines",
        "description": "List all configured routines for the user.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "update_routine",
        "description": "Update an existing routine.",
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string", "description": "The ID of the routine to update."},
                "name": {"type": "string"},
                "trigger": {"type": "string"},
                "action_description": {"type": "string"},
                "days": {"type": "array", "items": {"type": "string"}},
                "severity": {"type": "string"}
            },
            "required": ["routine_id"]
        }
    },
    {
        "name": "delete_routine",
        "description": "Delete a routine.",
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string"}
            },
            "required": ["routine_id"]
        }
    },
    {
        "name": "run_routine_now",
        "description": "Manually trigger a routine to run right now.",
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string"}
            },
            "required": ["routine_id"]
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
    },
    {
        "name": "web_search",
        "description": "Search the internet for real-time information or look something up.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search terms or question to look up."},
            },
            "required": ["query"]
        }
    },
    {
        "name": "search_emails",
        "description": "Read or search through your Gmail inbox for unread messages or specific topics.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query for emails (e.g., 'from:Amazon' or 'unread')."},
                "max_results": {"type": "integer", "description": "Number of emails to summarize. Defaults to 3."},
            }
        }
    },
    {
        "name": "get_weather",
        "description": "Get the current weather and forecast for a specific location or coordinates.",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name or 'current location'."},
                "units": {"type": "string", "enum": ["celsius", "fahrenheit"], "description": "Temperature units."},
            },
            "required": ["location"]
        }
    },
    {
        "name": "generate_image",
        "description": "Generate an AI image using Stable Diffusion based on a descriptive prompt.",
        "input_schema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "A detailed description of the image to generate."},
                "negative_prompt": {"type": "string", "description": "Things to exclude from the image (e.g., 'blurry', 'low quality')."},
            },
            "required": ["prompt"]
        }
    },
    {
        "name": "search_google_books",
        "description": "Search your Google Books library or the general Google Books catalog.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The title, author, or keyword to search for."},
                "library_only": {"type": "boolean", "description": "If true, only search your own library. Defaults to false."},
            },
            "required": ["query"]
        }
    },
    {
        "name": "add_google_task",
        "description": "Add a new task to your Google Tasks list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The name of the task."},
                "notes": {"type": "string", "description": "Optional additional details for the task."},
            },
            "required": ["title"]
        }
    },
    {
        "name": "list_google_tasks",
        "description": "Retrieve a list of tasks from your Google Tasks.",
        "input_schema": {
            "type": "object",
            "properties": {
                "show_completed": {"type": "boolean", "description": "Whether to include completed tasks. Defaults to false."},
            }
        }
    },
    {
        "name": "save_vault_note",
        "description": "Save a markdown note to the CHRONOS memory vault. Use for voice-to-note, capturing ideas, facts, recipes, anything the user wants to remember long-term. Creates the note if it doesn't exist, overwrites if it does.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The note title (filename without .md extension)."},
                "content": {"type": "string", "description": "Full markdown content to save."},
                "root": {"type": "string", "enum": ["personal", "household"], "description": "Which vault section to save to. Defaults to personal."}
            },
            "required": ["title", "content"]
        }
    },
    {
        "name": "read_vault_note",
        "description": "Read the contents of a note from the CHRONOS memory vault by its title.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The note title (filename without .md extension)."},
                "root": {"type": "string", "enum": ["personal", "household"], "description": "Which vault section to read from. Defaults to personal."}
            },
            "required": ["title"]
        }
    },
    {
        "name": "search_vault",
        "description": "Search the CHRONOS memory vault for notes matching a query. Searches both note titles and full content.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The text to search for across all vault notes."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "code_interpreter",
        "description": "Execute Python code locally to move files, process data, or perform system tasks. Requires manual confirmation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "The Python code to execute."}
            },
            "required": ["code"]
        }
    },
    {
        "name": "mow_command",
        "description": (
            "Send a command to the autonomous mower (Vector/Voyager). "
            "Use this when the user wants to start mowing, stop mowing, send the mower home, "
            "or trigger an emergency stop. "
            "Commands: mow_start — begin autonomous mowing session; "
            "mow_stop — stop the current session; "
            "return_home — navigate back to the dock; "
            "estop — immediate emergency stop; "
            "estop_reset — clear E-stop state after operator inspection."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "enum": ["mow_start", "mow_stop", "return_home", "estop", "estop_reset"],
                    "description": "The command to send to the mower."
                },
                "unit_id": {
                    "type": "string",
                    "description": "Unit ID of the mower. Omit to target the first registered unit."
                }
            },
            "required": ["command"]
        }
    }
]

# Q3#13 — Append Playwright browser tools when the flag is enabled at startup.
# The provider also short-circuits on every call when the flag is off, so even
# a hot-toggle leaves the system in a safe state.
try:
    from config.settings import get_settings as _gs_pw
    if getattr(_gs_pw(), "playwright_browser_enabled", False):
        from providers.web.playwright_browser import PLAYWRIGHT_TOOL_SCHEMAS
        TOOL_SCHEMAS.extend(PLAYWRIGHT_TOOL_SCHEMAS)
except Exception:
    # Settings unavailable at module import time → leave tools unexposed.
    pass

# =============================================================================
# Tool Executor
# =============================================================================


async def execute_tool(
        tool_name: str, tool_input: Dict[str, Any], context: Dict[str, Any]) -> str:
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
    logger.info(
        "Executing tool '%s' for user '%s' with input: %s",
        tool_name,
        user_id,
        tool_input)

    try:
        if tool_name == "deep_research":
            return await _exec_deep_research(tool_input, user_id)

        elif tool_name == "create_calendar_event":
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
            # type: ignore
            return await _exec_vehicle_maintenance(tool_input, context)  # type: ignore

        elif tool_name == "list_vehicles":
            return await _exec_list_vehicles(tool_input, context)
            
        elif tool_name == "get_vehicle_status":
            return await _exec_get_vehicle_status(tool_input, context)
            
        elif tool_name == "get_vehicle_spec":
            return await _exec_get_vehicle_spec(tool_input, context)
            
        elif tool_name == "query_vehicle_manual":
            return await _exec_query_vehicle_manual(tool_input, context)
            
        elif tool_name == "record_odometer":
            return await _exec_record_odometer(tool_input, context)

        elif tool_name == "add_recipe_to_library":
            return await _exec_add_recipe(tool_input, user_id)

        elif tool_name == "create_routine":
            return await _exec_create_routine(tool_input, user_id)
        elif tool_name == "list_routines":
            return await _exec_list_routines(user_id)
        elif tool_name == "update_routine":
            return await _exec_update_routine(tool_input, user_id)
        elif tool_name == "delete_routine":
            return await _exec_delete_routine(tool_input, user_id)
        elif tool_name == "run_routine_now":
            return await _exec_run_routine_now(tool_input, user_id)

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

        elif tool_name == "web_search":
            return await _exec_web_search(tool_input, user_id)

        elif tool_name == "search_emails":
            return await _exec_search_emails(tool_input, user_id)

        elif tool_name == "get_weather":
            return await _exec_get_weather(tool_input, user_id)

        elif tool_name == "generate_image":
            return await _exec_generate_image(tool_input, user_id)

        elif tool_name == "search_google_books":
            return await _exec_search_google_books(tool_input, user_id)

        elif tool_name == "add_google_task":
            return await _exec_add_google_task(tool_input, user_id)

        elif tool_name == "list_google_tasks":
            return await _exec_list_google_tasks(tool_input, user_id)

        elif tool_name == "save_vault_note":
            return await _exec_save_vault_note(tool_input, user_id)

        elif tool_name == "read_vault_note":
            return await _exec_read_vault_note(tool_input, user_id)

        elif tool_name == "search_vault":
            return await _exec_search_vault(tool_input, user_id)

        elif tool_name == "code_interpreter":
            return await _exec_code_interpreter(tool_input, user_id)

        elif tool_name in ("browser_navigate", "browser_extract_text",
                           "browser_click", "browser_screenshot",
                           "browser_vision_on_page"):
            # Q3#13 — Playwright browser tools. Flag-gated; the provider
            # short-circuits when disabled.
            from providers.web.playwright_browser import PLAYWRIGHT_TOOL_DISPATCH
            fn = PLAYWRIGHT_TOOL_DISPATCH.get(tool_name)
            if fn is None:
                return f"Unknown browser tool: {tool_name}"
            return await fn(tool_input or {})

        elif tool_name == "mow_command":
            return await _exec_mow_command(tool_input, user_id)

        else:
            return f"Unknown tool '{tool_name}' requested."

    except Exception as exc:
        logger.error(
            "Unexpected error executing tool '%s': %s",
            tool_name,
            exc)
        return f"Tool execution failed due to an internal error: {exc}"


async def _exec_deep_research(args: dict, user_id: str) -> str:
    try:
        query = args.get("query", "").strip()
        if not query:
            return "Please provide a query for deep research."
            
        from core.deep_research import decompose_query, run_deep_research
        from config.settings import get_settings
        
        if not getattr(get_settings(), "deep_research_enabled", False):
            return "Deep Research is disabled in settings."
            
        # Try to estimate complexity
        sub_queries = await decompose_query(query, count=2)
        count = len(sub_queries)
        
        # Quick: run inside the turn. Big: enqueue background job.
        
        def _get_store():
            try:
                from main import get_app
                app = get_app()
                if app:
                    return app.state.memory_manager._store
            except Exception:
                pass
            return None
            
        store = _get_store()
        if not store:
            return "Cannot run research without document store."
            
        if count <= 2:
            # Inline execution
            try:
                result = await run_deep_research(query, user_id=user_id, store=store)
                report = result.get("report", "")
                doc_id = result.get("document_id")
                return f"I've completed the deep research. The report is saved to your Documents (ID: {doc_id}).\n\n{report}"
            except Exception as e:
                logger.error(f"Inline deep research failed: {e}")
                return f"Deep research encountered an error: {e}"

        # Big: background execution
        import asyncio
        
        async def background_research():
            try:
                result = await run_deep_research(query, user_id=user_id, store=store)
                logger.info(f"Background research complete for '{query}': doc_id={result.get('document_id')}")
                
                # Append to the session
                session_id = args.get("session_id") or context.get("session_id")
                if session_id:
                    report = result.get("report", "Research complete.")
                    doc_id = result.get("document_id")
                    
                    content = f"I've finished the deep research on '{query}'.\n\n"
                    if doc_id:
                        content += f"I've saved the full report to your Documents.\n\n"
                    content += report
                        
                    await store.save_chat_message(
                        user_id=user_id,
                        session_id=session_id,
                        role="assistant",
                        content=content
                    )
                    
                    # Try to push via FCM
                    try:
                        from providers.notifier.fcm_notifier import FCMNotifier
                        await FCMNotifier(store).send_notification(
                            user_id=user_id,
                            title="Research Complete",
                            body=f"Your deep research on '{query}' is ready.",
                            data={"session_id": session_id, "doc_id": doc_id or ""}
                        )
                    except Exception as e:
                        logger.debug("Failed to push FCM notification for research: %s", e)
                        
            except Exception as e:
                logger.error(f"Background research failed: {e}")
                
        asyncio.create_task(background_research())
        return f"I'm starting a deep dive on '{query}'. I'll let you know when the report is ready. It will be saved to your documents."
        
    except Exception as exc:
        logger.error("deep_research failed: %s", exc)
        return f"Deep research failed: {exc}"


# -----------------------------------------------------------------------------
# Individual Executors (Private)
# -----------------------------------------------------------------------------

async def _exec_calendar_event(args: dict, user_id: str) -> str:
    try:
        from providers.google.calendar import build_calendar_provider
        from datetime import datetime

        provider = build_calendar_provider(user_id=user_id)

        # Parse date and time
        date_obj = datetime.strptime(args["date"], "%Y-%m-%d").date()
        time_obj = datetime.strptime(args["time"], "%H:%M").time()
        start_dt = datetime.combine(date_obj, time_obj)

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
    def _sync_work():
        from api.routes.inventory import get_db as get_inventory_db
        from inventory.management import create_item, get_or_create_inv_user, get_homes_for_user, create_home, ItemCategory
        from core.family import resolve_module_owner
        
        db = next(get_inventory_db())
        try:
            eff_user = resolve_module_owner(user_id, "inventory")
            inv_user = get_or_create_inv_user(db, eff_user, f"{eff_user}@local", eff_user)
            homes = get_homes_for_user(db, str(inv_user.id))
            if not homes:
                home = create_home(db, str(inv_user.id), "Primary Residence", "")
            else:
                home = homes[0]
            
            cat_str = args.get('category', 'Other').upper()
            try:
                cat = ItemCategory(cat_str)
            except ValueError:
                cat = ItemCategory.OTHER
                
            item = create_item(db, str(inv_user.id), str(home.id), {
                "name": args['name'],
                "quantity": args.get('quantity', 1),
                "location": args.get('location'),
                "category": cat
            })
            return f"Added {item.quantity} x {item.name} to the inventory at {item.location}."
        finally:
            db.close()
            
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
                (user_id, args['item'], args.get('quantity', 1),
                 datetime.now(timezone.utc).isoformat())
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
                (user_id, args['message'], args['datetime_str'],
                 datetime.now(timezone.utc).isoformat())
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


async def _exec_vehicle_maintenance(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    vehicle_id = context.get("vehicle_id")

    if not vehicle_id:
        return {"error": "No vehicle_id in context. Cannot log maintenance."}

    def _sync_work():
        from vehicles.management import get_vehicles, create_service_log
        import difflib
        from datetime import datetime, timezone

        db = context.get("db")
        if not db:
            from sqlalchemy import create_engine
            from sqlalchemy.orm import sessionmaker
            engine = create_engine(
                os.environ.get(
                    "VEHICLES_DB_URL",
                    "sqlite:///./data/vehicles.db"))
            db = sessionmaker(bind=engine)()
            close_db = True
        else:
            close_db = False

            # If vehicle_id is missing, try to resolve from args
            if not vehicle_id:
                vehicle_name = args.get('vehicle_name')
                if not vehicle_name:
                    return {"error": "Must specify a vehicle_name if not already in context."}
                
                v = _resolve_vehicle_sync(db, user_id, vehicle_name)
                if not v:
                    return {"error": f"Could not find a vehicle matching '{vehicle_name}'."}
                vehicle_id = str(v.id)
            else:
                vehicles = get_vehicles(db, user_id)  # type: ignore
                v = next((v for v in vehicles if str(v.id) == vehicle_id), None)
                if not v:
                    return {"error": "Vehicle not found."}

            service_type = args.get('service_type', '')
            date_str = args.get('date', datetime.now(timezone.utc).date().isoformat())
            mileage = args.get('mileage')
            cost = args.get('cost')
            notes = args.get('notes', '')

            try:
                service_date = datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                service_date = datetime.now(timezone.utc)

            # Fuzzy match the checkpoint
            checkpoints = {cp.description: cp for cp in v.check_points}
            descriptions = list(checkpoints.keys())

            matches = difflib.get_close_matches(service_type, descriptions, n=1, cutoff=0.6)
            matched_cp = None
            if matches:
                matched_cp = checkpoints[matches[0]]

            check_results = []
            if matched_cp:
                check_results.append({
                    "description": matched_cp.description,
                    "check_point_id": str(matched_cp.id),
                    "status": "pass",
                    "passed": True
                })
                # Update checkpoint explicitly
                if mileage is not None:
                    matched_cp.last_service_odometer = mileage
                matched_cp.last_service_date = service_date
                db.commit()

            log = create_service_log(
                db, user_id, vehicle_id,  # type: ignore
                service_date=service_date,
                odometer=mileage,
                service_type=service_type,
                cost=cost,
                notes=notes,
                check_results=check_results
            )
            
            # Record usage reading if mileage provided
            if mileage is not None:
                from vehicles.models import UsageReading, UsageUnit, UsageSource
                ur = UsageReading(
                    vehicle_id=v.id,
                    value=mileage,
                    unit=UsageUnit.MILES,
                    source=UsageSource.SERVICE_LOG,
                    recorded_at=service_date
                )
                db.add(ur)
                db.commit()

            result = {
                "success": True,
                "message": f"Logged '{matched_cp.description if matched_cp else service_type}' at {mileage} miles.",
                "matched_checkpoint": matched_cp.description if matched_cp else None,
                "log_id": str(log.id)
            }
            return result
        finally:
            if close_db:
                db.close()

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


def _resolve_vehicle_sync(db, user_id, query):
    import difflib
    from api.routes.vehicles import get_vehicles
    vehicles = get_vehicles(db, user_id)
    if not vehicles:
        return None
    
    # Try exact nickname
    for v in vehicles:
        if v.nickname and v.nickname.lower() == query.lower():
            return v
    
    names = {}
    for v in vehicles:
        n1 = v.nickname or ""
        n2 = f"{v.year} {v.make} {v.model}"
        names[n1.lower()] = v
        names[n2.lower()] = v
    
    matches = difflib.get_close_matches(query.lower(), list(names.keys()), n=1, cutoff=0.4)
    if matches:
        return names[matches[0]]
    return vehicles[0] # fallback


def _get_db_for_tools(context):
    db = context.get("db")
    if not db:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(os.environ.get("VEHICLES_DB_URL", "sqlite:///./data/vehicles.db"))
        return sessionmaker(bind=engine)(), True
    return db, False


async def _exec_list_vehicles(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    def _sync():
        db, close = _get_db_for_tools(context)
        try:
            from api.routes.vehicles import get_vehicles, get_maintenance_timeline
            vehicles = get_vehicles(db, user_id)
            res = []
            for v in vehicles:
                try:
                    tl = get_maintenance_timeline(str(v.id), None, None, db, user_id)
                except Exception:
                    tl = {}
                res.append({
                    "id": str(v.id),
                    "name": v.nickname or f"{v.year} {v.make} {v.model}",
                    "effective_odometer": tl.get("eff_odometer")
                })
            return {"vehicles": res}
        finally:
            if close: db.close()
    return await asyncio.get_running_loop().run_in_executor(None, _sync)


async def _exec_get_vehicle_status(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    v_id = context.get("vehicle_id")
    v_name = args.get("vehicle_name")
    
    def _sync():
        db, close = _get_db_for_tools(context)
        try:
            from api.routes.vehicles import get_maintenance_timeline
            vehicle_id = v_id
            if not vehicle_id and v_name:
                v = _resolve_vehicle_sync(db, user_id, v_name)
                if not v: return {"error": "Vehicle not found."}
                vehicle_id = str(v.id)
            
            if not vehicle_id:
                return {"error": "Could not determine vehicle."}
                
            tl = get_maintenance_timeline(vehicle_id, None, None, db, user_id)
            return tl
        finally:
            if close: db.close()
    return await asyncio.get_running_loop().run_in_executor(None, _sync)


async def _exec_get_vehicle_spec(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    v_id = context.get("vehicle_id")
    v_name = args.get("vehicle_name")
    item = args.get("item", "")
    
    def _sync():
        import difflib
        db, close = _get_db_for_tools(context)
        try:
            vehicle_id = v_id
            if not vehicle_id and v_name:
                v = _resolve_vehicle_sync(db, user_id, v_name)
                if not v: return {"error": "Vehicle not found."}
                vehicle_id = str(v.id)
            else:
                from api.routes.vehicles import get_vehicles
                v = next((x for x in get_vehicles(db, user_id) if str(x.id) == vehicle_id), None)
                
            if not v:
                return {"error": "Could not determine vehicle."}
                
            cps = {cp.description: cp for cp in v.check_points}
            matches = difflib.get_close_matches(item, list(cps.keys()), n=1, cutoff=0.3)
            if matches:
                cp = cps[matches[0]]
                return {
                    "checkpoint": cp.description,
                    "expected_spec": cp.expected_spec,
                    "volume": cp.volume,
                    "unit": cp.unit,
                    "torque": f"{cp.ft_lb} ft-lb" if cp.ft_lb else None
                }
            return {"error": "Spec not found."}
        finally:
            if close: db.close()
    return await asyncio.get_running_loop().run_in_executor(None, _sync)


async def _exec_query_vehicle_manual(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    v_id = context.get("vehicle_id")
    v_name = args.get("vehicle_name")
    question = args.get("question", "")
    
    # We must run this async as it uses memory_manager / llm
    db, close = _get_db_for_tools(context)
    try:
        vehicle_id = v_id
        if not vehicle_id and v_name:
            v = await asyncio.get_running_loop().run_in_executor(None, _resolve_vehicle_sync, db, user_id, v_name)
            if not v: return {"error": "Vehicle not found."}
            vehicle_id = str(v.id)
        
        if not vehicle_id:
            return {"error": "Could not determine vehicle."}
    finally:
        if close: db.close()
        
    # Use RAG with metadata filter
    from core.memory_manager import MemoryManager
    try:
        from main import get_app
        app = get_app()
        if app:
            memory_manager = app.state.memory_manager
        else:
            return {"error": "App not ready."}
    except Exception:
        return {"error": "App not ready."}
        
    results = await memory_manager.search_rag(user_id, question, n_results=5)
    # Filter strictly to vehicle_id if possible, or just return the text
    filtered = []
    for r in results:
        meta = r.get("metadata", {})
        if meta.get("vehicle_id") == vehicle_id or meta.get("doc_type") == "vehicle_manual":
            filtered.append(r["text"])
            
    if not filtered:
        return {"answer": "No relevant manual pages found."}
        
    context_str = "\n".join(filtered)
    # Summarize with LLM
    from core.llm_service import _generate_text
    prompt = f"Answer the following question about a vehicle based on the provided manual excerpts.\n\nQuestion: {question}\n\nExcerpts:\n{context_str}"
    ans = await _generate_text([{"role": "user", "content": prompt}], user_id)
    return {"answer": ans}


async def _exec_record_odometer(args: dict, context: dict) -> dict:
    user_id = context.get("user_id")
    v_id = context.get("vehicle_id")
    v_name = args.get("vehicle_name")
    val = args.get("value")
    
    if not val:
        return {"error": "Value required."}
        
    def _sync():
        db, close = _get_db_for_tools(context)
        try:
            vehicle_id = v_id
            if not vehicle_id and v_name:
                v = _resolve_vehicle_sync(db, user_id, v_name)
                if not v: return {"error": "Vehicle not found."}
                vehicle_id = str(v.id)
            else:
                from api.routes.vehicles import get_vehicles
                v = next((x for x in get_vehicles(db, user_id) if str(x.id) == vehicle_id), None)
                
            if not v:
                return {"error": "Could not determine vehicle."}
                
            from vehicles.models import UsageReading, UsageUnit, UsageSource
            from datetime import datetime, timezone
            ur = UsageReading(
                vehicle_id=v.id,
                value=val,
                unit=UsageUnit.MILES,
                source=UsageSource.MANUAL,
                recorded_at=datetime.now(timezone.utc)
            )
            db.add(ur)
            db.commit()
            return {"success": True, "message": f"Recorded {val} miles for {v.nickname or v.model}."}
        finally:
            if close: db.close()
    return await asyncio.get_running_loop().run_in_executor(None, _sync)




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
                (user_id, args['title'], args.get('source_url', ''), args.get(
                    'notes', ''), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
            return f"Added '{args['title']}' to your culinary library."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


async def _exec_create_routine(args: dict, user_id: str) -> str:
    import uuid
    import json
    settings = get_settings()
    db_path = settings.db_path
    
    name = args.get("name", "Untitled Routine")
    trigger = args.get("trigger", "manual")
    prompt = args.get("action_description", "")
    days = args.get("days", [])
    severity = args.get("severity", "info")
    
    # Try to parse trigger as time if it looks like HH:MM
    time_val = None
    if ":" in trigger and any(c.isdigit() for c in trigger):
        time_val = trigger.strip()
        trigger = "schedule"
        
    rid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO routines
                    (id, user_id, name, trigger, time, days, prompt, type, severity, enabled, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (rid, user_id, name, trigger, time_val, json.dumps(days), prompt, "simple", severity, 1, now, now)
            )
            conn.commit()
            return f"Created routine '{name}' with ID {rid}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


async def _exec_list_routines(user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute("SELECT id, name, trigger, time, days, prompt, severity, enabled FROM routines WHERE user_id = ?", (user_id,)).fetchall()
            if not rows:
                return "You have no routines configured."
            lines = ["Here are your routines:"]
            import json
            for r in rows:
                days = json.loads(r[4])
                days_str = "every day" if not days else ", ".join(days)
                t = r[3] if r[3] else r[2]
                en = "" if r[7] else " (disabled)"
                lines.append(f"- {r[1]} (ID: {r[0]}){en}: runs at {t} on {days_str}. Action: {r[5]}")
            return "\n".join(lines)
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_update_routine(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            if not rid:
                return "routine_id is required."
            
            allowed = {"name", "trigger", "action_description", "days", "severity"}
            set_parts, vals = [], []
            import json
            for k, v in args.items():
                if k not in allowed: continue
                db_k = k
                if k == "action_description": db_k = "prompt"
                
                if k == "days":
                    v = json.dumps(v)
                elif k == "trigger":
                    if ":" in v and any(c.isdigit() for c in v):
                        set_parts.append("time = ?")
                        vals.append(v.strip())
                        v = "schedule"
                
                set_parts.append(f"{db_k} = ?")
                vals.append(v)
            
            if not set_parts:
                return "No fields to update."
            
            set_parts.append("updated_at = ?")
            vals.append(datetime.now(timezone.utc).isoformat())
            
            vals.extend([rid, user_id])
            
            conn.execute(f"UPDATE routines SET {', '.join(set_parts)} WHERE id = ? AND user_id = ?", vals)
            conn.commit()
            return f"Routine {rid} updated."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_delete_routine(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            conn.execute("DELETE FROM routines WHERE id = ? AND user_id = ?", (rid, user_id))
            conn.commit()
            return f"Routine {rid} deleted."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)

async def _exec_run_routine_now(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path
    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            rid = args.get("routine_id")
            row = conn.execute("SELECT name, prompt, type, severity FROM routines WHERE id = ? AND user_id = ?", (rid, user_id)).fetchone()
            if not row:
                return "Routine not found."
            return (row[0], row[1], row[2], row[3])
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, _sync_work)
    if isinstance(res, str):
        return res
    name, prompt, r_type, severity = res
    if r_type != "simple":
        return f"Only 'simple' routines can be manually triggered with this tool. This is type {r_type}."
    
    # Actually run it
    from core.routines_scheduler import _run_simple_routine
    # Need to trigger it via background task so it doesn't block
    asyncio.create_task(_run_simple_routine(user_id, rid, name, prompt, severity))
    return f"Triggered routine '{name}' in the background."

async def _exec_check_reading_status(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path

    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            title = args.get("title", "").strip().lower()
            if title:
                cur.execute(
                    "SELECT title, author, status, progress_pct FROM reading_shelf WHERE user_id = ? AND lower(title) LIKE ?",
                    (user_id,
                     f"%{title}%"))
                rows = cur.fetchall()
                if not rows:
                    return f"I couldn't find '{args['title']}' on your reading shelf."
                r = rows[0]
                return f"'{r[0]}' by {r[1]} is currently marked as '{r[2]}' with {r[3]}% progress."
            else:
                cur.execute(
                    "SELECT title, status FROM reading_shelf WHERE user_id = ? AND status = 'reading'",
                    (user_id,
                     ))
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
                books = [{"asin": "SYNC_PLACEHOLDER",
                          "title": "Manual Sync Run", "author": "System"}]
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
    db = None
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user

        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(
            db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "You do not have any active store workspaces configured."

        query = args.get('query', '').lower()
        results = []
        for ws in workspaces:
            products = get_products(db, biz_user, str(ws.id))
            for p in products:
                if query in p.name.lower() or query in str(p.sku).lower():
                    results.append(
                        f"{p.name} (SKU: {p.sku}) - {p.stock_qty} in stock at ${p.unit_price}")

        if not results:
            return f"No products found matching '{query}'."
        return "\n".join(results)
    except Exception as exc:
        return f"Error searching products: {exc}"
    finally:
        if db is not None:
            db.close()


async def _exec_create_commerce_sale(args: dict, user_id: str) -> str:
    db = None
    try:
        from commercial_inventory.management import get_workspaces_for_user, get_products, get_or_create_biz_user, create_sale, LineItemIn
        from commercial_inventory.models import Customer

        db = _get_commerce_db()
        biz_user = get_or_create_biz_user(
            db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "You do not have any active store workspaces configured."

        ws = workspaces[0]  # default to first workspace for voice commands
        products = get_products(db, biz_user, str(ws.id))

        product_query = args['product_id'].lower()
        target_product = next((p for p in products if p.sku.lower(
        ) == product_query or p.name.lower() == product_query or str(p.id) == product_query), None)

        if not target_product:
            return f"Could not find a product matching '{args['product_id']}' to sell."

        if target_product.stock_qty < args['quantity']:
            return f"Insufficient stock for {target_product.name}. You only have {target_product.stock_qty} units available."

        customer_id = None
        if args.get('customer_name'):
            # naive search
            cust = db.query(Customer).filter(
                Customer.workspace_id == str(ws.id)).first()
            # for perfection, let's just create if not exists
            if not cust:
                cust = Customer(
                    workspace_id=str(
                        ws.id),
                    name=args['customer_name'])
                db.add(cust)
                db.flush()
            customer_id = str(cust.id)

        line_items = [
            LineItemIn(
                product_id=str(
                    target_product.id), qty=args['quantity'], unit_price=float(
                    target_product.unit_price or 0.0))]
        sale = create_sale(db,
                           biz_user,
                           str(ws.id),
                           line_items,
                           customer_id=customer_id,
                           notes="Created via Voice Assistant",
                           deduct_stock=True)

        from commercial_inventory.models import SaleStatus
        sale.status = SaleStatus.COMPLETED
        db.commit()

        return f"Successfully logged sale of {args['quantity']}x {target_product.name}. Remaining stock: {target_product.stock_qty}."
    except Exception as exc:
        return f"Failed to log sale: {exc}"
    finally:
        if db is not None:
            db.close()


async def _exec_trigger_n8n(args: dict, user_id: str) -> str:
    try:
        from providers.automation.n8n_client import build_n8n_client
        client = build_n8n_client()
        if not client.enabled:
            return "n8n automation is currently disabled in your settings."

        # type: ignore
        success = await client.trigger_workflow(args['workflow_id'], args.get('data'))  # type: ignore
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
        biz_user = get_or_create_biz_user(
            db, external_user_id=user_id, email=user_id)
        workspaces = get_workspaces_for_user(db, biz_user)
        if not workspaces:
            return "No store data available to generate a report."

        days = args.get('days', 30)
        cutoff = datetime.now() - timedelta(days=days)

        total_revenue = 0.0
        total_sales = 0
        top_products = {}  # type: ignore

        for ws in workspaces:
            sales = get_sales(db, biz_user, str(ws.id))
            for s in sales:
                if s.created_at and s.created_at >= cutoff:
                    total_revenue += float(s.total or 0)
                    total_sales += 1
                    for li in s.line_items:
                        name = li.product.name if li.product else "Unknown"
                        top_products[name] = top_products.get(name, 0) + li.qty

        sorted_products = sorted(
            top_products.items(),
            key=lambda x: x[1],
            reverse=True)[
            :3]
        prod_str = ", ".join(
            [f"{name} ({qty} units)" for name, qty in sorted_products])

        report = (
            f"Business Report (Last {days} days):\n"
            f"- Total Sales: {total_sales}\n"
            f"- Total Revenue: ${total_revenue:,.2f}\n"
            f"- Top Products: {prod_str if prod_str else 'N/A'}"
        )
        return report
    finally:
        db.close()


async def _exec_web_search(args: dict, user_id: str) -> str:
    try:
        from providers.web.search import build_search_provider
        provider = build_search_provider()
        return await provider.search(args["query"])
    except Exception as exc:
        logger.error("Web search tool failed: %s", exc)
        return f"I tried to search the web for '{args['query']}', but encountered an issue: {str(exc)}"


async def _exec_search_emails(args: dict, user_id: str) -> str:
    try:
        from providers.google.gmail import build_gmail_provider
        provider = build_gmail_provider(user_id=user_id)

        query = args.get("query", "is:unread")
        max_results = args.get("max_results", 3)

        emails = await provider.search_messages(query, max_results=max_results)
        if not emails:
            return f"I searched your Gmail for '{query}' but didn't find any matching messages."

        summaries = []
        for i, em in enumerate(emails):
            snippet = em.get("snippet", "No snippet.")
            subject = em.get("subject", "No subject")
            sender = em.get("from", "Unknown sender")
            summaries.append(
                f"{i + 1}. From: {sender}\n   Subject: {subject}\n   Snippet: {snippet}")

        header = f"Found {len(summaries)} emails for '{query}':"
        return header + "\n\n" + "\n\n".join(summaries)

    except Exception as exc:
        logger.error("Gmail tool failed: %s", exc)
        return f"I tried to read your emails, but encountered an issue: {str(exc)}. Make sure Google is linked in Settings."


async def _exec_get_weather(args: dict, user_id: str) -> str:
    try:
        from providers.google.maps import build_maps_provider
        from providers.feeds.weather import get_weather_report

        location = args["location"]
        units = args.get("units", "celsius")

        # 1. Geocode location name to lat/lon
        maps = build_maps_provider()
        geo = await maps.geocode(location)
        if not geo:
            return f"I couldn't find a place called '{location}'."

        lat = geo["geometry"]["location"]["lat"]
        lon = geo["geometry"]["location"]["lng"]
        addr = geo.get("formatted_address", location)

        # 2. Fetch weather
        report = await get_weather_report(lat, lon, units)

        return f"Weather for {addr}:\n{report}"

    except Exception as exc:
        logger.error("Weather tool failed: %s", exc)
        return f"I tried to check the weather for '{args['location']}', but encountered an issue: {str(exc)}"


async def _exec_generate_image(args: dict, user_id: str) -> str:
    """Generate an image via SDProvider and return base64 data."""
    try:
        from providers.image.sd_provider import SDProvider
        import base64

        provider = SDProvider()
        img_bytes = await provider.generate(
            prompt=args["prompt"],
            negative_prompt=args.get(
                "negative_prompt",
                "low quality, blurry, distorted"),
        )

        b64 = base64.b64encode(img_bytes).decode("utf-8")
        # Prefix so the frontend can easily identify it
        return f"IMAGE_GEN_SUCCESS:data:image/png;base64,{b64}"

    except Exception as exc:
        logger.error("Image generation tool failed: %s", exc)
        return f"I tried to generate the image, but encountered an issue: {str(exc)}"


async def _exec_search_google_books(args: dict, user_id: str) -> str:
    try:
        from providers.google.books import get_books_provider
        provider = get_books_provider()

        query = args["query"]
        if not provider.is_connected(user_id):
            return "Your Google Books account is not linked. Please connect it in Settings."

        library = await provider.get_library(user_id)
        # Search in library
        matches = [
            b for b in library if query.lower() in b.title.lower() or any(
                query.lower() in a.lower() for a in b.authors)]

        if not matches:
            return f"I couldn't find any books matching '{query}' in your library."

        lines = [f"Found {len(matches)} book(s) in your library:"]
        for b in matches[:5]:
            authors = ", ".join(b.authors)
            lines.append(
                f"- {b.title} by {authors} ({int(b.progress_pct)}% read, status: {b.status})")

        return "\n".join(lines)
    except Exception as exc:
        logger.error("Google Books tool failed: %s", exc)
        return f"I tried to search your Google Books, but encountered an error: {str(exc)}"


async def _exec_add_google_task(args: dict, user_id: str) -> str:
    try:
        from providers.google.tasks import build_tasks_provider
        provider = build_tasks_provider(user_id)

        title = args["title"]
        notes = args.get("notes")

        await provider.create_task(title=title, notes=notes)
        return f"Successfully added task: '{title}' to your Google Tasks."
    except Exception as exc:
        logger.error("Google Tasks add failed: %s", exc)
        return f"I tried to add the task '{args['title']}' to Google Tasks, but encountered an error: {str(exc)}"


async def _exec_list_google_tasks(args: dict, user_id: str) -> str:
    try:
        from providers.google.tasks import build_tasks_provider
        provider = build_tasks_provider(user_id)

        show_completed = args.get("show_completed", False)
        tasks = await provider.get_tasks(show_completed=show_completed)

        if not tasks:
            return "You don't have any tasks in your main Google Tasks list."

        lines = ["Your Google Tasks:"]
        for t in tasks[:10]:
            status = "✓" if t.get("status") == "completed" else "○"
            lines.append(f"{status} {t['title']}")

        return "\n".join(lines)
    except Exception as exc:
        logger.error("Google Tasks list failed: %s", exc)
        return f"I tried to retrieve your Google Tasks, but encountered an error: {str(exc)}"


async def get_upcoming_events(
        user_id: str, hours_ahead: int = 8) -> list[dict]:
    """
    Standalone helper to fetch calendar events for the near future.
    Used by the startup briefing feature.
    """
    try:
        from providers.google.calendar import build_calendar_provider
        from datetime import datetime, timedelta, timezone

        provider = build_calendar_provider(user_id=user_id)

        # We query 1 day to be safe, then filter in memory
        events = await provider.get_upcoming_events(days_ahead=1, max_results=10)

        if not events:
            return []

        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(hours=hours_ahead)

        results = []
        for e in events:
            start_raw = e.get("start", {})
            dt_str = start_raw.get("dateTime") or start_raw.get("date")
            if not dt_str:
                continue

            try:
                # Handle both ISO formats
                start_dt = datetime.fromisoformat(
                    dt_str.replace("Z", "+00:00"))
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)

                if now <= start_dt <= cutoff:
                    results.append({
                        "title": e.get("summary", "Untitled"),
                        "time": start_dt.isoformat(),
                        "location": e.get("location", "")
                    })
            except (ValueError, TypeError):
                continue

        return results
    except Exception as exc:
        logger.debug("get_upcoming_events failed: %s", exc)
        return []


def _get_vault_store():
    """Best-effort: get the live store for vault indexing."""
    try:
        from main import get_app
        app = get_app()
        if app:
            return app.state.memory_manager._store
    except Exception:
        pass
    return None


async def _exec_save_vault_note(args: dict, user_id: str) -> str:
    try:
        from providers.vault.vault_provider import VaultProvider
        root = args.get("root", "personal")
        title = args["title"]
        content = args["content"]
        if not title.endswith(".md"):
            title += ".md"
        virtual_path = f"{root}/{title}"
        provider = VaultProvider(store=_get_vault_store())
        await provider.write_note(user_id, virtual_path, content)
        return f"Note '{args['title']}' saved to your {root} vault."
    except Exception as exc:
        logger.error("save_vault_note failed: %s", exc)
        return f"Failed to save note '{args.get('title')}': {exc}"


async def _exec_read_vault_note(args: dict, user_id: str) -> str:
    try:
        from providers.vault.vault_provider import VaultProvider
        root = args.get("root", "personal")
        title = args["title"]
        if not title.endswith(".md"):
            title += ".md"
        virtual_path = f"{root}/{title}"
        provider = VaultProvider()
        content = await provider.read_note(user_id, virtual_path)
        if len(content) > 3000:
            content = content[:3000] + "\n\n[... note truncated ...]"
        return content
    except FileNotFoundError:
        return f"No note named '{args['title']}' found in the {args.get('root', 'personal')} vault."
    except Exception as exc:
        logger.error("read_vault_note failed: %s", exc)
        return f"Failed to read note '{args.get('title')}': {exc}"


async def _exec_search_vault(args: dict, user_id: str) -> str:
    try:
        from providers.vault.vault_provider import VaultProvider
        provider = VaultProvider(store=_get_vault_store())
        results = await provider.search_text(user_id, args["query"])
        if not results:
            return f"No notes found matching '{args['query']}'."
        lines = [
            f"- {r.get('title', r['virtual_path'])} ({r['virtual_path']})" for r in results[:10]]
        return f"Found {len(results)} note(s):\n" + "\n".join(lines)
    except Exception as exc:
        logger.error("search_vault failed: %s", exc)
        return f"Vault search failed: {exc}"


async def _exec_code_interpreter(args: dict, user_id: str) -> str:
    try:
        from core.code_interpreter import run_code
        return await run_code(args["code"])
    except Exception as exc:
        logger.error("code_interpreter failed: %s", exc)
        return f"Failed to run code: {exc}"


async def _exec_mow_command(args: dict, user_id: str) -> str:
    try:
        from api.routes.vector_fleet import queue_command, get_fleet_state, get_first_unit_id

        command = args["command"]
        unit_id = args.get("unit_id") or get_first_unit_id()

        if not unit_id:
            return (
                "No mower units are registered yet. "
                "Make sure Voyager is running and has connected to River Song."
            )

        fleet = get_fleet_state()
        state = fleet.get(unit_id, {})
        last_seen = state.get("last_seen")
        import time
        online = last_seen and (time.time() - last_seen) < 30

        queued = queue_command(unit_id, command, {})
        if not queued:
            return f"Could not queue '{command}' — unit '{unit_id}' is unknown."

        label = {
            "mow_start": "start mowing",
            "mow_stop": "stop mowing",
            "return_home": "return to dock",
            "estop": "EMERGENCY STOP",
            "estop_reset": "reset the E-stop",
        }.get(command, command)

        if online:
            return f"Command queued: {label}. Voyager will execute it on the next poll (within 100 ms)."
        else:
            ago = f"{
                round(
                    time.time() -
                    last_seen)}s ago" if last_seen else "never"
            return (
                f"Command queued: {label}. "
                f"Note: Voyager was last seen {ago} and may be offline. "
                "It will pick up the command when it reconnects."
            )
    except Exception as exc:
        logger.error("mow_command failed: %s", exc)
        return f"Failed to send mower command: {exc}"
