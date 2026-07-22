import asyncio
import logging
import json as _json
import re as _re
from datetime import datetime, timezone
from fastapi import FastAPI
from providers.llm.registry import get_llm_provider
from providers.memory.vault import VaultProvider

logger = logging.getLogger(__name__)

IDLE_CLOSE_MINUTES = 30
CHAT_RETENTION_DAYS = 90

def _clean(text: str) -> str:
    text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
    text = _re.sub(r"```(?:json)?\s*", "", text).strip()
    return text

def _parse_json_array(text: str):
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        return None
    try:
        return _json.loads(text[start:end])
    except _json.JSONDecodeError:
        return None

async def _distill_session(app: FastAPI, session: dict):
    user_id = session["user_id"]
    session_id = session["id"]
    
    memory_manager = getattr(app.state, "memory_manager", None)
    if not memory_manager:
        return
        
    store = memory_manager._store
    messages = await store.get_chat_messages(user_id, session_id)
    
    if len(messages) < 2:
        # Too short to distill, just mark it distilled
        await store.mark_session_distilled(session_id, session.get("title") or "Short conversation")
        return
        
    conversation_text = "\n".join(
        f"{m['role'].upper()}: {m.get('content', '')}"
        for m in messages
        if m.get("role") in ("user", "assistant")
    )
    
    llm_settings = await store.get_llm_settings(user_id)
    from providers.llm.registry import get_llm_provider
    llm_class = get_llm_provider(llm_settings.provider)
    if not llm_class:
        logger.error(f"Cannot distill: provider {llm_settings.provider} not found")
        return
    llm = llm_class(llm_settings.model)
    
    async def _extract_facts():
        extraction_prompt = (
            "You are building a memory profile for an AI assistant. "
            "Extract ANYTHING from the USER's messages that would help the AI know them better in future conversations.\n\n"
            "Use ONLY these canonical snake_case keys:\n"
            "- Identity: full_name, first_name, last_name, age, gender, location, nationality\n"
            "- Work: job_title, employer, industry, role, career_goals\n"
            "- Family: spouse_name, child_name, pet_name, relative_name, friend_name\n"
            "- Health: health_condition, medication, diet, fitness_habit\n"
            "- Interests: hobby, interest, favorite_food, favorite_music, favorite_tv_show, favorite_book\n"
            "- Style: preference, dislike, communication_style, tone_preference\n"
            "- Context: current_project, problem, plan, upcoming_event, mood\n\n"
            "Capture broadly but categorize into these keys. Output ONLY a raw JSON array.\n"
            "Each item: {\"key\": \"canonical_key\", \"value\": \"concise plain text value\"}\n"
            "If the user shared nothing about themselves at all, output: []\n\n"
            f"CONVERSATION:\n{conversation_text}\n\n"
            "JSON array:"
        )
        try:
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a precise fact extractor. Output only valid JSON."},
                {"role": "user", "content": extraction_prompt},
            ]):
                full += chunk
            full = _clean(full)
            items = _parse_json_array(full)
            if not items:
                return
            for f in items:
                key = str(f.get("key", "")).strip()
                value = str(f.get("value", "")).strip()
                if key and value:
                    await memory_manager.upsert_fact(
                        user_id, key, value, source="inferred",
                        source_kind="distiller", source_ref=session_id,
                    )
        except Exception as exc:
            logger.warning("Fact extraction failed (user=%s, session=%s): %s", user_id, session_id, exc)

    async def _extract_preferences():
        pref_prompt = (
            "Identify communication and interaction preferences from the USER's messages.\n"
            "Look for: preferred response length, tone (formal/casual), topics they enjoy or avoid, "
            "how they like to be addressed, patience level, expertise areas they have.\n"
            "Output ONLY a raw JSON array — no markdown, no code fences.\n"
            "Each item: {\"category\": \"snake_case_category\", \"value\": \"description\", \"confidence\": \"low|medium|high\"}\n"
            "Example: [{\"category\": \"tone\", \"value\": \"casual and friendly\", \"confidence\": \"medium\"}]\n"
            "If no preferences are evident, output: []\n\n"
            f"CONVERSATION:\n{conversation_text}\n\nJSON array:"
        )
        try:
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a preference extractor. Output only valid JSON."},
                {"role": "user", "content": pref_prompt},
            ]):
                full += chunk
            full = _clean(full)
            items = _parse_json_array(full)
            if not items:
                return
            for p in items:
                cat = str(p.get("category", "")).strip()
                value = str(p.get("value", "")).strip()
                conf = str(p.get("confidence", "low")).strip().lower()
                if not (cat and value):
                    continue
                # Confidence split (memory-hub-plan M4): high-confidence
                # inferences auto-apply with provenance; low/medium queue as
                # suggestions for human approval instead of applying silently.
                if conf == "high":
                    await memory_manager.upsert_preference(
                        user_id, cat, value, confidence="high",
                        source_kind="distiller", source_ref=session_id,
                    )
                else:
                    await memory_manager.save_pending_habit(
                        user_id,
                        pattern=f"{cat}: {value}",
                        confidence=conf if conf in ("low", "medium") else "low",
                        kind="preference",
                        payload=_json.dumps({
                            "category": cat,
                            "value": value,
                            "source_kind": "distiller",
                            "source_ref": session_id,
                        }),
                    )
        except Exception as exc:
            logger.warning("Preference extraction failed (user=%s, session=%s): %s", user_id, session_id, exc)

    async def _generate_summary_and_title():
        title = session.get("title") or "Conversation"
        summary = ""
        
        # 1. Generate Summary
        summary_prompt = (
            "Write a 2-3 sentence summary of this conversation for future reference.\n"
            "Focus on what was discussed, any decisions made, and key information shared.\n"
            "Be concise and factual. Plain text only — no lists, no markdown.\n\n"
            f"CONVERSATION:\n{conversation_text}\n\nSummary:"
        )
        try:
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a concise summarizer."},
                {"role": "user", "content": summary_prompt},
            ]):
                full += chunk
            summary = _clean(full).strip()
            if summary:
                await memory_manager.record_summary(
                    user_id, summary,
                    source_kind="distiller", source_ref=session_id,
                )
                # Append to Chronos
                try:
                    provider = VaultProvider(store=store)
                    await provider.append_to_daily(user_id, "Conversation summary", summary)
                except Exception as vexc:
                    logger.debug("Daily-note append skipped: %s", vexc)
        except Exception as exc:
            logger.warning("Summary generation failed: %s", exc)
            
        # 2. Generate Title (if not already set appropriately)
        if not session.get("title"):
            title_prompt = (
                "Write a short 3-5 word title for this conversation based on the following text.\n"
                "Output ONLY the raw text of the title, no quotes.\n\n"
                f"CONVERSATION:\n{conversation_text}\n\nTitle:"
            )
            try:
                full = ""
                async for chunk in llm.stream_response([
                    {"role": "user", "content": title_prompt},
                ]):
                    full += chunk
                t = _clean(full).strip()
                if t: title = t
            except Exception as exc:
                pass

        return title

    await asyncio.gather(
        _extract_facts(),
        _extract_preferences(),
    )
    
    title = await _generate_summary_and_title()
    
    # Mark as distilled
    await store.mark_session_distilled(session_id, title)
    logger.info(f"Distilled session {session_id} for user {user_id}")


async def run_distiller(app: FastAPI):
    """Finds old undistilled sessions and processes them."""
    memory_manager = getattr(app.state, "memory_manager", None)
    if not memory_manager:
        return
        
    store = memory_manager._store
    if not hasattr(store, "get_undistilled_sessions"):
        return
        
    sessions = await store.get_undistilled_sessions(idle_minutes=IDLE_CLOSE_MINUTES)
    for session in sessions:
        try:
            await _distill_session(app, session)
        except Exception as e:
            logger.error(f"Failed to distill session {session['id']}: {e}")

async def sweep_messages(app: FastAPI):
    """Deletes old chat messages from distilled sessions."""
    memory_manager = getattr(app.state, "memory_manager", None)
    if not memory_manager:
        return
        
    store = memory_manager._store
    if not hasattr(store, "delete_old_chat_messages"):
        return
        
    try:
        deleted_count = await store.delete_old_chat_messages(retention_days=CHAT_RETENTION_DAYS)
        if deleted_count > 0:
            logger.info(f"Swept {deleted_count} old chat messages.")
    except Exception as e:
        logger.error(f"Failed to sweep chat messages: {e}")
