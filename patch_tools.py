import re

with open("core/tools.py", "r") as f:
    content = f.read()

timer_schema = """
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
    },"""

# insert timer_schema right after TOOL_SCHEMAS = [
content = content.replace("TOOL_SCHEMAS = [", "TOOL_SCHEMAS = [" + timer_schema)

timer_impl = """
    async def _exec_set_timer(self, args: Dict[str, Any]) -> str:
        label = args.get("label", "Timer")
        duration = int(args.get("duration_seconds", 60))
        
        async def _timer_task():
            await asyncio.sleep(duration)
            from api.routes.culinary import _ws_manager
            await _ws_manager.broadcast(self.user_id, "timer_fired", {"label": label})
            
        asyncio.create_task(_timer_task())
        return f"Timer '{label}' set for {duration} seconds."
"""

# insert timer_impl into the Tools class. 
# find `class Tools:`
tools_class_idx = content.find("class Tools:")
if tools_class_idx != -1:
    # find `def __init__`
    init_idx = content.find("def __init__", tools_class_idx)
    content = content[:init_idx] + timer_impl + "\n    " + content[init_idx:]

with open("core/tools.py", "w") as f:
    f.write(content)
