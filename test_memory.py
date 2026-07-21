import asyncio
import os
from datetime import datetime
from config.settings import get_settings
from main import get_app
from core.tools import execute_tool
from providers.memory.memory_manager import MemoryManager

async def run_tests():
    app = get_app()
    # Trigger db init if needed
    if not hasattr(app.state, 'memory_manager'):
        print("Initializing memory manager...")
        # (This is just a mock setup, in reality it's initialized on app start)
        return

    mm = app.state.memory_manager
    user_id = "test_user_123"
    session_id = "session_xyz"
    context = {"user_id": user_id, "session_id": session_id}

    print("=== Testing M4 Tools ===")
    
    # 1. remember_fact
    res = await execute_tool("remember_fact", {"key": "Favorite drink", "value": "Espresso"}, context, user_id)
    print("remember_fact:", res)

    # 2. recall_memory
    res = await execute_tool("recall_memory", {"query": "drink"}, context, user_id)
    print("recall_memory:", res)
    
    # 3. update_memory
    res = await execute_tool("update_memory", {"query": "Espresso", "new_value": "Double Espresso"}, context, user_id)
    print("update_memory:", res)
    
    # 4. recall_memory again
    res = await execute_tool("recall_memory", {"query": "drink"}, context, user_id)
    print("recall_memory (after update):", res)
    
    # 5. forget_memory
    res = await execute_tool("forget_memory", {"query": "Double Espresso"}, context, user_id)
    print("forget_memory:", res)
    
    # 6. recall_memory again
    res = await execute_tool("recall_memory", {"query": "drink"}, context, user_id)
    print("recall_memory (after forget):", res)

    print("\n=== Testing M5 Tools ===")
    
    # 7. take_note
    res = await execute_tool("take_note", {"title": "Coffee Recipe", "content": "18g in, 36g out."}, context, user_id)
    print("take_note:", res)
    
    # 8. append_note
    res = await execute_tool("append_note", {"title": "Coffee Recipe", "content": "Water at 93C."}, context, user_id)
    print("append_note:", res)
    
    # 9. read_note
    res = await execute_tool("read_note", {"title": "Coffee Recipe"}, context, user_id)
    print("read_note:", res)
    
    # 10. journal
    res = await execute_tool("journal", {"content": "Had a great coffee today."}, context, user_id)
    print("journal:", res)
    
    # 11. find_notes
    res = await execute_tool("find_notes", {"query": "coffee"}, context, user_id)
    print("find_notes:", res)

if __name__ == "__main__":
    asyncio.run(run_tests())
