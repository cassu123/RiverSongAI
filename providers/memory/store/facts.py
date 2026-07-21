# =============================================================================
# providers/memory/store/facts.py
#
# File Purpose:
#   Facts, preferences, pending habits and conversation summaries.
#   FactsStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime
from typing import List, Optional

from providers.memory.models import (
    ConversationSummary,
    Fact,
    Preference,
)
from providers.memory.ttl_engine import calculate_expires_at
from providers.memory.store._util import (
    _dt_to_str,
    _now_str,
    _str_to_dt,
)


class FactsStoreMixin:
    """Facts, preferences, pending habits and conversation summaries.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

    # -------------------------------------------------------------------------
    # Facts
    # -------------------------------------------------------------------------

    async def upsert_fact(self, fact: Fact) -> None:
        """Insert or replace a fact. UNIQUE(user_id, key) triggers replacement."""
        await self._run(self._sync_upsert_fact, fact)

    def _sync_upsert_fact(self, fact: Fact) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            """
            INSERT INTO facts (id, user_id, key, value, source, source_kind, source_ref, created_at, updated_at)
            VALUES (:id, :user_id, :key, :value, :source, :source_kind, :source_ref, :created_at, :updated_at)
            ON CONFLICT(user_id, key) DO UPDATE SET
                value      = excluded.value,
                source     = excluded.source,
                source_kind = excluded.source_kind,
                source_ref = excluded.source_ref,
                updated_at = excluded.updated_at
            """,
            {
                "id": fact.id,
                "user_id": fact.user_id,
                "key": fact.key,
                "value": fact.value,
                "source": fact.source,
                "source_kind": fact.source_kind,
                "source_ref": fact.source_ref,
                "created_at": _dt_to_str(fact.created_at) or now,
                "updated_at": now,
            },
        )
        conn.commit()

    async def get_facts(self, user_id: str) -> List[Fact]:
        return await self._run(self._sync_get_facts, user_id)

    def _sync_get_facts(self, user_id: str) -> List[Fact]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM facts WHERE user_id = ? ORDER BY key",
            (user_id,),
        ).fetchall()
        return [
            Fact(
                id=r["id"],
                user_id=r["user_id"],
                key=r["key"],
                value=r["value"],
                source=r["source"],
                source_kind=r["source_kind"],
                source_ref=r["source_ref"],
                created_at=_str_to_dt(r["created_at"]),  # type: ignore
                updated_at=_str_to_dt(r["updated_at"]),  # type: ignore
            )
            for r in rows
        ]

    async def get_fact_by_key(self, user_id: str, key: str) -> Optional[Fact]:
        return await self._run(self._sync_get_fact_by_key, user_id, key)

    def _sync_get_fact_by_key(self, user_id: str, key: str) -> Optional[Fact]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM facts WHERE user_id = ? AND key = ?",
            (user_id, key.lower().strip()),
        ).fetchone()
        if not row:
            return None
        return Fact(
            id=row["id"],
            user_id=row["user_id"],
            key=row["key"],
            value=row["value"],
            source=row["source"],
            source_kind=row["source_kind"],
            source_ref=row["source_ref"],
            created_at=_str_to_dt(row["created_at"]),  # type: ignore
            updated_at=_str_to_dt(row["updated_at"]),  # type: ignore
        )

    async def get_fact_by_id(self, user_id: str, fact_id: str) -> Optional[Fact]:
        return await self._run(self._sync_get_fact_by_id, user_id, fact_id)

    def _sync_get_fact_by_id(self, user_id: str, fact_id: str) -> Optional[Fact]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM facts WHERE user_id = ? AND id = ?",
            (user_id, fact_id),
        ).fetchone()
        if not row:
            return None
        return Fact(
            id=row["id"],
            user_id=row["user_id"],
            key=row["key"],
            value=row["value"],
            source=row["source"],
            source_kind=row["source_kind"],
            source_ref=row["source_ref"],
            created_at=_str_to_dt(row["created_at"]),  # type: ignore
            updated_at=_str_to_dt(row["updated_at"]),  # type: ignore
        )

    async def update_fact(self, fact_id: str, user_id: str, key: str, value: str) -> bool:
        return await self._run(self._sync_update_fact, fact_id, user_id, key, value)
        
    def _sync_update_fact(self, fact_id: str, user_id: str, key: str, value: str) -> bool:
        conn = self._get_conn()
        now = _now_str()
        res = conn.execute(
            """
            UPDATE facts 
            SET key = ?, value = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (key.lower().strip(), value.strip(), now, fact_id, user_id)
        )
        conn.commit()
        return res.rowcount > 0

    async def delete_fact(self, fact_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_fact, fact_id, user_id)

    def _sync_delete_fact(self, fact_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute(
            "DELETE FROM facts WHERE id = ? AND user_id = ?", (fact_id, user_id))
        conn.commit()
        return res.rowcount > 0

    # -------------------------------------------------------------------------
    # Preferences
    # -------------------------------------------------------------------------

    async def upsert_preference(self, pref: Preference) -> None:
        """
        Insert or update a user preference.
        UNIQUE(user_id, category, value) triggers replacement (ON CONFLICT).
        Multiple values per category are supported.
        """
        await self._run(self._sync_upsert_preference, pref)

    def _sync_upsert_preference(self, pref: Preference) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            """
            INSERT INTO preferences (id, user_id, category, value, confidence, source_kind, source_ref, last_updated)
            VALUES (:id, :user_id, :category, :value, :confidence, :source_kind, :source_ref, :last_updated)
            ON CONFLICT(user_id, category, value) DO UPDATE SET
                confidence   = excluded.confidence,
                source_kind  = excluded.source_kind,
                source_ref   = excluded.source_ref,
                last_updated = excluded.last_updated
            """,
            {
                "id": pref.id,
                "user_id": pref.user_id,
                "category": pref.category,
                "value": pref.value,
                "confidence": pref.confidence,
                "source_kind": pref.source_kind,
                "source_ref": pref.source_ref,
                "last_updated": _dt_to_str(pref.last_updated) or now,
            },
        )
        conn.commit()

    async def get_preferences(self, user_id: str) -> List[Preference]:
        return await self._run(self._sync_get_preferences, user_id)

    def _sync_get_preferences(self, user_id: str) -> List[Preference]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM preferences WHERE user_id = ? ORDER BY category",
            (user_id,),
        ).fetchall()
        return [
            Preference(
                id=r["id"],
                user_id=r["user_id"],
                category=r["category"],
                value=r["value"],
                confidence=r["confidence"],
                source_kind=r["source_kind"],
                source_ref=r["source_ref"],
                last_updated=_str_to_dt(r["last_updated"]),  # type: ignore
            )
            for r in rows
        ]

    # -------------------------------------------------------------------------
    # Pending Habits
    # -------------------------------------------------------------------------

    async def save_pending_habit(
            self, user_id: str, pattern: str, confidence: str = "low", kind: str = "habit", payload: Optional[str] = None) -> None:
        await self._run(self._sync_save_pending_habit, user_id, pattern, confidence, kind, payload)

    def _sync_save_pending_habit(
            self, user_id: str, pattern: str, confidence: str, kind: str, payload: Optional[str]) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO pending_habits (id, user_id, pattern, confidence, kind, payload, created_at) VALUES (?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), user_id, pattern, confidence, kind, payload, _now_str()),
        )
        conn.commit()

    async def get_pending_habits(self, user_id: str) -> List[dict]:
        return await self._run(self._sync_get_pending_habits, user_id)

    def _sync_get_pending_habits(self, user_id: str) -> List[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM pending_habits WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    async def delete_pending_habit(self, habit_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_pending_habit, habit_id, user_id)

    def _sync_delete_pending_habit(self, habit_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute(
            "DELETE FROM pending_habits WHERE id = ? AND user_id = ?", (habit_id, user_id))
        conn.commit()
        return res.rowcount > 0

    async def get_preference_by_category_and_value(self, user_id: str, category: str, value: str) -> Optional[Preference]:
        return await self._run(self._sync_get_preference_by_category_and_value, user_id, category, value)

    def _sync_get_preference_by_category_and_value(self, user_id: str, category: str, value: str) -> Optional[Preference]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM preferences WHERE user_id = ? AND category = ? AND value = ?",
            (user_id, category.lower().strip(), value),
        ).fetchone()
        if not row:
            return None
        return Preference(
            id=row["id"],
            user_id=row["user_id"],
            category=row["category"],
            value=row["value"],
            confidence=row["confidence"],
            source_kind=row["source_kind"],
            source_ref=row["source_ref"],
            last_updated=_str_to_dt(row["last_updated"]),  # type: ignore
        )

    async def get_preference_by_id(self, user_id: str, pref_id: str) -> Optional[Preference]:
        return await self._run(self._sync_get_preference_by_id, user_id, pref_id)

    def _sync_get_preference_by_id(self, user_id: str, pref_id: str) -> Optional[Preference]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM preferences WHERE user_id = ? AND id = ?",
            (user_id, pref_id),
        ).fetchone()
        if not row:
            return None
        return Preference(
            id=row["id"],
            user_id=row["user_id"],
            category=row["category"],
            value=row["value"],
            confidence=row["confidence"],
            source_kind=row["source_kind"],
            source_ref=row["source_ref"],
            last_updated=_str_to_dt(row["last_updated"]),  # type: ignore
        )

    async def update_preference(self, pref_id: str, user_id: str, category: str, value: str) -> bool:
        return await self._run(self._sync_update_preference, pref_id, user_id, category, value)

    def _sync_update_preference(self, pref_id: str, user_id: str, category: str, value: str) -> bool:
        conn = self._get_conn()
        now = _now_str()
        res = conn.execute(
            """
            UPDATE preferences 
            SET category = ?, value = ?, last_updated = ?
            WHERE id = ? AND user_id = ?
            """,
            (category.lower().strip(), value, now, pref_id, user_id)
        )
        conn.commit()
        return res.rowcount > 0

    async def delete_preference(self, pref_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_preference, pref_id, user_id)

    def _sync_delete_preference(self, pref_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute(
            "DELETE FROM preferences WHERE id = ? AND user_id = ?", (pref_id, user_id))
        conn.commit()
        return res.rowcount > 0

    # -------------------------------------------------------------------------
    # Conversation summaries
    # -------------------------------------------------------------------------

    async def delete_summary(self, summary_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_summary, summary_id, user_id)

    def _sync_delete_summary(self, summary_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute(
            "DELETE FROM conversation_summaries WHERE id = ? AND user_id = ?",
            (summary_id,
             user_id))
        conn.commit()
        return res.rowcount > 0

    async def save_summary(self, summary: ConversationSummary) -> None:
        """Insert a new conversation summary. Generates expires_at from ttl_setting."""
        await self._run(self._sync_save_summary, summary)

    def _sync_save_summary(self, summary: ConversationSummary) -> None:
        conn = self._get_conn()
        expires_at = (
            _dt_to_str(summary.expires_at)
            if summary.expires_at is not None
            else _dt_to_str(calculate_expires_at(summary.ttl_setting))
        )
        conn.execute(
            """
            INSERT INTO conversation_summaries
                (id, user_id, summary, ttl_setting, expires_at,
                 reference_count, last_referenced, source_kind, source_ref, created_at)
            VALUES
                (:id, :user_id, :summary, :ttl_setting, :expires_at,
                 :reference_count, :last_referenced, :source_kind, :source_ref, :created_at)
            """,
            {
                "id": summary.id,
                "user_id": summary.user_id,
                "summary": summary.summary,
                "ttl_setting": summary.ttl_setting,
                "expires_at": expires_at,
                "reference_count": summary.reference_count,
                "last_referenced": _dt_to_str(summary.last_referenced),
                "source_kind": summary.source_kind,
                "source_ref": summary.source_ref,
                "created_at": _dt_to_str(summary.created_at) or _now_str(),
            },
        )
        conn.commit()

    async def get_summary_by_id(self, summary_id: str) -> Optional[ConversationSummary]:
        return await self._run(self._sync_get_summary_by_id, summary_id)

    def _sync_get_summary_by_id(self, summary_id: str) -> Optional[ConversationSummary]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM conversation_summaries WHERE id = ?",
            (summary_id,)
        ).fetchone()
        return self._row_to_summary(row) if row else None

    async def get_recent_summaries(
        self,
        user_id: str,
        limit: int = 10,
    ) -> List[ConversationSummary]:
        """
        Return the N most-recent non-expired summaries for a user.
        Expired summaries are excluded (lazy expiry -- they stay in DB until swept).
        """
        return await self._run(self._sync_get_recent_summaries, user_id, limit)

    def _sync_get_recent_summaries(
        self,
        user_id: str,
        limit: int,
    ) -> List[ConversationSummary]:
        conn = self._get_conn()
        now = _now_str()
        rows = conn.execute(
            """
            SELECT * FROM conversation_summaries
            WHERE user_id = ?
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, now, limit),
        ).fetchall()
        return [self._row_to_summary(r) for r in rows]

    async def update_summary_ttl(
        self,
        summary_id: str,
        new_expires_at: Optional[datetime],
    ) -> None:
        """
        Reset a summary's expiry and increment its reference_count + last_referenced.
        Called by MemoryManager when auto_extend is enabled.
        """
        await self._run(self._sync_update_summary_ttl, summary_id, new_expires_at)

    def _sync_update_summary_ttl(
        self,
        summary_id: str,
        new_expires_at: Optional[datetime],
    ) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            UPDATE conversation_summaries
            SET expires_at      = :expires_at,
                reference_count = reference_count + 1,
                last_referenced = :now
            WHERE id = :id
            """,
            {
                "expires_at": _dt_to_str(new_expires_at),
                "now": _now_str(),
                "id": summary_id,
            },
        )
        conn.commit()

    async def delete_expired_summaries(self, user_id: str) -> list[str]:
        """
        Bulk-delete all expired summaries for a user.
        Returns the list of deleted summary IDs.
        """
        return await self._run(self._sync_delete_expired, user_id)

    def _sync_delete_expired(self, user_id: str) -> list[str]:
        conn = self._get_conn()
        now = _now_str()
        
        # First, get the IDs of the rows that will be deleted
        cursor = conn.execute(
            """
            SELECT id FROM conversation_summaries
            WHERE user_id = ?
              AND expires_at IS NOT NULL
              AND expires_at < ?
            """,
            (user_id, now),
        )
        deleted_ids = [row["id"] for row in cursor.fetchall()]
        
        if not deleted_ids:
            return []
            
        # Then delete them
        conn.execute(
            """
            DELETE FROM conversation_summaries
            WHERE user_id = ?
              AND expires_at IS NOT NULL
              AND expires_at < ?
            """,
            (user_id, now),
        )
        conn.commit()
        return deleted_ids

    @staticmethod
    def _row_to_summary(r: sqlite3.Row) -> ConversationSummary:
        return ConversationSummary(
            id=r["id"],
            user_id=r["user_id"],
            summary=r["summary"],
            ttl_setting=r["ttl_setting"],
            expires_at=_str_to_dt(r["expires_at"]),
            reference_count=r["reference_count"],
            last_referenced=_str_to_dt(r["last_referenced"]),
            source_kind=r["source_kind"],
            source_ref=r["source_ref"],
            created_at=_str_to_dt(r["created_at"]),  # type: ignore
        )

