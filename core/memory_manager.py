# =============================================================================
# core/memory_manager.py
#
# File Purpose:
#   Manages the three-tier memory system for River Song.
#   Builds the memory context block injected into every conversation.
#   Records conversation summaries at session end.
#   Handles TTL extension when summaries are referenced.
#
# Key Classes:
#   MemoryManager -- main class; one instance per running server
#
# Key Methods:
#   .build_context_block(user_id) -> str
#       Returns formatted memory text to prepend to the system prompt.
#   .record_summary(user_id, summary_text, llm_provider) -> None
#       Generates and persists a new conversation summary.
#   .upsert_fact(user_id, key, value, source) -> None
#       Store or update a user fact.
#   .upsert_preference(user_id, category, value, confidence) -> None
#       Store or update an inferred preference.
#   .cleanup_expired(user_id) -> int
#       Sweep expired summaries; returns count deleted.
#
# Dependencies:
#   providers.memory (SQLiteStore, all models, ttl_engine)
#   config.settings (get_settings)
#   uuid, datetime (stdlib)
#
# Usage Example:
#   manager = MemoryManager(store)
#   await manager.initialize()
#   context = await manager.build_context_block("alice")
#   # inject `context` into conversation system prompt
#   await manager.record_summary("alice", "Discussed weekly schedule.")
# =============================================================================

from __future__ import annotations

import logging
import uuid
from typing import Optional

from config.settings import get_settings
from providers.memory.models import (
    ConversationSummary,
    Fact,
    MemorySettings,
    Preference,
    TTLOption,
)
from providers.memory.sqlite_store import SQLiteStore
from providers.memory.ttl_engine import calculate_expires_at, extend_ttl
from providers.memory.vector_store import VectorStore


logger = logging.getLogger(__name__)


class MemoryManager:
    """
    Purpose:
        Central coordinator for all memory operations.
        The conversation loop calls this before and after each session.

    Assumptions/Constraints:
        - SQLiteStore must be initialized before MemoryManager is used.
        - One MemoryManager instance is shared across all WebSocket connections.
        - build_context_block() is called at conversation start; it also handles
          auto-extend for any summaries it loads (if settings.auto_extend is True).
        - record_summary() is called at conversation end with the full transcript
          or a pre-generated summary string.
    """

    def __init__(self, store: SQLiteStore) -> None:
        self._store = store
        self._settings = get_settings()
        self._vector_store = VectorStore() if self._settings.semantic_memory_enabled else None

    async def initialize(self) -> None:
        """Ensure the database schema is ready. Call once at server startup."""
        await self._store.initialize()
        logger.info(
            "MemoryManager initialized (db=%s).",
            self._settings.db_path)

    # =========================================================================
    # Context building
    # =========================================================================

    async def build_context_block(
            self, user_id: str, query_text: Optional[str] = None) -> str:
        """
        Build the memory context string to inject into the system prompt.

        Loads facts, preferences, and recent non-expired summaries for the user.
        If auto_extend is enabled, extends TTL for any loaded summaries.

        Args:
            user_id: The user whose memory to load.
            query_text: Optional text to use for semantic search (if enabled).

        Returns:
            Formatted string block ready to append to the system prompt.
            Returns empty string if all tiers are empty.
        """
        if self._settings.semantic_memory_enabled and query_text:
            return await self.get_context_for_prompt(user_id, query_text)

        mem_settings = await self._store.get_memory_settings(user_id)
        parts: list[str] = []

        # --- Facts ---
        facts = await self._store.get_facts(user_id)
        if facts:
            lines = [f"  - {f.key}: {f.value}" for f in facts]
            parts.append("KNOWN FACTS ABOUT THE USER:\n" + "\n".join(lines))

        # --- Preferences ---
        prefs = await self._store.get_preferences(user_id)
        if prefs:
            lines = [f"  - {p.category}: {p.value}" for p in prefs]
            parts.append("USER PREFERENCES:\n" + "\n".join(lines))

        # --- Summaries ---
        if mem_settings.summaries_enabled:
            summaries = await self._store.get_recent_summaries(
                user_id,
                limit=self._settings.memory_max_summaries_in_context,
            )
            if summaries:
                lines = []
                for s in summaries:
                    date_str = (
                        s.created_at.strftime("%Y-%m-%d")
                        if s.created_at
                        else "unknown date"
                    )
                    lines.append(f"  [{date_str}] {s.summary}")

                    if mem_settings.auto_extend:
                        new_expiry = extend_ttl(s, mem_settings.default_ttl)
                        await self._store.update_summary_ttl(s.id, new_expiry)

                parts.append(
                    "RECENT CONVERSATION SUMMARIES (most recent first):\n"
                    + "\n".join(lines)
                )

        if not parts:
            return ""

        return (
            "\n\n--- MEMORY ---\n"
            + "\n\n".join(parts)
            + "\n--- END MEMORY ---"
        )

    async def get_context_for_prompt(
            self, user_id: str, query_text: str) -> str:
        """
        Retrieves relevant context using semantic search, augmented by core SQLite results.
        """
        try:
            mem_settings = await self._store.get_memory_settings(user_id)
            
            # 1. Local Semantic results (ChromaDB)
            semantic_results = await self._vector_store.search(  # type: ignore
                query_text,
                n_results=6,
                where={"user_id": user_id}
            )

            # 2. Core SQLite results
            facts = await self._store.get_facts(user_id)
            prefs = await self._store.get_preferences(user_id)
            
            recent_summaries = []
            if mem_settings.summaries_enabled:
                recent_summaries = await self._store.get_recent_summaries(
                    user_id,
                    limit=self._settings.memory_max_summaries_in_context,
                )

            parts: list[str] = []

            # Extend TTL for semantic summary hits
            if semantic_results and mem_settings.auto_extend:
                for r in semantic_results:
                    if r.get("metadata", {}).get("type") == "summary":
                        summary_id = r["id"]
                        summary = await self._store.get_summary_by_id(summary_id)
                        if summary:
                            new_expiry = extend_ttl(summary, mem_settings.default_ttl)
                            await self._store.update_summary_ttl(summary.id, new_expiry)

            if semantic_results:
                lines = [f"  - {r['text']}" for r in semantic_results]
                parts.append("RELEVANT MEMORIES (Local):\n" + "\n".join(lines))

            if facts:
                lines = [f"  - {f.key}: {f.value}" for f in facts]
                parts.append(
                    "KNOWN FACTS ABOUT THE USER:\n" +
                    "\n".join(lines))

            if prefs:
                lines = [f"  - {p.category}: {p.value}" for p in prefs]
                parts.append("USER PREFERENCES:\n" + "\n".join(lines))
                
            if recent_summaries:
                lines = []
                for s in recent_summaries:
                    date_str = (
                        s.created_at.strftime("%Y-%m-%d")
                        if s.created_at
                        else "unknown date"
                    )
                    lines.append(f"  [{date_str}] {s.summary}")
                    
                    if mem_settings.auto_extend:
                        new_expiry = extend_ttl(s, mem_settings.default_ttl)
                        await self._store.update_summary_ttl(s.id, new_expiry)

                parts.append(
                    "RECENT CONVERSATION SUMMARIES (most recent first):\n"
                    + "\n".join(lines)
                )

            if not parts:
                return ""

            return (
                "\n\n--- MEMORY ---\n"
                + "\n\n".join(parts)
                + "\n--- END MEMORY ---"
            )

        except Exception as exc:
            logger.warning(
                "Semantic search failed: %s. Falling back to SQLite only.", exc)
            return await self.build_context_block(user_id, query_text=None)

    async def search_memories(self, user_id: str, query: str, limit: int = 5) -> list[dict]:
        """Search across facts, preferences, and summaries using vector store."""
        if not self._settings.semantic_memory_enabled or not self._vector_store:
            return []
            
        results = await self._vector_store.search(query, n_results=limit, where={"user_id": user_id})
        
        matches = []
        for res in results:
            item_type = res["metadata"].get("type")
            item_id = res["id"]
            
            # Fetch full from SQLite
            if item_type == "fact":
                f = await self._store.get_fact_by_id(user_id, item_id)
                if f: matches.append({"id": f.id, "type": "fact", "text": f"{f.key}: {f.value}"})
            elif item_type == "preference":
                p = await self._store.get_preference_by_id(user_id, item_id)
                if p: matches.append({"id": p.id, "type": "preference", "text": f"{p.category}: {p.value}"})
            elif item_type == "summary":
                s = await self._store.get_summary_by_id(item_id)
                if s and s.user_id == user_id: 
                    matches.append({"id": s.id, "type": "summary", "text": s.summary})
        return matches

    # =========================================================================
    # Facts
    # =========================================================================

    async def upsert_fact(
        self,
        user_id: str,
        key: str,
        value: str,
        source: str = "explicit",
        source_kind: str = "conversation",
        source_ref: Optional[str] = None,
    ) -> None:
        """
        Store or update a user fact.

        Args:
            user_id: Target user.
            key:     Short slug (e.g., "name", "job", "pet_dog_name").
            value:   Plain text value.
            source:  "explicit" (user stated) or "inferred" (River Song concluded).
            source_kind: "conversation" | "note" | "manual" | "distiller" | "habit_inference"
            source_ref: Session ID, note path, etc.
        """
        existing = await self._store.get_fact_by_key(user_id, key.lower().strip())
        fact_id = existing.id if existing else str(uuid.uuid4())
        
        fact = Fact(
            id=fact_id,
            user_id=user_id,
            key=key.lower().strip(),
            value=value.strip(),
            source=source,
            source_kind=source_kind,
            source_ref=source_ref,
        )
        await self._store.upsert_fact(fact)
        logger.debug(
            "Fact upserted to SQLite (user=%s, key=%s).",
            user_id,
            key)

        if self._settings.semantic_memory_enabled and self._vector_store:
            fact_text = f"{key}: {value}"
            await self._vector_store.upsert(
                id=fact_id,
                text=fact_text,
                metadata={"type": "fact", "user_id": user_id}
            )

    async def delete_fact(self, fact_id: str, user_id: str) -> bool:
        deleted = await self._store.delete_fact(fact_id, user_id)
        if deleted and self._settings.semantic_memory_enabled and self._vector_store:
            await self._vector_store.delete(fact_id)
        return deleted

    async def update_fact(self, fact_id: str, user_id: str, key: str, value: str) -> bool:
        updated = await self._store.update_fact(fact_id, user_id, key, value)
        if updated and self._settings.semantic_memory_enabled and self._vector_store:
            fact_text = f"{key}: {value}"
            await self._vector_store.upsert(
                id=fact_id,
                text=fact_text,
                metadata={"type": "fact", "user_id": user_id}
            )
        return updated

    async def get_facts(self, user_id: str) -> list[Fact]:
        return await self._store.get_facts(user_id)

    # =========================================================================
    # Preferences
    # =========================================================================

    async def delete_preference(self, pref_id: str, user_id: str) -> bool:
        deleted = await self._store.delete_preference(pref_id, user_id)
        if deleted and self._settings.semantic_memory_enabled and self._vector_store:
            await self._vector_store.delete(pref_id)
        return deleted

    async def upsert_preference(
        self,
        user_id: str,
        category: str,
        value: str,
        confidence: str = "low",
        source_kind: str = "conversation",
        source_ref: Optional[str] = None,
    ) -> None:
        """
        Store or update an inferred user preference.

        Args:
            user_id:    Target user.
            category:   Slug (e.g., "tone", "verbosity", "wake_time").
            value:      JSON-encoded string or plain text.
            confidence: "low" | "medium" | "high"
            source_kind: "conversation" | "note" | "manual" | "distiller" | "habit_inference"
            source_ref: Session ID, note path, etc.
        """
        existing = await self._store.get_preference_by_category_and_value(user_id, category.lower().strip(), value)
        pref_id = existing.id if existing else str(uuid.uuid4())

        pref = Preference(
            id=pref_id,
            user_id=user_id,
            category=category.lower().strip(),
            value=value,
            confidence=confidence,
            source_kind=source_kind,
            source_ref=source_ref,
        )
        await self._store.upsert_preference(pref)
        logger.debug(
            "Preference upserted to SQLite (user=%s, category=%s).",
            user_id,
            category)

        if self._settings.semantic_memory_enabled and self._vector_store:
            pref_text = f"Preference - {category}: {value}"
            await self._vector_store.upsert(
                id=pref_id,
                text=pref_text,
                metadata={"type": "preference", "user_id": user_id}
            )

    async def update_preference(self, pref_id: str, user_id: str, category: str, value: str) -> bool:
        updated = await self._store.update_preference(pref_id, user_id, category, value)
        if updated and self._settings.semantic_memory_enabled and self._vector_store:
            pref_text = f"Preference - {category}: {value}"
            await self._vector_store.upsert(
                id=pref_id,
                text=pref_text,
                metadata={"type": "preference", "user_id": user_id}
            )
        return updated

    async def get_preferences(self, user_id: str) -> list[Preference]:
        return await self._store.get_preferences(user_id)

    async def get_pending_habits(self, user_id: str) -> list[dict]:
        return await self._store.get_pending_habits(user_id)

    async def delete_pending_habit(self, habit_id: str, user_id: str) -> bool:
        return await self._store.delete_pending_habit(habit_id, user_id)

    async def save_pending_habit(
        self,
        user_id: str,
        pattern: str,
        confidence: str = "low",
        kind: str = "habit",
        payload: Optional[str] = None
    ) -> None:
        """
        Store an inferred preference for later human approval.
        """
        await self._store.save_pending_habit(user_id, pattern, confidence, kind, payload)
        logger.debug("Pending habit recorded (user=%s).", user_id)

    # =========================================================================
    # Summaries
    # =========================================================================

    async def delete_summary(self, summary_id: str, user_id: str) -> bool:
        deleted = await self._store.delete_summary(summary_id, user_id)
        if deleted and self._settings.semantic_memory_enabled and self._vector_store:
            await self._vector_store.delete(summary_id)
        return deleted

    async def record_summary(
        self,
        user_id: str,
        summary_text: str,
        ttl_setting: Optional[str] = None,
        source_kind: str = "conversation",
        source_ref: Optional[str] = None,
    ) -> None:
        """
        Persist a conversation summary at session end.

        Args:
            user_id:      Target user.
            summary_text: 2-3 sentence summary of the conversation.
            ttl_setting:  Override the user's default TTL for this summary.
                          None uses the user's current default_ttl setting.
            source_kind: "conversation" | "note" | "manual" | "distiller" | "habit_inference"
            source_ref: Session ID, note path, etc.

        Raises:
            ValueError: If ttl_setting is provided but not a valid TTLOption.
        """
        mem_settings = await self._store.get_memory_settings(user_id)
        if not mem_settings.summaries_enabled:
            logger.debug("Summaries disabled for user=%s, skipping.", user_id)
            return

        effective_ttl = ttl_setting or mem_settings.default_ttl
        if not TTLOption.is_valid(effective_ttl):
            raise ValueError(
                f"Invalid TTL setting '{effective_ttl}'. Valid: {
                    TTLOption.ALL}"
            )

        expires_at = calculate_expires_at(effective_ttl)

        summary = ConversationSummary(
            id=str(uuid.uuid4()),
            user_id=user_id,
            summary=summary_text.strip(),
            ttl_setting=effective_ttl,
            expires_at=expires_at,
            source_kind=source_kind,
            source_ref=source_ref,
        )
        await self._store.save_summary(summary)
        
        if self._settings.semantic_memory_enabled and self._vector_store:
            await self._vector_store.upsert(
                id=summary.id,
                text=summary.summary,
                metadata={
                    "type": "summary",
                    "user_id": user_id,
                }
            )
        logger.info(
            "Summary recorded (user=%s, ttl=%s, expires=%s).",
            user_id,
            effective_ttl,
            expires_at.isoformat() if expires_at else "never",
        )

    # =========================================================================
    # Settings
    # =========================================================================

    async def get_memory_settings(self, user_id: str) -> MemorySettings:
        return await self._store.get_memory_settings(user_id)

    async def save_memory_settings(self, settings: MemorySettings) -> None:
        await self._store.save_memory_settings(settings)

    # =========================================================================
    # LLM settings
    # =========================================================================

    async def get_llm_settings(self, user_id: str):
        return await self._store.get_llm_settings(user_id)

    async def save_llm_settings(self, settings) -> None:
        await self._store.save_llm_settings(settings)

    # =========================================================================
    # Cleanup
    # =========================================================================

    async def cleanup_expired(self, user_id: str) -> int:
        """
        Sweep and delete all expired summaries for a user.

        Returns:
            Number of rows deleted.
        """
        deleted_ids = await self._store.delete_expired_summaries(user_id)
        if deleted_ids:
            if self._settings.semantic_memory_enabled and self._vector_store:
                for d_id in deleted_ids:
                    await self._vector_store.delete(d_id)
            logger.info(
                "Cleaned up %d expired summary(s) for user=%s.", len(deleted_ids), user_id
            )
        return len(deleted_ids)
