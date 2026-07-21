async def _exec_remember_fact(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    session_id = context.get("session_id", "unknown_session")
    key = args.get("key", "Fact")
    value = args.get("value")
    if not value: return "Error: value is required."

    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "memory_manager"):
        return "Error: Memory manager unavailable."
    
    mm = app.state.memory_manager
    await mm.upsert_fact(user_id=user_id, key=key, value=value, source="explicit", source_kind="conversation", source_ref=session_id)
    return f"Remembered: {key} = {value}"


async def _exec_forget_memory(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    query = args.get("query")
    if not query: return "Error: query is required."
        
    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "memory_manager"):
        return "Error: Memory manager unavailable."
    
    mm = app.state.memory_manager
    import uuid
    is_uuid = False
    try:
        uuid.UUID(query)
        is_uuid = True
    except:
        pass
        
    if is_uuid:
        if await mm.delete_fact(query, user_id): return "Deleted fact."
        if await mm.delete_preference(query, user_id): return "Deleted preference."
        if await mm.delete_summary(query, user_id): return "Deleted summary."
        return "Memory ID not found."
        
    matches = await mm.search_memories(user_id, query, limit=5)
    if not matches:
        return "No memories found matching that query."
    if len(matches) == 1:
        m = matches[0]
        if m["type"] == "fact": await mm.delete_fact(m["id"], user_id)
        elif m["type"] == "preference": await mm.delete_preference(m["id"], user_id)
        elif m["type"] == "summary": await mm.delete_summary(m["id"], user_id)
        return f"Deleted {m['type']}: {m['text']}"
    
    out = "Found multiple possible matches. Please call forget_memory again with the exact ID to delete:\n"
    for m in matches:
        out += f"- [{m['id']}] {m['type'].upper()}: {m['text']}\n"
    return out


async def _exec_recall_memory(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    query = args.get("query")
    if not query: return "Error: query is required."
    
    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "memory_manager"):
        return "Error: Memory manager unavailable."
        
    mm = app.state.memory_manager
    matches = await mm.search_memories(user_id, query, limit=10)
    if not matches:
        return "No memories found matching that query."
    
    out = "Recalled memories:\n"
    for m in matches:
        out += f"- [{m['id']}] {m['type'].upper()}: {m['text']}\n"
    return out


async def _exec_update_memory(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    query = args.get("query")
    new_value = args.get("new_value")
    if not query or not new_value: return "Error: query and new_value required."
    
    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "memory_manager"):
        return "Error: Memory manager unavailable."
        
    mm = app.state.memory_manager
    import uuid
    is_uuid = False
    try:
        uuid.UUID(query)
        is_uuid = True
    except:
        pass
        
    if is_uuid:
        f = await mm._store.get_fact_by_id(user_id, query)
        if f:
            await mm.update_fact(query, user_id, f.key, new_value)
            return "Fact updated."
        p = await mm._store.get_preference_by_id(user_id, query)
        if p:
            await mm.update_preference(query, user_id, p.category, new_value)
            return "Preference updated."
        return "Cannot update summary or memory ID not found."
        
    matches = await mm.search_memories(user_id, query, limit=5)
    if not matches:
        return "No memories found matching that query."
    if len(matches) == 1:
        m = matches[0]
        if m["type"] == "fact":
            f = await mm._store.get_fact_by_id(user_id, m["id"])
            await mm.update_fact(m["id"], user_id, f.key, new_value)
            return "Fact updated."
        elif m["type"] == "preference":
            p = await mm._store.get_preference_by_id(user_id, m["id"])
            await mm.update_preference(m["id"], user_id, p.category, new_value)
            return "Preference updated."
        elif m["type"] == "summary":
            return "Cannot update summary text directly."
    
    out = "Found multiple possible matches. Please call update_memory again with the exact ID to update:\n"
    for m in matches:
        out += f"- [{m['id']}] {m['type'].upper()}: {m['text']}\n"
    return out
