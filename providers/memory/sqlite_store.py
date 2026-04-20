# =============================================================================
# providers/memory/sqlite_store.py
#
# File Purpose:
#   SQLite persistence layer for all three memory tiers (facts, preferences,
#   conversation summaries) plus per-user settings tables.
#   Schema mirrors Firestore document structure for zero-friction cloud migration.
#
# Key Classes/Functions:
#   SQLiteStore             -- main store class, manages connection lifecycle
#     .initialize()         -- create all tables if not exist
#     .upsert_fact()        -- insert or replace a fact by (user_id, key)
#     .get_facts()          -- all facts for a user
#     .delete_fact()        -- remove a fact by id
#     .upsert_preference()  -- insert or replace a preference by (user_id, category)
#     .get_preferences()    -- all preferences for a user
#     .save_summary()       -- insert a new conversation summary
#     .get_recent_summaries() -- N most-recent non-expired summaries for a user
#     .update_summary_ttl() -- set new expires_at + increment reference_count
#     .delete_expired_summaries() -- bulk delete all expired rows
#     .get_memory_settings() -- fetch or create default MemorySettings for a user
#     .save_memory_settings() -- persist MemorySettings for a user
#     .get_llm_settings()   -- fetch or create default LLMSettings for a user
#     .save_llm_settings()  -- persist LLMSettings for a user
#
# Dependencies:
#   sqlite3 (stdlib)
#   providers.memory.models (all dataclasses + TTLOption)
#   providers.memory.ttl_engine (calculate_expires_at)
#
# Usage Example:
#   store = SQLiteStore("river_song.db")
#   await store.initialize()
#   await store.upsert_fact(Fact(id=str(uuid4()), user_id="alice", key="name", value="Alice"))
#   facts = await store.get_facts("alice")
# =============================================================================

from __future__ import annotations

import asyncio
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator, List, Optional

from providers.memory.models import (
    ConversationSummary,
    Fact,
    LLMSettings,
    MemorySettings,
    Preference,
    TTLOption,
)
from providers.memory.ttl_engine import calculate_expires_at


# =============================================================================
# Schema SQL
# =============================================================================
#
# All tables include created_at and updated_at in ISO-8601 UTC strings so that
# they are directly portable to Firestore timestamp fields.
# UNIQUE constraints enforce the same uniqueness rules that Firestore document
# IDs would enforce (one document per logical key per user).
# =============================================================================

_DDL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS facts (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'explicit',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS preferences (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    category     TEXT NOT NULL,
    value        TEXT NOT NULL,
    confidence   TEXT NOT NULL DEFAULT 'low',
    last_updated TEXT NOT NULL,
    UNIQUE(user_id, category)
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    summary         TEXT NOT NULL,
    ttl_setting     TEXT NOT NULL DEFAULT 'standard',
    expires_at      TEXT,
    reference_count INTEGER NOT NULL DEFAULT 0,
    last_referenced TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_user_expires
    ON conversation_summaries(user_id, expires_at);

CREATE TABLE IF NOT EXISTS memory_settings (
    user_id            TEXT PRIMARY KEY,
    summaries_enabled  INTEGER NOT NULL DEFAULT 1,
    default_ttl        TEXT NOT NULL DEFAULT 'standard',
    auto_extend        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS llm_settings (
    user_id                 TEXT PRIMARY KEY,
    provider                TEXT NOT NULL DEFAULT 'ollama',
    model                   TEXT NOT NULL DEFAULT 'llama3.2:3b',
    cloud_fallback_enabled  INTEGER NOT NULL DEFAULT 0,
    cloud_fallback_provider TEXT,
    cloud_fallback_model    TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    is_approved   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    trigger     TEXT NOT NULL DEFAULT 'manual',
    time        TEXT,
    days        TEXT NOT NULL DEFAULT '[]',
    prompt      TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
"""


# =============================================================================
# DateTime helpers
# =============================================================================

def _dt_to_str(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _str_to_dt(s: Optional[str]) -> Optional[datetime]:
    if s is None:
        return None
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _now_str() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# =============================================================================
# SQLiteStore
# =============================================================================

class SQLiteStore:
    """
    Async-friendly SQLite persistence layer for the River Song memory system.

    All public methods are async; blocking SQLite I/O runs in a thread pool
    so the FastAPI event loop is never blocked.
    """

    def __init__(self, db_path: str = "river_song.db") -> None:
        self._db_path = db_path
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sqlite")
        self._conn: Optional[sqlite3.Connection] = None

    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------

    async def initialize(self) -> None:
        """Create all tables. Safe to call on every startup (IF NOT EXISTS)."""
        await self._run(self._sync_initialize)

    def _sync_initialize(self) -> None:
        conn = self._get_conn()
        conn.executescript(_DDL)
        # Migration: add is_approved if missing (existing databases)
        try:
            conn.execute("ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        except Exception:
            pass  # column already exists

    def close(self) -> None:
        """Close the connection and shut down the thread pool."""
        if self._conn:
            self._conn.close()
            self._conn = None
        self._executor.shutdown(wait=False)

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                self._db_path,
                check_same_thread=False,
                detect_types=sqlite3.PARSE_DECLTYPES,
            )
            self._conn.row_factory = sqlite3.Row
        return self._conn

    async def _run(self, fn, *args):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, fn, *args)

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
            INSERT INTO facts (id, user_id, key, value, source, created_at, updated_at)
            VALUES (:id, :user_id, :key, :value, :source, :created_at, :updated_at)
            ON CONFLICT(user_id, key) DO UPDATE SET
                value      = excluded.value,
                source     = excluded.source,
                updated_at = excluded.updated_at
            """,
            {
                "id":         fact.id,
                "user_id":    fact.user_id,
                "key":        fact.key,
                "value":      fact.value,
                "source":     fact.source,
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
                created_at=_str_to_dt(r["created_at"]),
                updated_at=_str_to_dt(r["updated_at"]),
            )
            for r in rows
        ]

    async def delete_fact(self, fact_id: str) -> None:
        await self._run(self._sync_delete_fact, fact_id)

    def _sync_delete_fact(self, fact_id: str) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
        conn.commit()

    # -------------------------------------------------------------------------
    # Preferences
    # -------------------------------------------------------------------------

    async def upsert_preference(self, pref: Preference) -> None:
        """Insert or replace a preference. UNIQUE(user_id, category) triggers replacement."""
        await self._run(self._sync_upsert_preference, pref)

    def _sync_upsert_preference(self, pref: Preference) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            """
            INSERT INTO preferences (id, user_id, category, value, confidence, last_updated)
            VALUES (:id, :user_id, :category, :value, :confidence, :last_updated)
            ON CONFLICT(user_id, category) DO UPDATE SET
                value        = excluded.value,
                confidence   = excluded.confidence,
                last_updated = excluded.last_updated
            """,
            {
                "id":           pref.id,
                "user_id":      pref.user_id,
                "category":     pref.category,
                "value":        pref.value,
                "confidence":   pref.confidence,
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
                last_updated=_str_to_dt(r["last_updated"]),
            )
            for r in rows
        ]

    # -------------------------------------------------------------------------
    # Conversation summaries
    # -------------------------------------------------------------------------

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
                 reference_count, last_referenced, created_at)
            VALUES
                (:id, :user_id, :summary, :ttl_setting, :expires_at,
                 :reference_count, :last_referenced, :created_at)
            """,
            {
                "id":              summary.id,
                "user_id":         summary.user_id,
                "summary":         summary.summary,
                "ttl_setting":     summary.ttl_setting,
                "expires_at":      expires_at,
                "reference_count": summary.reference_count,
                "last_referenced": _dt_to_str(summary.last_referenced),
                "created_at":      _dt_to_str(summary.created_at) or _now_str(),
            },
        )
        conn.commit()

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
                "now":        _now_str(),
                "id":         summary_id,
            },
        )
        conn.commit()

    async def delete_expired_summaries(self, user_id: str) -> int:
        """
        Bulk-delete all expired summaries for a user.
        Returns the number of rows deleted.
        """
        return await self._run(self._sync_delete_expired, user_id)

    def _sync_delete_expired(self, user_id: str) -> int:
        conn = self._get_conn()
        now = _now_str()
        cursor = conn.execute(
            """
            DELETE FROM conversation_summaries
            WHERE user_id = ?
              AND expires_at IS NOT NULL
              AND expires_at < ?
            """,
            (user_id, now),
        )
        conn.commit()
        return cursor.rowcount

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
            created_at=_str_to_dt(r["created_at"]),
        )

    # -------------------------------------------------------------------------
    # Memory settings
    # -------------------------------------------------------------------------

    async def get_memory_settings(self, user_id: str) -> MemorySettings:
        """Fetch settings for user, or return defaults if not yet saved."""
        return await self._run(self._sync_get_memory_settings, user_id)

    def _sync_get_memory_settings(self, user_id: str) -> MemorySettings:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM memory_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return MemorySettings(user_id=user_id)
        return MemorySettings(
            user_id=row["user_id"],
            summaries_enabled=bool(row["summaries_enabled"]),
            default_ttl=row["default_ttl"],
            auto_extend=bool(row["auto_extend"]),
        )

    async def save_memory_settings(self, settings: MemorySettings) -> None:
        await self._run(self._sync_save_memory_settings, settings)

    def _sync_save_memory_settings(self, settings: MemorySettings) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO memory_settings
                (user_id, summaries_enabled, default_ttl, auto_extend)
            VALUES (:user_id, :summaries_enabled, :default_ttl, :auto_extend)
            ON CONFLICT(user_id) DO UPDATE SET
                summaries_enabled = excluded.summaries_enabled,
                default_ttl       = excluded.default_ttl,
                auto_extend       = excluded.auto_extend
            """,
            {
                "user_id":           settings.user_id,
                "summaries_enabled": int(settings.summaries_enabled),
                "default_ttl":       settings.default_ttl,
                "auto_extend":       int(settings.auto_extend),
            },
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # LLM settings
    # -------------------------------------------------------------------------

    async def get_llm_settings(self, user_id: str) -> LLMSettings:
        """Fetch LLM settings for user, or return defaults (ollama / llama3.2:3b)."""
        return await self._run(self._sync_get_llm_settings, user_id)

    def _sync_get_llm_settings(self, user_id: str) -> LLMSettings:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM llm_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return LLMSettings(user_id=user_id)
        return LLMSettings(
            user_id=row["user_id"],
            provider=row["provider"],
            model=row["model"],
            cloud_fallback_enabled=bool(row["cloud_fallback_enabled"]),
            cloud_fallback_provider=row["cloud_fallback_provider"],
            cloud_fallback_model=row["cloud_fallback_model"],
        )

    async def save_llm_settings(self, settings: LLMSettings) -> None:
        await self._run(self._sync_save_llm_settings, settings)

    def _sync_save_llm_settings(self, settings: LLMSettings) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO llm_settings
                (user_id, provider, model, cloud_fallback_enabled,
                 cloud_fallback_provider, cloud_fallback_model)
            VALUES
                (:user_id, :provider, :model, :cloud_fallback_enabled,
                 :cloud_fallback_provider, :cloud_fallback_model)
            ON CONFLICT(user_id) DO UPDATE SET
                provider                = excluded.provider,
                model                   = excluded.model,
                cloud_fallback_enabled  = excluded.cloud_fallback_enabled,
                cloud_fallback_provider = excluded.cloud_fallback_provider,
                cloud_fallback_model    = excluded.cloud_fallback_model
            """,
            {
                "user_id":                 settings.user_id,
                "provider":                settings.provider,
                "model":                   settings.model,
                "cloud_fallback_enabled":  int(settings.cloud_fallback_enabled),
                "cloud_fallback_provider": settings.cloud_fallback_provider,
                "cloud_fallback_model":    settings.cloud_fallback_model,
            },
        )
        conn.commit()

    # =========================================================================
    # User auth methods
    # =========================================================================

    async def create_user(self, id: str, email: str, password_hash: str, display_name: str, role: str = "user", is_approved: bool = False) -> None:
        await self._run(self._sync_create_user, id, email, password_hash, display_name, role, is_approved)

    def _sync_create_user(self, id: str, email: str, password_hash: str, display_name: str, role: str, is_approved: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (id, email, password_hash, display_name, role, int(is_approved), now, now),
        )
        conn.commit()

    async def get_user_by_email(self, email: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_by_email, email)

    def _sync_get_user_by_email(self, email: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, email, password_hash, display_name, role, is_approved, created_at FROM users WHERE email=?",
            (email,),
        ).fetchone()
        if row is None:
            return None
        return {"id": row[0], "email": row[1], "password_hash": row[2], "display_name": row[3], "role": row[4], "is_approved": bool(row[5]), "created_at": row[6]}

    async def get_user_by_id(self, user_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_by_id, user_id)

    def _sync_get_user_by_id(self, user_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, email, display_name, role, is_approved, created_at, password_hash FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {"id": row[0], "email": row[1], "display_name": row[2], "role": row[3], "is_approved": bool(row[4]), "created_at": row[5], "password_hash": row[6]}

    async def email_exists(self, email: str) -> bool:
        return await self._run(self._sync_email_exists, email)

    def _sync_email_exists(self, email: str) -> bool:
        conn = self._get_conn()
        row = conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        return row is not None

    async def has_admin(self) -> bool:
        return await self._run(self._sync_has_admin)

    def _sync_has_admin(self) -> bool:
        conn = self._get_conn()
        row = conn.execute("SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone()
        return row is not None

    async def list_users(self) -> list:
        return await self._run(self._sync_list_users)

    def _sync_list_users(self) -> list:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, email, display_name, role, is_approved, created_at FROM users ORDER BY created_at ASC"
        ).fetchall()
        return [{"id": r[0], "email": r[1], "display_name": r[2], "role": r[3], "is_approved": bool(r[4]), "created_at": r[5]} for r in rows]

    async def update_user(self, user_id: str, role: Optional[str] = None, is_approved: Optional[bool] = None) -> bool:
        return await self._run(self._sync_update_user, user_id, role, is_approved)

    def _sync_update_user(self, user_id: str, role: Optional[str], is_approved: Optional[bool]) -> bool:
        conn = self._get_conn()
        now = _now_str()
        parts, vals = [], []
        if role is not None:
            parts.append("role = ?"); vals.append(role)
        if is_approved is not None:
            parts.append("is_approved = ?"); vals.append(int(is_approved))
        if not parts:
            return False
        parts.append("updated_at = ?"); vals.append(now)
        vals.append(user_id)
        conn.execute(f"UPDATE users SET {', '.join(parts)} WHERE id = ?", vals)
        conn.commit()
        return True

    async def update_user_password(self, user_id: str, password_hash: str) -> None:
        await self._run(self._sync_update_user_password, user_id, password_hash)

    def _sync_update_user_password(self, user_id: str, password_hash: str) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (password_hash, now, user_id)
        )
        conn.commit()

    # =========================================================================
    # Routines
    # =========================================================================

    def _row_to_routine(self, row) -> dict:
        import json
        return {
            "id":         row[0],
            "user_id":    row[1],
            "name":       row[2],
            "trigger":    row[3],
            "time":       row[4],
            "days":       json.loads(row[5] or "[]"),
            "prompt":     row[6],
            "enabled":    bool(row[7]),
            "last_run":   row[8],
            "created_at": row[9],
            "updated_at": row[10],
        }

    async def list_routines(self, user_id: str) -> list:
        return await self._run(self._sync_list_routines, user_id)

    def _sync_list_routines(self, user_id: str) -> list:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id,user_id,name,trigger,time,days,prompt,enabled,last_run,created_at,updated_at FROM routines WHERE user_id=? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [self._row_to_routine(r) for r in rows]

    async def create_routine(self, routine: dict) -> dict:
        return await self._run(self._sync_create_routine, routine)

    def _sync_create_routine(self, routine: dict) -> dict:
        import json
        conn = self._get_conn()
        now = _now_str()
        rid = routine.get("id") or str(uuid.uuid4())
        conn.execute(
            "INSERT INTO routines (id,user_id,name,trigger,time,days,prompt,enabled,last_run,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, routine["user_id"], routine["name"], routine.get("trigger","manual"),
             routine.get("time"), json.dumps(routine.get("days",[])), routine.get("prompt",""),
             int(routine.get("enabled", True)), None, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id,user_id,name,trigger,time,days,prompt,enabled,last_run,created_at,updated_at FROM routines WHERE id=?",
            (rid,),
        ).fetchone()
        return self._row_to_routine(row)

    async def update_routine(self, routine_id: str, user_id: str, fields: dict) -> Optional[dict]:
        return await self._run(self._sync_update_routine, routine_id, user_id, fields)

    def _sync_update_routine(self, routine_id: str, user_id: str, fields: dict) -> Optional[dict]:
        import json
        conn = self._get_conn()
        allowed = {"name", "trigger", "time", "days", "prompt", "enabled", "last_run"}
        parts, vals = [], []
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == "days":
                v = json.dumps(v)
            if k == "enabled":
                v = int(v)
            parts.append(f"{k} = ?"); vals.append(v)
        if not parts:
            return None
        parts.append("updated_at = ?"); vals.append(_now_str())
        vals += [routine_id, user_id]
        conn.execute(f"UPDATE routines SET {', '.join(parts)} WHERE id=? AND user_id=?", vals)
        conn.commit()
        row = conn.execute(
            "SELECT id,user_id,name,trigger,time,days,prompt,enabled,last_run,created_at,updated_at FROM routines WHERE id=? AND user_id=?",
            (routine_id, user_id),
        ).fetchone()
        return self._row_to_routine(row) if row else None

    async def delete_routine(self, routine_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_routine, routine_id, user_id)

    def _sync_delete_routine(self, routine_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute("DELETE FROM routines WHERE id=? AND user_id=?", (routine_id, user_id))
        conn.commit()
        return cur.rowcount > 0

    async def get_enabled_routines(self) -> list:
        return await self._run(self._sync_get_enabled_routines)

    def _sync_get_enabled_routines(self) -> list:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id,user_id,name,trigger,time,days,prompt,enabled,last_run,created_at,updated_at FROM routines WHERE enabled=1",
        ).fetchall()
        return [self._row_to_routine(r) for r in rows]
