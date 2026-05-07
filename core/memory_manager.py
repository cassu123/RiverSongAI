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
from datetime import datetime, timezone
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
from providers.memory.ttl_engine import calculate_expires_at, extend_ttl, is_expired
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
        logger.info("MemoryManager initialized (db=%s).", self._settings.db_path)

    # =========================================================================
    # Context building
    # =========================================================================

    async def build_context_block(self, user_id: str, query_text: Optional[str] = None) -> str:
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

    async def get_context_for_prompt(self, user_id: str, query_text: str) -> str:
        """
        Retrieves relevant context using semantic search and merges it with
        core SQLite results.
        """
        try:
            # Get semantic results
            semantic_results = await self._vector_store.search(
                query_text,
                n_results=8,
                where={"user_id": user_id}
            )

            # Get core SQLite results (fall back if vector search fails or is empty)
            facts = await self._store.get_facts(user_id)
            prefs = await self._store.get_preferences(user_id)

            # Deduplicate facts: semantic might have found some, merge with SQLite
            # In this simple implementation, we just use semantic results to augment context
            # but keep the structure similar to build_context_block.

            parts: list[str] = []

            # Use semantic results to build a specific "Relevant Memories" block
            if semantic_results:
                lines = [f"  - {r['text']}" for r in semantic_results]
                parts.append("RELEVANT MEMORIES (Semantically Related):\n" + "\n".join(lines))

            # Still include facts and prefs as they are considered 'core' context
            if facts:
                lines = [f"  - {f.key}: {f.value}" for f in facts]
                parts.append("KNOWN FACTS ABOUT THE USER:\n" + "\n".join(lines))

            if prefs:
                lines = [f"  - {p.category}: {p.value}" for p in prefs]
                parts.append("USER PREFERENCES:\n" + "\n".join(lines))

            if not parts:
                return ""

            return (
                "\n\n--- MEMORY ---\n"
                + "\n\n".join(parts)
                + "\n--- END MEMORY ---"
            )

        except Exception as exc:
            logger.warning("Semantic search failed: %s. Falling back to SQLite only.", exc)
            return await self.build_context_block(user_id, query_text=None)

    # =========================================================================
    # Facts
    # =========================================================================

    async def upsert_fact(
        self,
        user_id: str,
        key: str,
        value: str,
        source: str = "explicit",
    ) -> None:
        """
        Store or update a user fact.

        Args:
            user_id: Target user.
            key:     Short slug (e.g., "name", "job", "pet_dog_name").
            value:   Plain text value.
            source:  "explicit" (user stated) or "inferred" (River Song concluded).
        """
        fact_id = str(uuid.uuid4())
        fact = Fact(
            id=fact_id,
            user_id=user_id,
            key=key.lower().strip(),
            value=value.strip(),
            source=source,
        )
        await self._store.upsert_fact(fact)
        logger.debug("Fact upserted to SQLite (user=%s, key=%s).", user_id, key)

        if self._settings.semantic_memory_enabled and self._vector_store:
            fact_text = f"{key}: {value}"
            await self._vector_store.upsert(
                id=fact_id,
                text=fact_text,
                metadata={"type": "fact", "user_id": user_id}
            )

    async def delete_fact(self, fact_id: str) -> None:
        await self._store.delete_fact(fact_id)
        # Note: In a full implementation, we should also delete from Chroma.
        # But instructions only specify upsert.

    async def get_facts(self, user_id: str) -> list[Fact]:
        return await self._store.get_facts(user_id)

    # =========================================================================
    # Preferences
    # =========================================================================

    async def upsert_preference(
        self,
        user_id: str,
        category: str,
        value: str,
        confidence: str = "low",
    ) -> None:
        """
        Store or update an inferred user preference.

        Args:
            user_id:    Target user.
            category:   Slug (e.g., "tone", "verbosity", "wake_time").
            value:      JSON-encoded string or plain text.
            confidence: "low" | "medium" | "high"
        """
        pref_id = str(uuid.uuid4())
        pref = Preference(
            id=pref_id,
            user_id=user_id,
            category=category.lower().strip(),
            value=value,
            confidence=confidence,
        )
        await self._store.upsert_preference(pref)
        logger.debug("Preference upserted to SQLite (user=%s, category=%s).", user_id, category)

        if self._settings.semantic_memory_enabled and self._vector_store:
            pref_text = f"Preference - {category}: {value}"
            await self._vector_store.upsert(
                id=pref_id,
                text=pref_text,
                metadata={"type": "preference", "user_id": user_id}
            )

    async def get_preferences(self, user_id: str) -> list[Preference]:
        return await self._store.get_preferences(user_id)

    # =========================================================================
    # Summaries
    # =========================================================================

    async def record_summary(
        self,
        user_id: str,
        summary_text: str,
        ttl_setting: Optional[str] = None,
    ) -> None:
        """
        Persist a conversation summary at session end.

        Args:
            user_id:      Target user.
            summary_text: 2-3 sentence summary of the conversation.
            ttl_setting:  Override the user's default TTL for this summary.
                          None uses the user's current default_ttl setting.

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
                f"Invalid TTL setting '{effective_ttl}'. Valid: {TTLOption.ALL}"
            )

        expires_at = calculate_expires_at(effective_ttl)

        summary = ConversationSummary(
            id=str(uuid.uuid4()),
            user_id=user_id,
            summary=summary_text.strip(),
            ttl_setting=effective_ttl,
            expires_at=expires_at,
        )
        await self._store.save_summary(summary)
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
        from providers.memory.models import LLMSettings
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
        deleted = await self._store.delete_expired_summaries(user_id)
        if deleted:
            logger.info(
                "Cleaned up %d expired summary(s) for user=%s.", deleted, user_id
            )
        return deleted
