"""
core/tools_schemas.py

Tool JSON schemas (Anthropic / Ollama compatible) for River Song's agent
tools. Split out of core/tools.py so the executor logic and the large schema
catalog live in separate files. core.tools re-exports TOOL_SCHEMAS, so
`from core.tools import TOOL_SCHEMAS` keeps working unchanged.
"""
from __future__ import annotations

# =============================================================================
# Tool Schemas (Anthropic / Ollama compatible format)
# =============================================================================

TOOL_SCHEMAS = [
    {
        "name": "alias_device",
        "description": "Learn a new alias or nickname for a smart home device. Call this if the user assigns a new name to a device.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "The Home Assistant entity_id of the device."},
                "alias": {"type": "string", "description": "The new nickname to assign to this device."}
            },
            "required": ["entity_id", "alias"]
        }
    },
    {
        "name": "take_note",
        "description": "Create a new vault note. The note will carry provenance linking it back to the conversation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The title of the note (optional)."},
                "content": {"type": "string", "description": "The markdown content of the note."}
            },
            "required": ["content"]
        }
    },
    {
        "name": "append_note",
        "description": "Append to an existing note by title match.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The title of the note to append to."},
                "content": {"type": "string", "description": "The content to append."}
            },
            "required": ["title", "content"]
        }
    },
    {
        "name": "journal",
        "description": "Append a timestamped line to today's daily note.",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The content to append to the journal."}
            },
            "required": ["content"]
        }
    },
    {
        "name": "find_notes",
        "description": "Search the vault for notes by query using Full Text Search.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_note",
        "description": "Read the full content of a vault note.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The title or virtual path of the note to read."}
            },
            "required": ["title"]
        }
    },
    {
        "name": "remember_fact",
        "description": "Explicitly remember a fact about the user for long-term memory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "The category or key of the fact (e.g. 'Cheryl birthday')."},
                "value": {"type": "string", "description": "The value of the fact (e.g. 'March 3rd')."}
            },
            "required": ["value"]
        }
    },
    {
        "name": "forget_memory",
        "description": "Delete a memory (fact, preference, summary) based on a query or exact ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The memory content to search for, or exact ID to forget."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "recall_memory",
        "description": "Recall specific semantic memories about a topic from the long-term memory hub.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The topic or question to query."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "update_memory",
        "description": "Update an existing memory with a new value using a query or exact ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The memory to update (query or ID)."},
                "new_value": {"type": "string", "description": "The new value to set."}
            },
            "required": ["query", "new_value"]
        }
    },
    {
        "name": "get_vehicle_status",
        "description": "Get the current maintenance status and timeline for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string", "description": "The vehicle nickname, make, model, or year."}
            },
            "required": ["vehicle"]
        }
    },
    {
        "name": "get_vehicle_spec",
        "description": "Get specific specs for a vehicle like torque, fluid type, volume, min/max.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string", "description": "The vehicle name."},
                "item": {"type": "string", "description": "The part or fluid to get specs for (e.g. 'drain plug', 'oil')."}
            },
            "required": ["vehicle", "item"]
        }
    },
    {
        "name": "query_vehicle_manual",
        "description": "Search the owner's manual for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "question": {"type": "string"}
            },
            "required": ["vehicle", "question"]
        }
    },
    {
        "name": "record_odometer",
        "description": "Record a new odometer reading for a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "value": {"type": "number"}
            },
            "required": ["vehicle", "value"]
        }
    },
    {
        "name": "find_parts",
        "description": "Find OEM and alternative parts for a vehicle job online.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle": {"type": "string"},
                "job": {"type": "string"}
            },
            "required": ["vehicle", "job"]
        }
    },
    {
        "name": "set_timer",
        "description": "Set a named timer for a specific duration in seconds. Useful for cooking or waiting for a task to complete.",
        "input_schema": {
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "The name of the timer (e.g. 'pasta')."},
                "duration_seconds": {"type": "integer", "description": "Duration in seconds."}
            },
            "required": ["label", "duration_seconds"]
        }
    },
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
        "name": "add_asset",
        "description": "Add a new physical item (asset) to the user's home inventory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name of the item."},
                "location": {"type": "string", "description": "Where the item is stored (e.g., Kitchen Pantry, Garage)."},
                "home": {"type": "string", "description": "Optional name of the home/stash (e.g., Main House, Storage)."},
                "category": {"type": "string", "description": "Category (FURNITURE/ELECTRONICS/APPLIANCES/TOOLS/CLOTHING/VEHICLES/SPORTING_GOODS/ART/JEWELRY/DOCUMENT/OTHER)."},
                "details": {"type": "string", "description": "Any extra notes or description."}
            },
            "required": ["name", "location"]
        }
    },
    {
        "name": "find_asset",
        "description": "Find an item/asset in the user's home inventory by name, serial, or EIN.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Name, serial number, or EIN to search for."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "asset_summary",
        "description": "Get a summary of inventory counts and total replacement value.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scope": {"type": "string", "description": "Optional filter scope like 'home', 'category', or 'room/location'."}
            },
            "required": []
        }
    },
    {
        "name": "registry_health",
        "description": "Check the registry health for missing photos, serials, values, or receipts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "home": {"type": "string", "description": "Optional home name to check."}
            },
            "required": []
        }
    },
    {
        "name": "warranty_check",
        "description": "Check warranty status of items or find items with expiring warranties.",
        "input_schema": {
            "type": "object",
            "properties": {
                "item_name": {"type": "string", "description": "Optional item name to check specifically."},
                "expiring_within_days": {"type": "integer", "description": "Optional number of days to look ahead for expiring warranties."}
            },
            "required": []
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
