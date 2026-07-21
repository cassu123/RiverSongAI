import re

with open("core/tools.py", "r") as f:
    content = f.read()

timer_def = """
    def set_timer(self, label: str, duration_seconds: int) -> str:
        \"\"\"
        Set a named timer for a specific duration in seconds.
        Useful for cooking or waiting for a task to complete.
        \"\"\"
        import asyncio
        from api.routes.culinary import _ws_manager
        
        async def _timer_task():
            await asyncio.sleep(duration_seconds)
            # Announce via TTS + push by broadcasting
            await _ws_manager.broadcast(self.user_id, "timer_fired", {"label": label})
            
        asyncio.create_task(_timer_task())
        return f"Timer '{label}' set for {duration_seconds} seconds."
"""

# I need to add this to the Tools class or equivalent. 
# Let me search how Tools are defined in core/tools.py
