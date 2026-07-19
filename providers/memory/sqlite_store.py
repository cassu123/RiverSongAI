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
import re
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

CREATE TABLE IF NOT EXISTS chat_sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    title         TEXT DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    distilled_at  TEXT,
    archived      INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    meta        TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON chat_messages(session_id, id);

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
    last_output TEXT,
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


CREATE TABLE IF NOT EXISTS proactive_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    dedupe_key   TEXT NOT NULL,
    severity     TEXT NOT NULL,
    title        TEXT, body TEXT,
    delivered    INTEGER NOT NULL,
    reason       TEXT,
    channels     TEXT DEFAULT '[]',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proactive_log_user ON proactive_log(user_id);
CREATE INDEX IF NOT EXISTS idx_proactive_log_dedupe ON proactive_log(kind, dedupe_key);

CREATE TABLE IF NOT EXISTS proactive_prefs (
    user_id      TEXT PRIMARY KEY,
    quiet_start  INTEGER, quiet_end INTEGER,
    min_push_severity TEXT DEFAULT 'info',
    kinds_muted  TEXT DEFAULT '[]'
);

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

CREATE TABLE IF NOT EXISTS fcm_tokens (
    user_id    TEXT NOT NULL,
    token      TEXT NOT NULL,
    platform   TEXT NOT NULL DEFAULT 'android',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, token)
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

CREATE TABLE IF NOT EXISTS vector_units (
    unit_id              TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    platform             TEXT NOT NULL,
    unit_token           TEXT NOT NULL,
    firmware_version     TEXT,
    timezone             TEXT NOT NULL DEFAULT 'UTC',
    online               INTEGER NOT NULL DEFAULT 0,
    last_seen            DATETIME,
    last_ip              TEXT,
    connectivity_tier    TEXT,
    registered_at        DATETIME NOT NULL,
    claimed_at           DATETIME NOT NULL,
    hardware             TEXT NOT NULL,
    safety_floors        TEXT NOT NULL,
    home_position        TEXT NOT NULL,
    operating_mode       TEXT,
    session_state        TEXT,
    active_faults        TEXT,
    notes                TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_online ON vector_units(online);

CREATE TABLE IF NOT EXISTS vector_config_revisions (
    unit_id     TEXT PRIMARY KEY REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL DEFAULT 1,
    updated_at  DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS vector_zones (
    zone_id          TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    created_by       TEXT NOT NULL,
    created_at       DATETIME NOT NULL,
    updated_at       DATETIME NOT NULL,
    boundary         TEXT NOT NULL,
    no_go_areas      TEXT NOT NULL DEFAULT '[]',
    area_sqm         REAL,
    capture_method   TEXT NOT NULL,
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS vector_programs (
    program_id            TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    zone_ids              TEXT NOT NULL,
    pattern               TEXT NOT NULL,
    direction_deg         REAL NOT NULL DEFAULT 0,
    overlap_pct           REAL NOT NULL DEFAULT 10,
    obstacle_clearance_m  REAL NOT NULL,
    edge_distance_m       REAL NOT NULL DEFAULT 0.15,
    speed_profile         TEXT NOT NULL DEFAULT 'normal',
    assigned_unit_id      TEXT REFERENCES vector_units(unit_id) ON DELETE SET NULL,
    created_at            DATETIME NOT NULL,
    updated_at            DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programs_assigned ON vector_programs(assigned_unit_id);

CREATE TABLE IF NOT EXISTS vector_schedules (
    schedule_id          TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    program_id           TEXT NOT NULL REFERENCES vector_programs(program_id) ON DELETE CASCADE,
    cron_utc             TEXT NOT NULL,
    timezone_display     TEXT NOT NULL DEFAULT 'UTC',
    enabled              INTEGER NOT NULL DEFAULT 1,
    missed_run_policy    TEXT NOT NULL DEFAULT 'skip',
    last_run             DATETIME,
    next_run             DATETIME,
    created_at           DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON vector_schedules(next_run, enabled);

CREATE TABLE IF NOT EXISTS vector_sessions (
    session_id           TEXT PRIMARY KEY,
    unit_id              TEXT NOT NULL REFERENCES vector_units(unit_id),
    program_id           TEXT REFERENCES vector_programs(program_id),
    zone_ids_snapshot    TEXT,
    config_version       INTEGER NOT NULL,
    started_at           DATETIME NOT NULL,
    ended_at             DATETIME,
    status               TEXT NOT NULL,
    abort_reason         TEXT,
    area_mowed_sqm       REAL,
    battery_used_pct     REAL,
    fuel_used_pct        REAL,
    faults_during        TEXT,
    triggered_by         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_unit_time ON vector_sessions(unit_id, started_at DESC);

CREATE TABLE IF NOT EXISTS vector_commands (
    command_id           TEXT PRIMARY KEY,
    unit_id              TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    issued_by            TEXT NOT NULL,
    issued_at            DATETIME NOT NULL,
    idempotency_key      TEXT,
    action               TEXT NOT NULL,
    params               TEXT NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'pending',
    dispatched_at        DATETIME,
    acknowledged_at      DATETIME,
    completed_at         DATETIME,
    result               TEXT,
    ttl_seconds          INTEGER NOT NULL DEFAULT 30
);
CREATE INDEX IF NOT EXISTS idx_commands_pending ON vector_commands(unit_id, status, issued_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commands_idem ON vector_commands(unit_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS vector_telemetry (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id           TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    session_id        TEXT REFERENCES vector_sessions(session_id),
    timestamp         DATETIME NOT NULL,
    lat               REAL,
    lng               REAL,
    heading_deg       REAL,
    speed_kmh         REAL,
    battery_v         REAL,
    battery_pct       REAL,
    fuel_pct          REAL,
    engine_rpm        INTEGER,
    temp_c            REAL,
    operating_mode    TEXT,
    progress_pct      REAL,
    active_faults     TEXT,
    connectivity_tier TEXT
);
CREATE INDEX IF NOT EXISTS idx_telemetry_unit_time ON vector_telemetry(unit_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS vector_alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id           TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    session_id        TEXT REFERENCES vector_sessions(session_id),
    timestamp         DATETIME NOT NULL,
    level             TEXT NOT NULL,
    title             TEXT NOT NULL,
    message           TEXT,
    fault_code        TEXT,
    acknowledged      INTEGER NOT NULL DEFAULT 0,
    acknowledged_at   DATETIME,
    acknowledged_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_unit_time ON vector_alerts(unit_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unack ON vector_alerts(unit_id, acknowledged);

CREATE TABLE IF NOT EXISTS vector_session_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES vector_sessions(session_id) ON DELETE CASCADE,
    unit_id      TEXT NOT NULL,
    timestamp    DATETIME NOT NULL,
    event        TEXT NOT NULL,
    data         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_session ON vector_session_events(session_id, timestamp);

-- Q2#6 — Documents workspace (Markdown / plaintext / CSV / research-report)
CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    kind        TEXT NOT NULL DEFAULT 'markdown',
    body        TEXT NOT NULL DEFAULT '',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, updated_at DESC);

-- Q2#7 — Skills library (vector-retrieved prompts/recipes prepended to system prompt)
CREATE TABLE IF NOT EXISTS skills (
    id               TEXT PRIMARY KEY,
    owner_id         TEXT NOT NULL,
    name             TEXT NOT NULL,
    prompt           TEXT NOT NULL DEFAULT '',
    trigger_phrases  TEXT NOT NULL DEFAULT '',
    is_active        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_owner ON skills(owner_id, is_active);

-- Q2#9 — Session presets (saved model/voice/thinking/web/tool combinations)
CREATE TABLE IF NOT EXISTS session_presets (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_presets_owner ON session_presets(owner_id);

-- Q2#10 — Webhook tokens (admin-issuable scoped tokens for /webhooks/*)
CREATE TABLE IF NOT EXISTS webhook_tokens (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    scopes_json     TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT,
    revoked_at      TEXT,
    last_used_at    TEXT,
    use_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_webhook_tokens_hash ON webhook_tokens(token_hash);

CREATE TABLE IF NOT EXISTS webhook_token_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id        TEXT,
    action          TEXT NOT NULL,
    detail          TEXT NOT NULL DEFAULT '',
    actor           TEXT,
    ts              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_token_audit_token ON webhook_token_audit(token_id);

-- Q3#12 — Blind model comparison vote history
CREATE TABLE IF NOT EXISTS compare_history (
    id               TEXT PRIMARY KEY,
    owner_id         TEXT NOT NULL,
    prompt_hash      TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    model_a_provider TEXT NOT NULL,
    model_a_id       TEXT NOT NULL,
    model_b_provider TEXT NOT NULL,
    model_b_id       TEXT NOT NULL,
    response_a       TEXT NOT NULL,
    response_b       TEXT NOT NULL,
    winner           TEXT NOT NULL DEFAULT '',  -- 'a' | 'b' | 'tie' | ''
    created_at       TEXT NOT NULL,
    voted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_compare_history_owner ON compare_history(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compare_history_prompt_hash ON compare_history(prompt_hash);

-- Q3#14 — Remote Ollama rigs
CREATE TABLE IF NOT EXISTS remote_ollama_rigs (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    notes           TEXT NOT NULL DEFAULT '',
    last_health     TEXT NOT NULL DEFAULT 'unknown',  -- 'ok' | 'down' | 'unknown'
    last_checked_at TEXT,
    last_models     TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

"""


# =============================================================================
# DateTime helpers
#
# Moved verbatim to providers/memory/store/_util.py; re-exported here so
# existing imports (e.g. `from providers.memory.sqlite_store import
# _safe_cols`) keep working.
# =============================================================================

from providers.memory.store._util import (  # noqa: E402
    _SQL_IDENT_RE,
    _dt_to_str,
    _now_str,
    _safe_cols,
    _str_to_dt,
)
from providers.memory.store import (  # noqa: E402
    FactsStoreMixin,
    SettingsStoreMixin,
    UsersStoreMixin,
    IntegrationsStoreMixin,
    VaultStoreMixin,
    AnalyticsStoreMixin,
    FamilyStoreMixin,
    ContentStoreMixin,
    OpsStoreMixin,
    VectorStoreMixin,
    ChatStoreMixin,
)

# =============================================================================
# SQLiteStore
# =============================================================================

class SQLiteStore(
    FactsStoreMixin,
    SettingsStoreMixin,
    UsersStoreMixin,
    IntegrationsStoreMixin,
    VaultStoreMixin,
    AnalyticsStoreMixin,
    FamilyStoreMixin,
    ContentStoreMixin,
    OpsStoreMixin,
    VectorStoreMixin,
    ChatStoreMixin,
):
    """
    Async-friendly SQLite persistence layer for the River Song memory system.

    All public methods are async; blocking SQLite I/O runs in a thread pool
    so the FastAPI event loop is never blocked.
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        if db_path is None:
            from config.settings import get_settings
            db_path = get_settings().db_path
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
            # Q1#5 — TOTP 2FA. Per-user opt-in; default off so existing logins
            # are untouched.
            "ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT NOT NULL DEFAULT ''",
            # One-time mapping: legacy palette -> universe (idempotent via
            # default-gate)
            "UPDATE users SET universe='halo' WHERE palette='halo' AND universe='dune'",
            # One-time mapping: legacy theme -> mood (idempotent — only
            # rewrites rows still at default)
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
            "ALTER TABLE routines ADD COLUMN last_output TEXT",
            "INSERT OR IGNORE INTO admin_config (key, value) VALUES ('__global__', '{}')",
            # FIX B11: Remove (user_id, category) uniqueness to allow
            # multi-value preferences
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
            "CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY, music_provider TEXT NOT NULL DEFAULT 'youtube_music', voice_toggle TEXT NOT NULL DEFAULT 'auto', updated_at TEXT NOT NULL DEFAULT '')",
            "ALTER TABLE user_preferences ADD COLUMN voice_toggle TEXT NOT NULL DEFAULT 'auto'",
            "CREATE TABLE IF NOT EXISTS proactive_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL, severity TEXT NOT NULL, title TEXT, body TEXT, delivered INTEGER NOT NULL, reason TEXT, channels TEXT DEFAULT '[]', created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_proactive_log_user ON proactive_log(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_proactive_log_dedupe ON proactive_log(kind, dedupe_key)",
            "CREATE TABLE IF NOT EXISTS proactive_prefs (user_id TEXT PRIMARY KEY, quiet_start INTEGER, quiet_end INTEGER, min_push_severity TEXT DEFAULT 'info', kinds_muted TEXT DEFAULT '[]')",
            "ALTER TABLE feed_preferences ADD COLUMN sports_favorite_leagues TEXT NOT NULL DEFAULT '[\"nba\",\"nfl\",\"mlb\"]'",
            "ALTER TABLE feed_preferences ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
            # OAuth CSRF nonce store (for /api/integrations/google/callback
            # validation).
            "CREATE TABLE IF NOT EXISTS oauth_nonces (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, service TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires ON oauth_nonces(expires_at)",
            # Hot-path indexes for per-user lookups (audit DATA-001).
            "CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON preferences(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_summaries_user_id ON conversation_summaries(user_id)",
            # Vector fleet units table (river-vector integration)
            "CREATE TABLE IF NOT EXISTS vector_units (unit_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'unknown', unit_token TEXT NOT NULL DEFAULT '', firmware_version TEXT, timezone TEXT NOT NULL DEFAULT 'UTC', online INTEGER NOT NULL DEFAULT 0, last_seen DATETIME, last_ip TEXT, connectivity_tier TEXT, registered_at DATETIME NOT NULL DEFAULT '', claimed_at DATETIME NOT NULL DEFAULT '', hardware TEXT NOT NULL DEFAULT '{}', safety_floors TEXT NOT NULL DEFAULT '{}', home_position TEXT NOT NULL DEFAULT '{}', operating_mode TEXT, session_state TEXT, active_faults TEXT, notes TEXT)",
            # Idempotent migrations for existing DBs
            "ALTER TABLE vector_units ADD COLUMN unit_token TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE vector_units ADD COLUMN firmware_version TEXT",
            "ALTER TABLE vector_units ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'",
            "ALTER TABLE vector_units ADD COLUMN online INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE vector_units ADD COLUMN last_seen DATETIME",
            "ALTER TABLE vector_units ADD COLUMN last_ip TEXT",
            "ALTER TABLE vector_units ADD COLUMN connectivity_tier TEXT",
            "ALTER TABLE vector_units ADD COLUMN claimed_at DATETIME",
            "ALTER TABLE vector_units ADD COLUMN hardware TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE vector_units ADD COLUMN safety_floors TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE vector_units ADD COLUMN home_position TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE vector_units ADD COLUMN operating_mode TEXT",
            "ALTER TABLE vector_units ADD COLUMN session_state TEXT",
            "ALTER TABLE vector_units ADD COLUMN active_faults TEXT",
            "ALTER TABLE vector_units ADD COLUMN notes TEXT",
            "ALTER TABLE vector_units RENAME COLUMN unit_name TO name",
            "ALTER TABLE vector_units RENAME COLUMN platform_type TO platform",
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
    # Vector fleet units
    # -------------------------------------------------------------------------
    def _execute_write(self, sql: str, params: tuple) -> None:
        conn = self._get_conn()
        conn.execute(sql, params)
        conn.commit()

    def _execute_read(self, sql: str, params: tuple = ()) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def _execute_read_one(self, sql: str,
                          params: tuple = ()) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    async def execute_write_async(self, sql: str, params: tuple) -> None:
        await self._run(self._execute_write, sql, params)

    async def execute_read_async(
            self, sql: str, params: tuple = ()) -> list[dict]:
        return await self._run(self._execute_read, sql, params)

    async def execute_read_one_async(
            self, sql: str, params: tuple = ()) -> Optional[dict]:
        return await self._run(self._execute_read_one, sql, params)

