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
import json
import os
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import List, Optional

from providers.memory.models import (
    ConversationSummary,
    Fact,
    LLMSettings,
    MemorySettings,
    Preference,
    TTLOption,
    UserPreferences,
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
    UNIQUE(user_id, category, value)
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

CREATE INDEX IF NOT EXISTS idx_summaries_user_id
    ON conversation_summaries(user_id);

CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id);
CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON preferences(user_id);

CREATE TABLE IF NOT EXISTS memory_settings (
    user_id            TEXT PRIMARY KEY,
    summaries_enabled  INTEGER NOT NULL DEFAULT 1,
    default_ttl        TEXT NOT NULL DEFAULT 'standard',
    auto_extend        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_settings (
    user_id                 TEXT PRIMARY KEY,
    provider                TEXT NOT NULL DEFAULT 'ollama',
    model                   TEXT NOT NULL DEFAULT 'llama3.2:3b',
    cloud_fallback_enabled  INTEGER NOT NULL DEFAULT 0,
    cloud_fallback_provider TEXT,
    cloud_fallback_model    TEXT,
    voice_id                TEXT NOT NULL DEFAULT 'river',
    whisper_model           TEXT NOT NULL DEFAULT 'base'
);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    is_approved   INTEGER NOT NULL DEFAULT 0,
    force_password_change INTEGER NOT NULL DEFAULT 0,
    is_suspended  INTEGER NOT NULL DEFAULT 0,
    tokens_valid_after TEXT,
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
    type        TEXT NOT NULL DEFAULT 'simple',
    webhook_url TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_notes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_kind   TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    virtual_path TEXT NOT NULL UNIQUE,
    title        TEXT,
    size         INTEGER,
    mtime        REAL,
    indexed_at   REAL
);

CREATE INDEX IF NOT EXISTS idx_vault_notes_owner ON vault_notes(owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS vault_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    src_note_id  INTEGER NOT NULL,
    target_title TEXT NOT NULL,
    FOREIGN KEY(src_note_id) REFERENCES vault_notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_links_src ON vault_links(src_note_id);
CREATE INDEX IF NOT EXISTS idx_vault_links_target ON vault_links(target_title);

CREATE TABLE IF NOT EXISTS vault_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    action       TEXT NOT NULL,
    virtual_path TEXT NOT NULL,
    ts           REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pulse_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,        -- 'news' | 'markets' | 'flights'
    data_json TEXT NOT NULL,     -- JSON payload, schema varies per source
    ts REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_pulse_snapshots_source_ts ON pulse_snapshots(source, ts DESC);


CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti         TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    revoked_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expiry
    ON revoked_tokens(expires_at);

CREATE TABLE IF NOT EXISTS user_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    service TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, service),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON user_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_integrations_service ON user_integrations(service);

CREATE TABLE IF NOT EXISTS oauth_nonces (
    nonce       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    service     TEXT NOT NULL,
    created_at  REAL NOT NULL,
    expires_at  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires ON oauth_nonces(expires_at);

CREATE TABLE IF NOT EXISTS voice_id_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    identified_user_id TEXT,
    score REAL,
    runner_up_user_id TEXT,
    runner_up_score REAL,
    audio_duration_ms INTEGER,
    session_kind TEXT NOT NULL  -- 'kiosk' or 'authenticated'
);

CREATE INDEX IF NOT EXISTS ix_voice_id_events_ts ON voice_id_events(ts DESC);


CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id           TEXT NOT NULL,
    endpoint          TEXT NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    PRIMARY KEY (user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS feed_preferences (
    user_id             TEXT PRIMARY KEY,
    news_sources        TEXT NOT NULL DEFAULT '[]',
    weather_lat         REAL,
    weather_lon         REAL,
    weather_unit        TEXT NOT NULL DEFAULT 'celsius',
    sport_teams         TEXT NOT NULL DEFAULT '[]',
    stock_tickers       TEXT NOT NULL DEFAULT '[]',
    refresh_news_min    INTEGER NOT NULL DEFAULT 30,
    refresh_weather_min INTEGER NOT NULL DEFAULT 30,
    refresh_sports_min  INTEGER NOT NULL DEFAULT 60,
    refresh_stocks_min  INTEGER NOT NULL DEFAULT 60,
    updated_at          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reading_shelf (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    service          TEXT NOT NULL,
    title            TEXT NOT NULL,
    author           TEXT NOT NULL DEFAULT '',
    cover_url        TEXT NOT NULL DEFAULT '',
    progress_pct     REAL NOT NULL DEFAULT 0.0,
    status           TEXT NOT NULL DEFAULT 'reading',
    rating           INTEGER,
    notes            TEXT NOT NULL DEFAULT '',
    launch_url       TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reading_shelf_user ON reading_shelf(user_id);

CREATE TABLE IF NOT EXISTS pending_habits (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    pattern      TEXT NOT NULL,
    confidence   TEXT NOT NULL DEFAULT 'low',
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_habits_user ON pending_habits(user_id);

CREATE TABLE IF NOT EXISTS admin_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS parent_child (
    parent_id  TEXT NOT NULL,
    child_id   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS child_features (
    child_id         TEXT PRIMARY KEY,
    enabled_features TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS analytics_platforms (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    platform    TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    api_key     TEXT NOT NULL DEFAULT '',
    api_secret  TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, platform)
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    platform    TEXT NOT NULL,
    date        TEXT NOT NULL,
    metrics     TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, platform, date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_platform
    ON analytics_snapshots(user_id, platform, date);

CREATE TABLE IF NOT EXISTS family_groups (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    shared_modules TEXT NOT NULL DEFAULT '["culinary","inventory","store","maintenance"]',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_memberships (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL UNIQUE,
    family_group_id TEXT NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
    relationship    TEXT NOT NULL DEFAULT 'member',
    joined_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fam_memberships_group ON family_memberships(family_group_id);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id        TEXT PRIMARY KEY,
    music_provider TEXT NOT NULL DEFAULT 'youtube_music',
    updated_at     TEXT NOT NULL DEFAULT ''
);
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
        self._executor = ThreadPoolExecutor(
            max_workers=min(4, os.cpu_count() or 1),
            thread_name_prefix="sqlite",
        )
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
        for migration in [
            "ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN google_id TEXT",
            "ALTER TABLE users ADD COLUMN google_email TEXT",
            "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'halo'",
            "ALTER TABLE users ADD COLUMN palette TEXT NOT NULL DEFAULT 'spice'",
            "ALTER TABLE users ADD COLUMN environment TEXT NOT NULL DEFAULT 'atreides'",
            "ALTER TABLE users ADD COLUMN universe TEXT NOT NULL DEFAULT 'dune'",
            "ALTER TABLE users ADD COLUMN mood TEXT NOT NULL DEFAULT 'caladan'",
            "ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN tokens_valid_after TEXT",
            # One-time mapping: legacy palette -> universe (idempotent via default-gate)
            "UPDATE users SET universe='halo' WHERE palette='halo' AND universe='dune'",
            # One-time mapping: legacy theme -> mood (idempotent — only rewrites rows still at default)
            "UPDATE users SET mood='hard-light',     environment='forerunner' WHERE theme='halo'          AND mood='caladan'",
            "UPDATE users SET mood='bloodlight',     environment='harkonnen'  WHERE theme='crimson-dark'  AND mood='caladan'",
            "UPDATE users SET mood='night-vision',   environment='unsc'       WHERE theme='combat'        AND mood='caladan'",
            "UPDATE users SET mood='twilight-spires',environment='spires',  universe='mv'        WHERE theme='midnight-violet' AND mood='caladan'",
            "UPDATE users SET mood='dusk-pavilion',  environment='garden',  universe='mv'        WHERE theme='amber'           AND mood='caladan'",
            "UPDATE users SET mood='daybreak-temple',environment='spires',  universe='mv'        WHERE theme='arctic'          AND mood='caladan'",
            "UPDATE users SET mood='glitch-street',  environment='pacifica',universe='nightcity' WHERE theme='cyberpunk'       AND mood='caladan'",
            "UPDATE users SET mood='spice-hall'                                                 WHERE theme='dune'            AND mood='caladan'",
            "ALTER TABLE llm_settings ADD COLUMN voice_id TEXT NOT NULL DEFAULT 'river'",
            "ALTER TABLE routines ADD COLUMN type TEXT NOT NULL DEFAULT 'simple'",
            "ALTER TABLE routines ADD COLUMN webhook_url TEXT",
            "INSERT OR IGNORE INTO admin_config (key, value) VALUES ('__global__', '{}')",
            # FIX B11: Remove (user_id, category) uniqueness to allow multi-value preferences
            "CREATE TABLE IF NOT EXISTS preferences_new (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, value TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'low', last_updated TEXT NOT NULL, UNIQUE(user_id, category, value))",
            "INSERT OR IGNORE INTO preferences_new SELECT id, user_id, category, value, confidence, last_updated FROM preferences",
            "DROP TABLE preferences",
            "ALTER TABLE preferences_new RENAME TO preferences",
            "CREATE TABLE IF NOT EXISTS vault_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, virtual_path TEXT NOT NULL UNIQUE, title TEXT, size INTEGER, mtime REAL, indexed_at REAL)",
            "CREATE TABLE IF NOT EXISTS vault_links (id INTEGER PRIMARY KEY AUTOINCREMENT, src_note_id INTEGER NOT NULL, target_title TEXT NOT NULL, FOREIGN KEY(src_note_id) REFERENCES vault_notes(id) ON DELETE CASCADE)",
            "CREATE TABLE IF NOT EXISTS vault_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, virtual_path TEXT NOT NULL, ts REAL NOT NULL)",
            "CREATE TABLE IF NOT EXISTS pulse_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, data_json TEXT NOT NULL, ts REAL NOT NULL)",
            "CREATE TABLE IF NOT EXISTS voice_id_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, identified_user_id TEXT, score REAL, runner_up_user_id TEXT, runner_up_score REAL, audio_duration_ms INTEGER, session_kind TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS user_integrations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, service TEXT NOT NULL, access_token TEXT, refresh_token TEXT, token_expires_at TEXT, metadata TEXT NOT NULL DEFAULT '{}', is_active INTEGER NOT NULL DEFAULT 1, connected_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, service), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)",
            "CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY, music_provider TEXT NOT NULL DEFAULT 'youtube_music', updated_at TEXT NOT NULL DEFAULT '')",
            "ALTER TABLE feed_preferences ADD COLUMN sports_favorite_leagues TEXT NOT NULL DEFAULT '[\"nba\",\"nfl\",\"mlb\"]'",
            "ALTER TABLE feed_preferences ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
            # OAuth CSRF nonce store (for /api/integrations/google/callback validation).
            "CREATE TABLE IF NOT EXISTS oauth_nonces (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, service TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires ON oauth_nonces(expires_at)",
            # Hot-path indexes for per-user lookups (audit DATA-001).
            "CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON preferences(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_summaries_user_id ON conversation_summaries(user_id)",
        ]:
            try:
                conn.execute(migration)
                conn.commit()
            except sqlite3.OperationalError:
                pass

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
            # WAL lets readers proceed while a writer holds the lock.
            # busy_timeout retries for up to 5 s before raising SQLITE_BUSY.
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
        return self._conn

    async def _run(self, fn, *args):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, fn, *args)

    # -------------------------------------------------------------------------
    # User Integrations (OAuth)
    # -------------------------------------------------------------------------

    async def get_user_integrations(self, user_id: str) -> List[dict]:
        return await self._run(self._sync_get_user_integrations, user_id)

    def _sync_get_user_integrations(self, user_id: str) -> List[dict]:
        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT service, metadata, is_active FROM user_integrations WHERE user_id = ? AND is_active = 1",
            (user_id,)
        )
        return [{"service": row[0], "metadata": json.loads(row[1]), "is_active": row[2]} for row in cur.fetchall()]

    async def get_user_integration(self, user_id: str, service: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_integration, user_id, service)

    def _sync_get_user_integration(self, user_id: str, service: str) -> Optional[dict]:
        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT access_token, refresh_token, token_expires_at, metadata, is_active FROM user_integrations WHERE user_id = ? AND service = ?",
            (user_id, service)
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "access_token": row[0],
            "refresh_token": row[1],
            "token_expires_at": row[2],
            "metadata": json.loads(row[3]),
            "is_active": row[4]
        }

    async def upsert_user_integration(
        self, user_id: str, service: str, access_token: Optional[str] = None, 
        refresh_token: Optional[str] = None, token_expires_at: Optional[str] = None, 
        metadata: Optional[dict] = None
    ) -> None:
        await self._run(
            self._sync_upsert_user_integration, 
            user_id, service, access_token, refresh_token, token_expires_at, metadata
        )

    def _sync_upsert_user_integration(
        self, user_id: str, service: str, access_token: Optional[str], 
        refresh_token: Optional[str], token_expires_at: Optional[str], metadata: Optional[dict]
    ) -> None:
        conn = self._get_conn()
        cur = conn.cursor()
        
        now = _now_str()
        new_id = str(uuid.uuid4())
        
        cur.execute("SELECT metadata FROM user_integrations WHERE user_id = ? AND service = ?", (user_id, service))
        row = cur.fetchone()
        
        if row:
            meta_str = json.dumps(metadata) if metadata is not None else row[0]
            cur.execute(
                """
                UPDATE user_integrations 
                SET access_token = COALESCE(?, access_token),
                    refresh_token = COALESCE(?, refresh_token),
                    token_expires_at = COALESCE(?, token_expires_at),
                    metadata = ?,
                    is_active = 1,
                    updated_at = ?
                WHERE user_id = ? AND service = ?
                """,
                (access_token, refresh_token, token_expires_at, meta_str, now, user_id, service)
            )
        else:
            meta_str = json.dumps(metadata) if metadata else '{}'
            cur.execute(
                """
                INSERT INTO user_integrations 
                (id, user_id, service, access_token, refresh_token, token_expires_at, metadata, is_active, connected_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (new_id, user_id, service, access_token, refresh_token, token_expires_at, meta_str, now, now)
            )
        conn.commit()

    async def deactivate_user_integration(self, user_id: str, service: str) -> None:
        await self._run(self._sync_deactivate_user_integration, user_id, service)

    def _sync_deactivate_user_integration(self, user_id: str, service: str) -> None:
        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE user_integrations 
            SET is_active = 0, access_token = NULL, refresh_token = NULL, updated_at = ? 
            WHERE user_id = ? AND service = ?
            """,
            (_now_str(), user_id, service)
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # OAuth nonces (CSRF protection for OAuth state parameter)
    # -------------------------------------------------------------------------

    async def put_oauth_nonce(
        self, nonce: str, user_id: str, service: str, ttl_seconds: int = 600
    ) -> None:
        """Store a one-time-use OAuth state nonce. Default TTL 10 minutes."""
        await self._run(self._sync_put_oauth_nonce, nonce, user_id, service, ttl_seconds)

    def _sync_put_oauth_nonce(
        self, nonce: str, user_id: str, service: str, ttl_seconds: int
    ) -> None:
        import time
        conn = self._get_conn()
        now = time.time()
        conn.execute(
            "INSERT INTO oauth_nonces (nonce, user_id, service, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (nonce, user_id, service, now, now + ttl_seconds),
        )
        # Opportunistic GC of expired nonces.
        conn.execute("DELETE FROM oauth_nonces WHERE expires_at < ?", (now,))
        conn.commit()

    async def consume_oauth_nonce(self, nonce: str, service: str) -> Optional[str]:
        """
        Validate, consume (delete), and return the user_id bound to ``nonce``
        for ``service``. Returns None if the nonce is missing, expired, or
        bound to a different service.
        """
        return await self._run(self._sync_consume_oauth_nonce, nonce, service)

    def _sync_consume_oauth_nonce(self, nonce: str, service: str) -> Optional[str]:
        import time
        conn = self._get_conn()
        now = time.time()
        row = conn.execute(
            "SELECT user_id, service, expires_at FROM oauth_nonces WHERE nonce = ?",
            (nonce,),
        ).fetchone()
        if row is None:
            return None
        user_id, row_service, expires_at = row
        # Always delete first — single-use semantics, even on mismatch/expiry.
        conn.execute("DELETE FROM oauth_nonces WHERE nonce = ?", (nonce,))
        conn.commit()
        if row_service != service or expires_at < now:
            return None
        return user_id


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

    async def delete_fact(self, fact_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_fact, fact_id, user_id)

    def _sync_delete_fact(self, fact_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute("DELETE FROM facts WHERE id = ? AND user_id = ?", (fact_id, user_id))
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
            INSERT INTO preferences (id, user_id, category, value, confidence, last_updated)
            VALUES (:id, :user_id, :category, :value, :confidence, :last_updated)
            ON CONFLICT(user_id, category, value) DO UPDATE SET
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
    # Pending Habits
    # -------------------------------------------------------------------------

    async def save_pending_habit(self, user_id: str, pattern: str, confidence: str = "low") -> None:
        await self._run(self._sync_save_pending_habit, user_id, pattern, confidence)

    def _sync_save_pending_habit(self, user_id: str, pattern: str, confidence: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO pending_habits (id, user_id, pattern, confidence, created_at) VALUES (?,?,?,?,?)",
            (str(uuid.uuid4()), user_id, pattern, confidence, _now_str()),
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
        res = conn.execute("DELETE FROM pending_habits WHERE id = ? AND user_id = ?", (habit_id, user_id))
        conn.commit()
        return res.rowcount > 0

    async def delete_preference(self, pref_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_preference, pref_id, user_id)

    def _sync_delete_preference(self, pref_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute("DELETE FROM preferences WHERE id = ? AND user_id = ?", (pref_id, user_id))
        conn.commit()
        return res.rowcount > 0

    # -------------------------------------------------------------------------
    # Conversation summaries
    # -------------------------------------------------------------------------

    async def delete_summary(self, summary_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_summary, summary_id, user_id)

    def _sync_delete_summary(self, summary_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        res = conn.execute("DELETE FROM conversation_summaries WHERE id = ? AND user_id = ?", (summary_id, user_id))
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
            voice_id=row["voice_id"] if "voice_id" in row.keys() else "river",
            whisper_model=row["whisper_model"] if "whisper_model" in row.keys() else "base",
        )

    async def save_llm_settings(self, settings: LLMSettings) -> None:
        await self._run(self._sync_save_llm_settings, settings)

    def _sync_save_llm_settings(self, settings: LLMSettings) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO llm_settings
                (user_id, provider, model, cloud_fallback_enabled,
                 cloud_fallback_provider, cloud_fallback_model, voice_id, whisper_model)
            VALUES
                (:user_id, :provider, :model, :cloud_fallback_enabled,
                 :cloud_fallback_provider, :cloud_fallback_model, :voice_id, :whisper_model)
            ON CONFLICT(user_id) DO UPDATE SET
                provider                = excluded.provider,
                model                   = excluded.model,
                cloud_fallback_enabled  = excluded.cloud_fallback_enabled,
                cloud_fallback_provider = excluded.cloud_fallback_provider,
                cloud_fallback_model    = excluded.cloud_fallback_model,
                voice_id                = excluded.voice_id,
                whisper_model           = excluded.whisper_model
            """,
            {
                "user_id": settings.user_id,
                "provider": settings.provider,
                "model": settings.model,
                "cloud_fallback_enabled": int(settings.cloud_fallback_enabled),
                "cloud_fallback_provider": settings.cloud_fallback_provider,
                "cloud_fallback_model": settings.cloud_fallback_model,
                "voice_id": settings.voice_id,
                "whisper_model": settings.whisper_model,
            },
        )
        conn.commit()
    # -------------------------------------------------------------------------
    # User Preferences
    # -------------------------------------------------------------------------

    async def get_user_preferences(self, user_id: str) -> UserPreferences:
        """Fetch general user preferences, or return defaults."""
        return await self._run(self._sync_get_user_preferences, user_id)

    def _sync_get_user_preferences(self, user_id: str) -> UserPreferences:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM user_preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return UserPreferences(user_id=user_id)
        return UserPreferences(
            user_id=row["user_id"],
            music_provider=row["music_provider"],
        )

    async def save_user_preferences(self, prefs: UserPreferences) -> None:
        """Persist general user preferences."""
        await self._run(self._sync_save_user_preferences, prefs)

    def _sync_save_user_preferences(self, prefs: UserPreferences) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO user_preferences (user_id, music_provider, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                music_provider = excluded.music_provider,
                updated_at     = excluded.updated_at
            """,
            (prefs.user_id, prefs.music_provider, _now_str()),
        )
        conn.commit()


    # -------------------------------------------------------------------------
    # JWT Revocation
    # -------------------------------------------------------------------------

    async def revoke_token(self, jti: str, user_id: str, expires_at: datetime) -> None:
        await self._run(self._sync_revoke_token, jti, user_id, expires_at)

    def _sync_revoke_token(self, jti: str, user_id: str, expires_at: datetime) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO revoked_tokens (jti, user_id, revoked_at, expires_at) VALUES (?,?,?,?)",
            (jti, user_id, _now_str(), _dt_to_str(expires_at)),
        )
        conn.commit()

    async def is_token_revoked(self, jti: str) -> bool:
        return await self._run(self._sync_is_token_revoked, jti)

    def _sync_is_token_revoked(self, jti: str) -> bool:
        conn = self._get_conn()
        row = conn.execute("SELECT 1 FROM revoked_tokens WHERE jti=?", (jti,)).fetchone()
        return row is not None

    async def delete_expired_tokens(self) -> int:
        return await self._run(self._sync_delete_expired_tokens)

    def _sync_delete_expired_tokens(self) -> int:
        conn = self._get_conn()
        res = conn.execute("DELETE FROM revoked_tokens WHERE expires_at < ?", (_now_str(),))
        conn.commit()
        return res.rowcount

    # -------------------------------------------------------------------------
    # CHRONOS Vault
    # -------------------------------------------------------------------------

    async def upsert_vault_note(
        self,
        owner_kind: str,
        owner_id: str,
        virtual_path: str,
        title: str,
        size: int,
        mtime: float,
        links: list[str]
    ) -> None:
        await self._run(self._sync_upsert_vault_note, owner_kind, owner_id, virtual_path, title, size, mtime, links)

    def _sync_upsert_vault_note(
        self,
        owner_kind: str,
        owner_id: str,
        virtual_path: str,
        title: str,
        size: int,
        mtime: float,
        links: list[str]
    ) -> None:
        conn = self._get_conn()
        now = datetime.now(tz=timezone.utc).timestamp()
        
        # 1. Upsert note
        conn.execute(
            """
            INSERT INTO vault_notes (owner_kind, owner_id, virtual_path, title, size, mtime, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(virtual_path) DO UPDATE SET
                title = excluded.title,
                size = excluded.size,
                mtime = excluded.mtime,
                indexed_at = excluded.indexed_at
            """,
            (owner_kind, owner_id, virtual_path, title, size, mtime, now)
        )
        
        # Always fetch the ID by virtual_path to be safe (Task A.2)
        row = conn.execute("SELECT id FROM vault_notes WHERE virtual_path = ?", (virtual_path,)).fetchone()
        note_id = row["id"]

        # 2. Clear old links and insert new ones
        conn.execute("DELETE FROM vault_links WHERE src_note_id = ?", (note_id,))
        for target in links:
            conn.execute("INSERT INTO vault_links (src_note_id, target_title) VALUES (?, ?)", (note_id, target))
            
        conn.commit()

    async def delete_vault_note_by_path(self, virtual_path: str) -> None:
        await self._run(self._sync_delete_vault_note_by_path, virtual_path)

    def _sync_delete_vault_note_by_path(self, virtual_path: str) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM vault_notes WHERE virtual_path = ?", (virtual_path,))
        conn.commit()

    async def get_vault_note_by_path(self, virtual_path: str) -> Optional[dict]:
        return await self._run(self._sync_get_vault_note_by_path, virtual_path)

    def _sync_get_vault_note_by_path(self, virtual_path: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM vault_notes WHERE virtual_path = ?", (virtual_path,)).fetchone()
        return dict(row) if row else None

    async def search_vault_notes(self, user_id: str, query: str, limit: int = 50) -> list[dict]:
        # NOTE: This search doesn't strictly check permissions by owner_id yet. 
        # The caller (VaultProvider) is expected to filter or pass the right constraints.
        return await self._run(self._sync_search_vault_notes, user_id, query, limit)

    def _sync_search_vault_notes(self, user_id: str, query: str, limit: int) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM vault_notes WHERE title LIKE ? AND owner_kind = 'user' AND owner_id = ? LIMIT ?",
            (f"%{query}%", user_id, limit)
        ).fetchall()
        return [dict(r) for r in rows]

    async def list_vault_backlinks(self, title: str) -> list[dict]:
        return await self._run(self._sync_list_vault_backlinks, title)

    def _sync_list_vault_backlinks(self, title: str) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            """
            SELECT vn.virtual_path, vn.title
            FROM vault_notes vn
            JOIN vault_links vl ON vn.id = vl.src_note_id
            WHERE LOWER(vl.target_title) = LOWER(?)
            """,
            (title,)
        ).fetchall()
        return [dict(r) for r in rows]

    async def log_vault_audit(self, user_id: str, action: str, virtual_path: str) -> None:
        await self._run(self._sync_log_vault_audit, user_id, action, virtual_path)

    def _sync_log_vault_audit(self, user_id: str, action: str, virtual_path: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO vault_audit (user_id, action, virtual_path, ts) VALUES (?, ?, ?, ?)",
            (user_id, action, virtual_path, datetime.now(tz=timezone.utc).timestamp())
        )
        conn.commit()

    async def get_vault_graph(self, user_id: str) -> dict:
        return await self._run(self._sync_get_vault_graph, user_id)

    def _sync_get_vault_graph(self, user_id: str) -> dict:
        conn = self._get_conn()
        note_rows = conn.execute(
            "SELECT id, virtual_path, title, owner_kind FROM vault_notes WHERE owner_kind = 'user' AND owner_id = ?",
            (user_id,)
        ).fetchall()

        nodes_by_id   = {r["id"]: dict(r) for r in note_rows}
        title_to_path = {r["title"]: r["virtual_path"] for r in note_rows if r["title"]}

        edge_rows = conn.execute(
            """
            SELECT vl.src_note_id, vl.target_title, vn.virtual_path AS src_path
            FROM vault_links vl
            JOIN vault_notes vn ON vl.src_note_id = vn.id
            WHERE vn.owner_kind = 'user' AND vn.owner_id = ?
            """,
            (user_id,)
        ).fetchall()

        edges       = []
        ghost_nodes = {}

        for row in edge_rows:
            src_path     = row["src_path"]
            target_title = row["target_title"]
            target_path  = title_to_path.get(target_title)

            if target_path:
                edges.append({"source": src_path, "target": target_path})
            else:
                gid = f"ghost:{target_title}"
                if gid not in ghost_nodes:
                    ghost_nodes[gid] = {
                        "id": gid, "virtual_path": None,
                        "title": target_title, "owner_kind": "ghost", "ghost": True,
                    }
                edges.append({"source": src_path, "target": gid})

        nodes = [
            {
                "id":           n["virtual_path"],
                "virtual_path": n["virtual_path"],
                "title":        n["title"] or n["virtual_path"].split("/")[-1].replace(".md", ""),
                "owner_kind":   n["owner_kind"],
                "ghost":        False,
            }
            for n in nodes_by_id.values()
        ]
        nodes.extend(ghost_nodes.values())

        return {"nodes": nodes, "edges": edges}

    # -------------------------------------------------------------------------
    # Pulse Snapshots
    # -------------------------------------------------------------------------

    async def save_pulse_snapshot(self, source: str, data: dict) -> None:
        await self._run(self._sync_save_pulse_snapshot, source, data)

    def _sync_save_pulse_snapshot(self, source: str, data: dict) -> None:
        conn = self._get_conn()
        now = datetime.now(tz=timezone.utc).timestamp()
        conn.execute(
            "INSERT INTO pulse_snapshots (source, data_json, ts) VALUES (?, ?, ?)",
            (source, json.dumps(data), now)
        )
        conn.commit()

    async def get_latest_pulse_snapshot(self, source: str) -> Optional[dict]:
        return await self._run(self._sync_get_latest_pulse_snapshot, source)

    def _sync_get_latest_pulse_snapshot(self, source: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM pulse_snapshots WHERE source = ? ORDER BY ts DESC LIMIT 1",
            (source,)
        ).fetchone()
        if not row: return None
        return {
            "source": row["source"],
            "data": json.loads(row["data_json"]),
            "ts": row["ts"]
        }

    async def prune_pulse_snapshots(self, source: str, keep: int = 100) -> int:
        return await self._run(self._sync_prune_pulse_snapshots, source, keep)

    def _sync_prune_pulse_snapshots(self, source: str, keep: int) -> int:
        conn = self._get_conn()
        # Delete rows not in the top N recent for this source
        res = conn.execute(
            """
            DELETE FROM pulse_snapshots
            WHERE source = ?
            AND id NOT IN (
                SELECT id FROM pulse_snapshots 
                WHERE source = ? 
                ORDER BY ts DESC 
                LIMIT ?
            )
            """,
            (source, source, keep)
        )
        conn.commit()
        return res.rowcount

    # -------------------------------------------------------------------------
    # Voice ID Events
    # -------------------------------------------------------------------------

    async def log_voice_id_event(
        self,
        ts: float,
        identified_user_id: Optional[str],
        score: Optional[float],
        runner_up_user_id: Optional[str],
        runner_up_score: Optional[float],
        audio_duration_ms: int,
        session_kind: str,
    ) -> None:
        await self._run(
            self._sync_log_voice_id_event,
            ts,
            identified_user_id,
            score,
            runner_up_user_id,
            runner_up_score,
            audio_duration_ms,
            session_kind,
        )

    def _sync_log_voice_id_event(
        self,
        ts: float,
        identified_user_id: Optional[str],
        score: Optional[float],
        runner_up_user_id: Optional[str],
        runner_up_score: Optional[float],
        audio_duration_ms: int,
        session_kind: str,
    ) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO voice_id_events (
                ts, identified_user_id, score, runner_up_user_id, runner_up_score, 
                audio_duration_ms, session_kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts, identified_user_id, score, runner_up_user_id, runner_up_score,
                audio_duration_ms, session_kind
            )
        )
        conn.commit()

    async def get_recent_voice_id_events(self, limit: int = 50) -> list[dict]:
        return await self._run(self._sync_get_recent_voice_id_events, limit)

    def _sync_get_recent_voice_id_events(self, limit: int) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM voice_id_events ORDER BY ts DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    async def get_integrations(self) -> dict:
        config = await self.get_admin_config()
        return config.get("integrations", {})

    async def set_integrations(self, integrations: dict) -> None:
        config = await self.get_admin_config()
        config["integrations"] = integrations
        await self.set_admin_config(config)

    # =========================================================================
    # User auth methods
    # =========================================================================

    async def create_user(self, id: str, email: str, password_hash: str, display_name: str, role: str = "user", is_approved: bool = False) -> None:
        await self._run(self._sync_create_user, id, email, password_hash, display_name, role, is_approved)

    def _sync_create_user(self, id: str, email: str, password_hash: str, display_name: str, role: str, is_approved: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, force_password_change, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (id, email, password_hash, display_name, role, int(is_approved), 0, now, now),
        )
        conn.commit()

    async def get_user_by_email(self, email: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_by_email, email)

    def _sync_get_user_by_email(self, email: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, email, password_hash, display_name, role, is_approved, force_password_change, created_at FROM users WHERE email=?",
            (email,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "email": row[1],
            "password_hash": row[2],
            "display_name": row[3],
            "role": row[4],
            "is_approved": bool(row[5]),
            "force_password_change": bool(row[6]),
            "created_at": row[7]
        }

    async def get_user_by_id(self, user_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_by_id, user_id)

    def _sync_get_user_by_id(self, user_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, email, display_name, role, is_approved, created_at, password_hash, theme, palette, environment, universe, mood, force_password_change FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "email": row[1],
            "display_name": row[2],
            "role": row[3],
            "is_approved": bool(row[4]),
            "created_at": row[5],
            "password_hash": row[6],
            "theme": row[7] or "halo",
            "palette": row[8] or "spice",
            "environment": row[9] or "atreides",
            "universe": row[10] or "dune",
            "mood": row[11] or "caladan",
            "force_password_change": bool(row[12]),
        }

    async def update_user_theme(self, user_id: str, theme: str) -> None:
        await self._run(self._sync_update_user_theme, user_id, theme)

    def _sync_update_user_theme(self, user_id: str, theme: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE users SET theme=?, updated_at=? WHERE id=?", (theme, _now_str(), user_id))
        conn.commit()

    async def update_user_palette(self, user_id: str, palette: str) -> None:
        await self._run(self._sync_update_user_palette, user_id, palette)

    def _sync_update_user_palette(self, user_id: str, palette: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE users SET palette=?, updated_at=? WHERE id=?", (palette, _now_str(), user_id))
        conn.commit()

    async def update_user_environment(self, user_id: str, environment: str) -> None:
        await self._run(self._sync_update_user_environment, user_id, environment)

    def _sync_update_user_environment(self, user_id: str, environment: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE users SET environment=?, updated_at=? WHERE id=?", (environment, _now_str(), user_id))
        conn.commit()

    async def update_user_universe(self, user_id: str, universe: str) -> None:
        await self._run(self._sync_update_user_universe, user_id, universe)

    def _sync_update_user_universe(self, user_id: str, universe: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE users SET universe=?, updated_at=? WHERE id=?", (universe, _now_str(), user_id))
        conn.commit()

    async def update_user_mood(self, user_id: str, mood: str) -> None:
        await self._run(self._sync_update_user_mood, user_id, mood)

    def _sync_update_user_mood(self, user_id: str, mood: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE users SET mood=?, updated_at=? WHERE id=?", (mood, _now_str(), user_id))
        conn.commit()

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
            "SELECT id, email, display_name, role, is_approved, force_password_change, is_suspended, tokens_valid_after, created_at FROM users ORDER BY created_at ASC"
        ).fetchall()
        return [
            {
                "id": r[0],
                "email": r[1],
                "display_name": r[2],
                "role": r[3],
                "is_approved": bool(r[4]),
                "force_password_change": bool(r[5]),
                "is_suspended": bool(r[6]),
                "tokens_valid_after": r[7],
                "created_at": r[8]
            } for r in rows
        ]

    async def update_user(self, user_id: str, role: Optional[str] = None, is_approved: Optional[bool] = None, force_password_change: Optional[bool] = None, is_suspended: Optional[bool] = None) -> bool:
        return await self._run(self._sync_update_user, user_id, role, is_approved, force_password_change, is_suspended)

    def _sync_update_user(self, user_id: str, role: Optional[str], is_approved: Optional[bool], force_password_change: Optional[bool], is_suspended: Optional[bool]) -> bool:
        conn = self._get_conn()
        now = _now_str()
        parts, vals = [], []
        if role is not None:
            allowed_roles = {"admin", "user", "child", "guest"}
            if role not in allowed_roles:
                raise ValueError(f"Invalid role '{role}'.")
            parts.append("role = ?")
            vals.append(role)
        if is_approved is not None:
            parts.append("is_approved = ?")
            vals.append(int(is_approved))
        if force_password_change is not None:
            parts.append("force_password_change = ?")
            vals.append(int(force_password_change))
        if is_suspended is not None:
            parts.append("is_suspended = ?")
            vals.append(int(is_suspended))
        if not parts:
            return False
        parts.append("updated_at = ?")
        vals.append(now)
        vals.append(user_id)
        conn.execute(
            "UPDATE users SET " + ", ".join(parts) + " WHERE id = ?",
            vals,
        )
        conn.commit()
        return True

    async def update_user_password(self, user_id: str, password_hash: str, force_change: bool = False) -> None:
        await self._run(self._sync_update_user_password, user_id, password_hash, force_change)

    def _sync_update_user_password(self, user_id: str, password_hash: str, force_change: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        force_val = 1 if force_change else 0
        conn.execute(
            "UPDATE users SET password_hash = ?, force_password_change = ?, updated_at = ? WHERE id = ?",
            (password_hash, force_val, now, user_id)
        )
        conn.commit()

    async def delete_user(self, user_id: str) -> bool:
        return await self._run(self._sync_delete_user, user_id)

    def _sync_delete_user(self, user_id: str) -> bool:
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0

    async def force_logout(self, user_id: str) -> None:
        await self._run(self._sync_force_logout, user_id)

    def _sync_force_logout(self, user_id: str) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute("UPDATE users SET tokens_valid_after = ?, updated_at = ? WHERE id = ?", (now, now, user_id))
        conn.commit()

    async def get_user_by_google_id(self, google_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_by_google_id, google_id)

    def _sync_get_user_by_google_id(self, google_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, email, password_hash, display_name, role, is_approved, created_at, google_id, google_email FROM users WHERE google_id=?",
            (google_id,),
        ).fetchone()
        if row is None:
            return None
        return {"id": row[0], "email": row[1], "password_hash": row[2], "display_name": row[3], "role": row[4], "is_approved": bool(row[5]), "created_at": row[6], "google_id": row[7], "google_email": row[8]}

    async def link_google_account(self, user_id: str, google_id: str, google_email: str) -> None:
        await self._run(self._sync_link_google_account, user_id, google_id, google_email)

    def _sync_link_google_account(self, user_id: str, google_id: str, google_email: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET google_id=?, google_email=?, updated_at=? WHERE id=?",
            (google_id, google_email, _now_str(), user_id),
        )
        conn.commit()

    async def create_google_user(self, id: str, email: str, display_name: str, google_id: str, google_email: str, role: str = "user", is_approved: bool = True) -> None:
        await self._run(self._sync_create_google_user, id, email, display_name, google_id, google_email, role, is_approved)

    def _sync_create_google_user(self, id: str, email: str, display_name: str, google_id: str, google_email: str, role: str, is_approved: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, google_id, google_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (id, email, "", display_name, role, int(is_approved), google_id, google_email, now, now),
        )
        conn.commit()

    # =========================================================================
    # Family Groups
    # =========================================================================

    def _row_to_family_group(self, row) -> dict:
        return {
            "id":             row["id"],
            "name":           row["name"],
            "shared_modules": json.loads(row["shared_modules"] or "[]"),
            "created_at":     row["created_at"],
            "updated_at":     row["updated_at"],
        }

    async def create_family_group(self, group_id: str, name: str, shared_modules: list) -> dict:
        return await self._run(self._sync_create_family_group, group_id, name, shared_modules)

    def _sync_create_family_group(self, group_id: str, name: str, shared_modules: list) -> dict:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO family_groups (id, name, shared_modules, created_at, updated_at) VALUES (?,?,?,?,?)",
            (group_id, name, json.dumps(shared_modules), now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
        return self._row_to_family_group(row)

    async def get_family_group(self, group_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_family_group, group_id)

    def _sync_get_family_group(self, group_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
        return self._row_to_family_group(row) if row else None

    async def list_family_groups(self) -> list:
        return await self._run(self._sync_list_family_groups)

    def _sync_list_family_groups(self) -> list:
        conn = self._get_conn()
        groups = [
            self._row_to_family_group(r)
            for r in conn.execute("SELECT * FROM family_groups ORDER BY created_at ASC").fetchall()
        ]
        users = {
            r["id"]: {"id": r["id"], "display_name": r["display_name"], "email": r["email"], "role": r["role"]}
            for r in conn.execute("SELECT id, display_name, email, role FROM users").fetchall()
        }
        members_rows = conn.execute(
            "SELECT * FROM family_memberships ORDER BY joined_at ASC"
        ).fetchall()
        member_map: dict = {g["id"]: [] for g in groups}
        for m in members_rows:
            gid = m["family_group_id"]
            if gid in member_map:
                user = users.get(m["profile_id"], {"id": m["profile_id"], "display_name": m["profile_id"], "email": "", "role": ""})
                member_map[gid].append({
                    "profile_id":   m["profile_id"],
                    "display_name": user["display_name"],
                    "email":        user["email"],
                    "role":         user["role"],
                    "relationship": m["relationship"],
                    "joined_at":    m["joined_at"],
                })
        for g in groups:
            g["members"] = member_map.get(g["id"], [])
        return groups

    async def update_family_group(self, group_id: str, name: Optional[str], shared_modules: Optional[list]) -> Optional[dict]:
        return await self._run(self._sync_update_family_group, group_id, name, shared_modules)

    def _sync_update_family_group(self, group_id: str, name: Optional[str], shared_modules: Optional[list]) -> Optional[dict]:
        conn = self._get_conn()
        parts, vals = [], []
        if name is not None:
            parts.append("name = ?"); vals.append(name)
        if shared_modules is not None:
            parts.append("shared_modules = ?"); vals.append(json.dumps(shared_modules))
        if not parts:
            row = conn.execute("SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
            return self._row_to_family_group(row) if row else None
        parts.append("updated_at = ?"); vals.append(_now_str())
        vals.append(group_id)
        conn.execute("UPDATE family_groups SET " + ", ".join(parts) + " WHERE id=?", vals)
        conn.commit()
        row = conn.execute("SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
        return self._row_to_family_group(row) if row else None

    async def delete_family_group(self, group_id: str) -> None:
        await self._run(self._sync_delete_family_group, group_id)

    def _sync_delete_family_group(self, group_id: str) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM family_memberships WHERE family_group_id=?", (group_id,))
        conn.execute("DELETE FROM family_groups WHERE id=?", (group_id,))
        conn.commit()

    async def add_family_member(self, group_id: str, profile_id: str, relationship: str) -> dict:
        return await self._run(self._sync_add_family_member, group_id, profile_id, relationship)

    def _sync_add_family_member(self, group_id: str, profile_id: str, relationship: str) -> dict:
        conn = self._get_conn()
        mid = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            """
            INSERT INTO family_memberships (id, profile_id, family_group_id, relationship, joined_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(profile_id) DO UPDATE SET
                family_group_id = excluded.family_group_id,
                relationship    = excluded.relationship,
                joined_at       = excluded.joined_at
            """,
            (mid, profile_id, group_id, relationship, now),
        )
        conn.commit()
        return {"profile_id": profile_id, "family_group_id": group_id, "relationship": relationship}

    async def remove_family_member(self, group_id: str, profile_id: str) -> None:
        await self._run(self._sync_remove_family_member, group_id, profile_id)

    def _sync_remove_family_member(self, group_id: str, profile_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM family_memberships WHERE family_group_id=? AND profile_id=?",
            (group_id, profile_id),
        )
        conn.commit()

    async def get_user_family_group(self, user_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_family_group, user_id)

    def _sync_get_user_family_group(self, user_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            """
            SELECT fg.id, fg.name, fg.shared_modules, fm.relationship
            FROM family_memberships fm
            JOIN family_groups fg ON fg.id = fm.family_group_id
            WHERE fm.profile_id = ?
            """,
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id":             row["id"],
            "name":           row["name"],
            "shared_modules": json.loads(row["shared_modules"] or "[]"),
            "relationship":   row["relationship"],
        }

    # =========================================================================
    # Routines
    # =========================================================================

    def _row_to_routine(self, row) -> dict:
        return {
            "id":          row["id"],
            "user_id":     row["user_id"],
            "name":        row["name"],
            "trigger":     row["trigger"],
            "time":        row["time"],
            "days":        json.loads(row["days"] or "[]"),
            "prompt":      row["prompt"],
            "type":        row["type"],
            "webhook_url": row["webhook_url"],
            "enabled":     bool(row["enabled"]),
            "last_run":    row["last_run"],
            "created_at":  row["created_at"],
            "updated_at":  row["updated_at"],
        }

    async def list_routines(self, user_id: str) -> list:
        return await self._run(self._sync_list_routines, user_id)

    def _sync_list_routines(self, user_id: str) -> list:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM routines WHERE user_id=? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [self._row_to_routine(r) for r in rows]

    async def create_routine(self, routine: dict) -> dict:
        return await self._run(self._sync_create_routine, routine)

    def _sync_create_routine(self, routine: dict) -> dict:
        conn = self._get_conn()
        now = _now_str()
        rid = routine.get("id") or str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO routines 
                (id, user_id, name, trigger, time, days, prompt, type, webhook_url, enabled, created_at, updated_at) 
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (rid, routine["user_id"], routine["name"], routine.get("trigger","manual"),
             routine.get("time"), json.dumps(routine.get("days",[])), routine.get("prompt",""),
             routine.get("type", "simple"), routine.get("webhook_url"),
             int(routine.get("enabled", True)), now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM routines WHERE id=?", (rid,)).fetchone()
        return self._row_to_routine(row)

    async def update_routine(self, routine_id: str, user_id: str, fields: dict) -> Optional[dict]:
        return await self._run(self._sync_update_routine, routine_id, user_id, fields)

    def _sync_update_routine(self, routine_id: str, user_id: str, fields: dict) -> Optional[dict]:
        conn = self._get_conn()
        allowed = {"name", "trigger", "time", "days", "prompt", "type", "webhook_url", "enabled", "last_run"}
        set_parts, vals = [], []
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == "days":
                v = json.dumps(v)
            elif k == "enabled":
                v = int(v)
            set_parts.append(f"{k} = ?")
            vals.append(v)
        if not set_parts:
            return None
        set_parts.append("updated_at = ?")
        vals.append(_now_str())
        vals += [routine_id, user_id]
        conn.execute(
            "UPDATE routines SET " + ", ".join(set_parts) + " WHERE id=? AND user_id=?",
            vals,
        )
        conn.commit()
        row = conn.execute("SELECT * FROM routines WHERE id=? AND user_id=?", (routine_id, user_id)).fetchone()
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

    # =========================================================================
    # Feed preferences
    # =========================================================================

    async def get_feed_preferences(self, user_id: str) -> dict:
        return await self._run(self._sync_get_feed_preferences, user_id)

    def _sync_get_feed_preferences(self, user_id: str) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM feed_preferences WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return {
                "user_id": user_id,
                "news_sources": [],
                "weather_lat": None,
                "weather_lon": None,
                "weather_unit": "celsius",
                "sport_teams": [],
                "stock_tickers": [],
                "refresh_news_min": 30,
                "refresh_weather_min": 30,
                "refresh_sports_min": 60,
                "refresh_stocks_min": 60,
            }
        base = {
            "user_id": row["user_id"],
            "news_sources": json.loads(row["news_sources"] or "[]"),
            "weather_lat": row["weather_lat"],
            "weather_lon": row["weather_lon"],
            "weather_unit": row["weather_unit"],
            "sport_teams": json.loads(row["sport_teams"] or "[]"),
            "sports_favorite_leagues": json.loads(row["sports_favorite_leagues"] if "sports_favorite_leagues" in row.keys() else '["nba","nfl","mlb"]') or ["nba", "nfl", "mlb"],
            "stock_tickers": json.loads(row["stock_tickers"] or "[]"),
            "refresh_news_min": row["refresh_news_min"],
            "refresh_weather_min": row["refresh_weather_min"],
            "refresh_sports_min": row["refresh_sports_min"],
            "refresh_stocks_min": row["refresh_stocks_min"],
        }

        # Merge fields that have no dedicated column. They live under
        # settings_json.feeds.* so new pref flags can be added without DDL.
        try:
            settings = json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError, IndexError):
            settings = {}
        feeds_extra = settings.get("feeds") or {}
        for key in (
            "feed_news_enabled",
            "feed_weather_enabled",
            "feed_sports_enabled",
            "feed_stocks_enabled",
            "feed_flights_enabled",
            "weather_alerts_enabled",
            "sports_news_sources",
        ):
            if key in feeds_extra:
                base[key] = feeds_extra[key]
        return base

    async def save_feed_preferences(self, user_id: str, prefs: dict) -> None:
        await self._run(self._sync_save_feed_preferences, user_id, prefs)

    # =========================================================================
    # Generic per-page settings (settings_json column on feed_preferences)
    # =========================================================================

    async def get_page_settings(self, user_id: str) -> dict:
        return await self._run(self._sync_get_page_settings, user_id)

    def _sync_get_page_settings(self, user_id: str) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT settings_json FROM feed_preferences WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            return {}
        try:
            return json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError):
            return {}

    async def save_page_settings(self, user_id: str, patch: dict) -> None:
        await self._run(self._sync_save_page_settings, user_id, patch)

    def _sync_save_page_settings(self, user_id: str, patch: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO feed_preferences
               (user_id, news_sources, weather_unit, sport_teams,
                sports_favorite_leagues, stock_tickers,
                refresh_news_min, refresh_weather_min,
                refresh_sports_min, refresh_stocks_min, updated_at)
               VALUES (?, '[]', 'celsius', '[]', '["nba","nfl","mlb"]',
                       '[]', 30, 30, 60, 60, ?)""",
            (user_id, _now_str()),
        )
        row = conn.execute(
            "SELECT settings_json FROM feed_preferences WHERE user_id = ?", (user_id,)
        ).fetchone()
        try:
            current = json.loads(row["settings_json"] or "{}") or {}
        except (json.JSONDecodeError, ValueError):
            current = {}
        for key, val in patch.items():
            if isinstance(val, dict) and isinstance(current.get(key), dict):
                current[key] = {**current[key], **val}
            else:
                current[key] = val
        conn.execute(
            "UPDATE feed_preferences SET settings_json = ?, updated_at = ? WHERE user_id = ?",
            (json.dumps(current), _now_str(), user_id),
        )
        conn.commit()

    # =========================================================================
    # Reading shelf
    # =========================================================================

    def _row_to_book(self, row) -> dict:
        return {
            "id":           row[0],
            "user_id":      row[1],
            "service":      row[2],
            "title":        row[3],
            "author":       row[4],
            "cover_url":    row[5],
            "progress_pct": row[6],
            "status":       row[7],
            "rating":       row[8],
            "notes":        row[9],
            "launch_url":   row[10],
            "created_at":   row[11],
            "updated_at":   row[12],
        }

    async def list_shelf(self, user_id: str, service: str = None, status: str = None) -> list:
        return await self._run(self._sync_list_shelf, user_id, service, status)

    def _sync_list_shelf(self, user_id: str, service: str, status: str) -> list:
        conn = self._get_conn()
        query = (
            "SELECT id,user_id,service,title,author,cover_url,progress_pct,status,rating,notes,launch_url,created_at,updated_at "
            "FROM reading_shelf WHERE user_id=?"
        )
        params = [user_id]
        if service:
            query += " AND service=?"
            params.append(service)
        if status:
            query += " AND status=?"
            params.append(status)
        query += " ORDER BY updated_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [self._row_to_book(r) for r in rows]

    async def create_book(self, book: dict) -> dict:
        return await self._run(self._sync_create_book, book)

    def _sync_create_book(self, book: dict) -> dict:
        conn = self._get_conn()
        now = _now_str()
        bid = book.get("id") or str(uuid.uuid4())
        conn.execute(
            "INSERT INTO reading_shelf (id,user_id,service,title,author,cover_url,progress_pct,status,rating,notes,launch_url,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (bid, book["user_id"], book["service"], book["title"],
             book.get("author", ""), book.get("cover_url", ""),
             float(book.get("progress_pct", 0.0)), book.get("status", "reading"),
             book.get("rating"), book.get("notes", ""), book.get("launch_url", ""),
             now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id,user_id,service,title,author,cover_url,progress_pct,status,rating,notes,launch_url,created_at,updated_at "
            "FROM reading_shelf WHERE id=?", (bid,)
        ).fetchone()
        return self._row_to_book(row)

    async def update_book(self, book_id: str, user_id: str, fields: dict) -> Optional[dict]:
        return await self._run(self._sync_update_book, book_id, user_id, fields)

    def _sync_update_book(self, book_id: str, user_id: str, fields: dict) -> Optional[dict]:
        conn = self._get_conn()
        allowed = {"service", "title", "author", "cover_url", "progress_pct", "status", "rating", "notes", "launch_url"}
        parts, vals = [], []
        for k, v in fields.items():
            if k in allowed:
                parts.append(f"{k} = ?")
                vals.append(v)
        if not parts:
            return None
        parts.append("updated_at = ?")
        vals.append(_now_str())
        vals += [book_id, user_id]
        conn.execute(
            "UPDATE reading_shelf SET " + ", ".join(parts) + " WHERE id=? AND user_id=?",
            vals,
        )
        conn.commit()
        row = conn.execute(
            "SELECT id,user_id,service,title,author,cover_url,progress_pct,status,rating,notes,launch_url,created_at,updated_at "
            "FROM reading_shelf WHERE id=? AND user_id=?", (book_id, user_id)
        ).fetchone()
        return self._row_to_book(row) if row else None

    async def delete_book(self, book_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_book, book_id, user_id)

    def _sync_delete_book(self, book_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute("DELETE FROM reading_shelf WHERE id=? AND user_id=?", (book_id, user_id))
        conn.commit()
        return cur.rowcount > 0

    def _sync_save_feed_preferences(self, user_id: str, prefs: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO feed_preferences
                (user_id, news_sources, weather_lat, weather_lon, weather_unit,
                 sport_teams, sports_favorite_leagues, stock_tickers,
                 refresh_news_min, refresh_weather_min,
                 refresh_sports_min, refresh_stocks_min, updated_at)
            VALUES
                (:user_id, :news_sources, :weather_lat, :weather_lon, :weather_unit,
                 :sport_teams, :sports_favorite_leagues, :stock_tickers,
                 :refresh_news_min, :refresh_weather_min,
                 :refresh_sports_min, :refresh_stocks_min, :updated_at)
            ON CONFLICT(user_id) DO UPDATE SET
                news_sources              = excluded.news_sources,
                weather_lat               = excluded.weather_lat,
                weather_lon               = excluded.weather_lon,
                weather_unit              = excluded.weather_unit,
                sport_teams               = excluded.sport_teams,
                sports_favorite_leagues   = excluded.sports_favorite_leagues,
                stock_tickers             = excluded.stock_tickers,
                refresh_news_min          = excluded.refresh_news_min,
                refresh_weather_min       = excluded.refresh_weather_min,
                refresh_sports_min        = excluded.refresh_sports_min,
                refresh_stocks_min        = excluded.refresh_stocks_min,
                updated_at                = excluded.updated_at
            """,
            {
                "user_id":                   user_id,
                "news_sources":              json.dumps(prefs.get("news_sources", [])),
                "weather_lat":               prefs.get("weather_lat"),
                "weather_lon":               prefs.get("weather_lon"),
                "weather_unit":              prefs.get("weather_unit", "celsius"),
                "sport_teams":               json.dumps(prefs.get("sport_teams", [])),
                "sports_favorite_leagues":   json.dumps(prefs.get("sports_favorite_leagues", ["nba", "nfl", "mlb"])),
                "stock_tickers":             json.dumps(prefs.get("stock_tickers", [])),
                "refresh_news_min":          prefs.get("refresh_news_min", 30),
                "refresh_weather_min":       prefs.get("refresh_weather_min", 30),
                "refresh_sports_min":        prefs.get("refresh_sports_min", 60),
                "refresh_stocks_min":        prefs.get("refresh_stocks_min", 60),
                "updated_at":                _now_str(),
            },
        )

        # Persist non-column-backed fields under settings_json.feeds.
        # The `feed_preferences` table only has columns for the 12 prefs above,
        # so master toggles + alerts + sports-news sources used to silently
        # vanish on save. Storing them as JSON keeps the schema stable when
        # future pref flags are added.
        feeds_patch = {
            k: prefs[k]
            for k in (
                "feed_news_enabled",
                "feed_weather_enabled",
                "feed_sports_enabled",
                "feed_stocks_enabled",
                "feed_flights_enabled",
                "weather_alerts_enabled",
                "sports_news_sources",
            )
            if k in prefs
        }
        if feeds_patch:
            row = conn.execute(
                "SELECT settings_json FROM feed_preferences WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            try:
                current = json.loads(row["settings_json"] or "{}") or {} if row else {}
            except (json.JSONDecodeError, ValueError):
                current = {}
            existing_feeds = current.get("feeds") if isinstance(current.get("feeds"), dict) else {}
            current["feeds"] = {**existing_feeds, **feeds_patch}
            conn.execute(
                "UPDATE feed_preferences SET settings_json = ? WHERE user_id = ?",
                (json.dumps(current), user_id),
            )

        conn.commit()

    # =========================================================================
    # Admin config (global, single-row JSON store)
    # =========================================================================

    async def get_admin_config(self) -> dict:
        return await self._run(self._sync_get_admin_config)

    def _sync_get_admin_config(self) -> dict:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT value FROM admin_config WHERE key = '__global__'"
        ).fetchone()
        if not row:
            return {}
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return {}

    async def set_admin_config(self, config: dict) -> None:
        await self._run(self._sync_set_admin_config, config)

    def _sync_set_admin_config(self, config: dict) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO admin_config (key, value) VALUES ('__global__', ?)",
            (json.dumps(config),),
        )
        conn.commit()

    # =========================================================================
    # Parent-child relationships
    # =========================================================================

    async def add_parent_child(self, parent_id: str, child_id: str) -> None:
        await self._run(self._sync_add_parent_child, parent_id, child_id)

    def _sync_add_parent_child(self, parent_id: str, child_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO parent_child (parent_id, child_id, created_at) VALUES (?,?,?)",
            (parent_id, child_id, _now_str()),
        )
        conn.commit()

    async def remove_parent_child(self, parent_id: str, child_id: str) -> None:
        await self._run(self._sync_remove_parent_child, parent_id, child_id)

    def _sync_remove_parent_child(self, parent_id: str, child_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM parent_child WHERE parent_id=? AND child_id=?",
            (parent_id, child_id),
        )
        conn.commit()

    async def get_children_of_parent(self, parent_id: str) -> list[str]:
        return await self._run(self._sync_get_children_of_parent, parent_id)

    def _sync_get_children_of_parent(self, parent_id: str) -> list[str]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT child_id FROM parent_child WHERE parent_id=?", (parent_id,)
        ).fetchall()
        return [r[0] for r in rows]

    async def get_parents_of_child(self, child_id: str) -> list[str]:
        return await self._run(self._sync_get_parents_of_child, child_id)

    def _sync_get_parents_of_child(self, child_id: str) -> list[str]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT parent_id FROM parent_child WHERE child_id=?", (child_id,)
        ).fetchall()
        return [r[0] for r in rows]

    async def list_all_parent_child(self) -> list[dict]:
        return await self._run(self._sync_list_all_parent_child)

    def _sync_list_all_parent_child(self) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT parent_id, child_id, created_at FROM parent_child ORDER BY created_at"
        ).fetchall()
        return [{"parent_id": r[0], "child_id": r[1], "created_at": r[2]} for r in rows]

    # =========================================================================
    # Child feature settings (parent-controlled per-child feature access)
    # =========================================================================

    async def get_child_features(self, child_id: str) -> list[str]:
        return await self._run(self._sync_get_child_features, child_id)

    def _sync_get_child_features(self, child_id: str) -> list[str]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT enabled_features FROM child_features WHERE child_id=?", (child_id,)
        ).fetchone()
        if not row:
            return []
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return []

    async def set_child_features(self, child_id: str, features: list[str]) -> None:
        await self._run(self._sync_set_child_features, child_id, features)

    def _sync_set_child_features(self, child_id: str, features: list[str]) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO child_features (child_id, enabled_features) VALUES (?,?)",
            (child_id, json.dumps(features)),
        )

    # -------------------------------------------------------------------------
    # Analytics — platforms
    # -------------------------------------------------------------------------

    async def get_analytics_platforms(self, user_id: str) -> list[dict]:
        return await self._run(self._sync_get_analytics_platforms, user_id)

    def _sync_get_analytics_platforms(self, user_id: str) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM analytics_platforms WHERE user_id=? ORDER BY platform",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    async def upsert_analytics_platform(
        self, user_id: str, platform: str, enabled: bool,
        api_key: str = "", api_secret: str = "", notes: str = "",
    ) -> None:
        await self._run(
            self._sync_upsert_analytics_platform,
            user_id, platform, enabled, api_key, api_secret, notes,
        )

    def _sync_upsert_analytics_platform(
        self, user_id: str, platform: str, enabled: bool,
        api_key: str, api_secret: str, notes: str,
    ) -> None:
        conn = self._get_conn()
        now = _now_str()
        existing = conn.execute(
            "SELECT id FROM analytics_platforms WHERE user_id=? AND platform=?",
            (user_id, platform),
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE analytics_platforms SET enabled=?, api_key=?, api_secret=?,
                   notes=?, updated_at=? WHERE user_id=? AND platform=?""",
                (int(enabled), api_key, api_secret, notes, now, user_id, platform),
            )
        else:
            conn.execute(
                """INSERT INTO analytics_platforms
                   (id, user_id, platform, enabled, api_key, api_secret, notes, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4()), user_id, platform, int(enabled),
                 api_key, api_secret, notes, now, now),
            )
        conn.commit()

    async def delete_analytics_platform(self, user_id: str, platform: str) -> None:
        await self._run(self._sync_delete_analytics_platform, user_id, platform)

    def _sync_delete_analytics_platform(self, user_id: str, platform: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM analytics_platforms WHERE user_id=? AND platform=?",
            (user_id, platform),
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # Analytics — snapshots
    # -------------------------------------------------------------------------

    async def get_analytics_snapshots(
        self, user_id: str, platform: Optional[str] = None, days: int = 90,
    ) -> list[dict]:
        return await self._run(self._sync_get_analytics_snapshots, user_id, platform, days)

    def _sync_get_analytics_snapshots(
        self, user_id: str, platform: Optional[str], days: int,
    ) -> list[dict]:
        conn = self._get_conn()
        if platform:
            rows = conn.execute(
                """SELECT * FROM analytics_snapshots
                   WHERE user_id=? AND platform=?
                     AND date >= date('now', ?)
                   ORDER BY platform, date""",
                (user_id, platform, f"-{days} days"),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM analytics_snapshots
                   WHERE user_id=?
                     AND date >= date('now', ?)
                   ORDER BY platform, date""",
                (user_id, f"-{days} days"),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["metrics"] = json.loads(d["metrics"])
            except (json.JSONDecodeError, TypeError):
                d["metrics"] = {}
            result.append(d)
        return result

    async def upsert_analytics_snapshot(
        self, user_id: str, platform: str, date: str, metrics: dict,
    ) -> str:
        return await self._run(
            self._sync_upsert_analytics_snapshot, user_id, platform, date, metrics,
        )

    def _sync_upsert_analytics_snapshot(
        self, user_id: str, platform: str, date: str, metrics: dict,
    ) -> str:
        conn = self._get_conn()
        now = _now_str()
        existing = conn.execute(
            "SELECT id FROM analytics_snapshots WHERE user_id=? AND platform=? AND date=?",
            (user_id, platform, date),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE analytics_snapshots SET metrics=?, updated_at=? WHERE id=?",
                (json.dumps(metrics), now, existing[0]),
            )
            conn.commit()
            return existing[0]
        snap_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO analytics_snapshots
               (id, user_id, platform, date, metrics, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            (snap_id, user_id, platform, date, json.dumps(metrics), now, now),
        )
        conn.commit()
        return snap_id

    async def delete_analytics_snapshot(self, snapshot_id: str, user_id: str) -> None:
        await self._run(self._sync_delete_analytics_snapshot, snapshot_id, user_id)

    def _sync_delete_analytics_snapshot(self, snapshot_id: str, user_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM analytics_snapshots WHERE id=? AND user_id=?",
            (snapshot_id, user_id),
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # Web Push Notifications
    # -------------------------------------------------------------------------

    async def save_push_subscription(self, user_id: str, subscription_json: str) -> None:
        await self._run(self._sync_save_push_subscription, user_id, subscription_json)

    def _sync_save_push_subscription(self, user_id: str, subscription_json: str) -> None:
        import json
        conn = self._get_conn()
        sub = json.loads(subscription_json)
        endpoint = sub["endpoint"]
        now = _now_str()
        conn.execute(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, endpoint) DO UPDATE SET
                subscription_json = excluded.subscription_json
            """,
            (user_id, endpoint, subscription_json, now),
        )
        conn.commit()

    async def get_push_subscriptions(self, user_id: str) -> list[str]:
        return await self._run(self._sync_get_push_subscriptions, user_id)

    def _sync_get_push_subscriptions(self, user_id: str) -> list[str]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT subscription_json FROM push_subscriptions WHERE user_id=?",
            (user_id,),
        ).fetchall()
        return [row[0] for row in rows]

    async def delete_push_subscription(self, user_id: str, endpoint: str) -> None:
        await self._run(self._sync_delete_push_subscription, user_id, endpoint)

    def _sync_delete_push_subscription(self, user_id: str, endpoint: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
            (user_id, endpoint),
        )
        conn.commit()
        conn.commit()
