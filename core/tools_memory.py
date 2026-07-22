"""
core/tools_memory.py

Memory and vault-note tool executors, split out of core/tools.py (god-file
audit #3). These are self-contained (no shared tools.py helpers) and are
re-exported by core.tools so the dispatcher and any callers are unchanged.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


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

async def _get_vault_provider():
    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "memory_manager"):
        return None
    from providers.vault.vault_provider import VaultProvider
    return VaultProvider(store=app.state.memory_manager._store)

async def _exec_take_note(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    content = args.get("content")
    if not content:
        return "Error: content is required."
    title = args.get("title", "Untitled Note")
    # Clean title for filename
    import re
    safe_title = re.sub(r"[^A-Za-z0-9 _-]", "", title).strip() or "Note"
    virtual_path = f"personal/{safe_title}.md"
    
    provider = await _get_vault_provider()
    if not provider:
        return "Error: Vault provider unavailable."
    
    # Add provenance frontmatter
    session_id = context.get("session_id", "unknown_session")
    header = f"---\nsource: conversation\nsource_ref: {session_id}\n---\n\n# {title}\n\n"
    
    try:
        await provider.write_note(user_id, virtual_path, header + content)
        return f"Note created at: {virtual_path}"
    except Exception as e:
        return f"Failed to create note: {e}"

async def _exec_append_note(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    title = args.get("title")
    content = args.get("content")
    if not title or not content:
        return "Error: title and content required."
        
    provider = await _get_vault_provider()
    if not provider:
        return "Error: Vault provider unavailable."
        
    # Search for note
    results = await provider.store.search_vault_notes(user_id, title, limit=3)
    if not results:
        return f"No notes found matching '{title}'."
        
    if len(results) > 1 and results[0].get("rank", 0) > -5: 
        matches = [r["virtual_path"] for r in results]
        return f"Found multiple matches. Please use the exact virtual_path to append. Matches: {matches}"
        
    virtual_path = results[0]["virtual_path"]
    try:
        await provider.append_to_note(user_id, virtual_path, "\n" + content)
        return f"Appended to {virtual_path} successfully."
    except Exception as e:
        return f"Failed to append to note: {e}"

async def _exec_journal(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    content = args.get("content")
    if not content:
        return "Error: content is required."
        
    provider = await _get_vault_provider()
    if not provider:
        return "Error: Vault provider unavailable."
        
    try:
        await provider.append_to_daily(user_id, "Journal Entry", content)
        return "Journal entry added to today's daily note."
    except Exception as e:
        return f"Failed to append journal entry: {e}"

async def _exec_find_notes(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    query = args.get("query")
    if not query:
        return "Error: query is required."
        
    provider = await _get_vault_provider()
    if not provider:
        return "Error: Vault provider unavailable."
        
    try:
        results = await provider.store.search_vault_notes(user_id, query, limit=5)
        if not results:
            return f"No notes found for query: {query}"
            
        out = f"Found {len(results)} notes:\n"
        for r in results:
            out += f"- {r['virtual_path']} ({r['title']})\n"
        return out
    except Exception as e:
        return f"Failed to search notes: {e}"

async def _exec_read_note(args: dict, context: dict) -> str:
    user_id = context.get("user_id", "primary_user")
    title = args.get("title")
    if not title:
        return "Error: title or virtual path is required."
        
    provider = await _get_vault_provider()
    if not provider:
        return "Error: Vault provider unavailable."
        
    try:
        # First assume it's a virtual path
        try:
            content = await provider.read_note(user_id, title)
            return f"--- Note: {title} ---\n{content}"
        except Exception:
            # Fallback to search
            results = await provider.store.search_vault_notes(user_id, title, limit=1)
            if not results:
                return f"Note not found: {title}"
            
            vp = results[0]["virtual_path"]
            content = await provider.read_note(user_id, vp)
            return f"--- Note: {vp} ---\n{content}"
    except Exception as e:
        return f"Failed to read note: {e}"
