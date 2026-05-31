import os

filepath = "providers/memory/sqlite_store.py"
with open(filepath, "r") as f:
    content = f.read()

# 1. Update DDL
old_ddl = """CREATE TABLE IF NOT EXISTS vector_units (
    unit_id        TEXT PRIMARY KEY,
    unit_name      TEXT NOT NULL DEFAULT '',
    platform_type  TEXT NOT NULL DEFAULT 'unknown',
    config_json    TEXT NOT NULL DEFAULT '{}',
    registered_at  TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);"""

new_ddl = """CREATE TABLE IF NOT EXISTS vector_units (
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
"""
if old_ddl in content:
    content = content.replace(old_ddl, new_ddl)
else:
    print("Could not find old_ddl in content!")

# 2. Add migrations to _sync_initialize
migration_str = """
            # Vector fleet units table (river-vector integration)
            "CREATE TABLE IF NOT EXISTS vector_units (unit_id TEXT PRIMARY KEY, unit_name TEXT NOT NULL DEFAULT '', platform_type TEXT NOT NULL DEFAULT 'unknown', config_json TEXT NOT NULL DEFAULT '{}', registered_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
"""
new_migration_str = """
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
"""

if migration_str in content:
    content = content.replace(migration_str, new_migration_str)
else:
    print("Could not find migration_str in content!")


# 3. Replace CRUD methods
old_crud = """    # -------------------------------------------------------------------------
    # Vector fleet units
    # -------------------------------------------------------------------------

    async def upsert_vector_unit(
        self,
        unit_id: str,
        unit_name: str,
        platform_type: str,
        config_json: str,
    ) -> None:
        await self._run(
            self._sync_upsert_vector_unit, unit_id, unit_name, platform_type, config_json
        )

    def _sync_upsert_vector_unit(
        self,
        unit_id: str,
        unit_name: str,
        platform_type: str,
        config_json: str,
    ) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            \"\"\"
            INSERT INTO vector_units (unit_id, unit_name, platform_type, config_json, registered_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(unit_id) DO UPDATE SET
                unit_name     = excluded.unit_name,
                platform_type = excluded.platform_type,
                config_json   = excluded.config_json,
                updated_at    = excluded.updated_at
            \"\"\",
            (unit_id, unit_name, platform_type, config_json, now, now),
        )
        conn.commit()

    async def get_vector_units(self) -> list[dict]:
        return await self._run(self._sync_get_vector_units)

    def _sync_get_vector_units(self) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT unit_id, unit_name, platform_type, config_json, registered_at, updated_at FROM vector_units"
        ).fetchall()
        return [
            {
                "unit_id": r[0],
                "unit_name": r[1],
                "platform_type": r[2],
                "config_json": r[3],
                "registered_at": r[4],
                "updated_at": r[5],
            }
            for r in rows
        ]

    async def get_vector_unit(self, unit_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_vector_unit, unit_id)

    def _sync_get_vector_unit(self, unit_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT unit_id, unit_name, platform_type, config_json, registered_at, updated_at FROM vector_units WHERE unit_id=?",
            (unit_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "unit_id": row[0],
            "unit_name": row[1],
            "platform_type": row[2],
            "config_json": row[3],
            "registered_at": row[4],
            "updated_at": row[5],
        }"""

new_crud = """    # -------------------------------------------------------------------------
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
        
    def _execute_read_one(self, sql: str, params: tuple = ()) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    async def execute_write_async(self, sql: str, params: tuple) -> None:
        await self._run(self._execute_write, sql, params)

    async def execute_read_async(self, sql: str, params: tuple = ()) -> list[dict]:
        return await self._run(self._execute_read, sql, params)

    async def execute_read_one_async(self, sql: str, params: tuple = ()) -> Optional[dict]:
        return await self._run(self._execute_read_one, sql, params)

    # Simplified general access wrappers
    async def get_vector_units(self) -> list[dict]:
        return await self.execute_read_async("SELECT * FROM vector_units")

    async def get_vector_unit(self, unit_id: str) -> Optional[dict]:
        return await self.execute_read_one_async("SELECT * FROM vector_units WHERE unit_id=?", (unit_id,))

    async def update_vector_unit(self, unit_id: str, updates: dict) -> None:
        if not updates:
            return
        cols = ", ".join([f"{k}=?" for k in updates.keys()])
        params = list(updates.values()) + [unit_id]
        await self.execute_write_async(f"UPDATE vector_units SET {cols} WHERE unit_id=?", tuple(params))
        
    async def insert_vector_unit(self, unit_id: str, name: str, platform: str, unit_token: str, registered_at: str, claimed_at: str) -> None:
        sql = "INSERT INTO vector_units (unit_id, name, platform, unit_token, registered_at, claimed_at) VALUES (?, ?, ?, ?, ?, ?)"
        await self.execute_write_async(sql, (unit_id, name, platform, unit_token, registered_at, claimed_at))

    async def get_config_revision(self, unit_id: str) -> int:
        res = await self.execute_read_one_async("SELECT revision FROM vector_config_revisions WHERE unit_id=?", (unit_id,))
        return res["revision"] if res else 1

    async def bump_config_revision(self, unit_id: str) -> None:
        now = _now_str()
        sql = "INSERT INTO vector_config_revisions (unit_id, revision, updated_at) VALUES (?, 2, ?) ON CONFLICT(unit_id) DO UPDATE SET revision = revision + 1, updated_at = ?"
        await self.execute_write_async(sql, (unit_id, now, now))

    async def get_oldest_pending_command(self, unit_id: str) -> Optional[dict]:
        sql = "SELECT * FROM vector_commands WHERE unit_id=? AND status='pending' ORDER BY issued_at ASC LIMIT 1"
        return await self.execute_read_one_async(sql, (unit_id,))

    async def update_command_status(self, command_id: str, status: str) -> None:
        sql = f"UPDATE vector_commands SET status=?, {status}_at=? WHERE command_id=?"
        await self.execute_write_async(sql, (status, _now_str(), command_id))

    async def insert_telemetry(self, fields: dict) -> None:
        cols = ", ".join(fields.keys())
        placeholders = ", ".join(["?"] * len(fields))
        sql = f"INSERT INTO vector_telemetry ({cols}) VALUES ({placeholders})"
        await self.execute_write_async(sql, tuple(fields.values()))

    async def insert_alert(self, fields: dict) -> None:
        cols = ", ".join(fields.keys())
        placeholders = ", ".join(["?"] * len(fields))
        sql = f"INSERT INTO vector_alerts ({cols}) VALUES ({placeholders})"
        await self.execute_write_async(sql, tuple(fields.values()))

    async def insert_session_event(self, session_id: str, unit_id: str, event: str, data: str) -> None:
        sql = "INSERT INTO vector_session_events (session_id, unit_id, timestamp, event, data) VALUES (?, ?, ?, ?, ?)"
        await self.execute_write_async(sql, (session_id, unit_id, _now_str(), event, data))

    async def insert_session(self, session_id: str, unit_id: str, config_version: int, program_id: str = None) -> None:
        sql = "INSERT INTO vector_sessions (session_id, unit_id, program_id, config_version, started_at, status) VALUES (?, ?, ?, ?, ?, 'active')"
        await self.execute_write_async(sql, (session_id, unit_id, program_id, config_version, _now_str()))

    async def update_session(self, session_id: str, fields: dict) -> None:
        cols = ", ".join([f"{k}=?" for k in fields.keys()])
        params = list(fields.values()) + [session_id]
        await self.execute_write_async(f"UPDATE vector_sessions SET {cols} WHERE session_id=?", tuple(params))
        
    async def get_active_schedules(self) -> list[dict]:
        sql = "SELECT * FROM vector_schedules WHERE enabled = 1"
        return await self.execute_read_async(sql)
        
    async def update_schedule(self, schedule_id: str, last_run: str, next_run: str) -> None:
        sql = "UPDATE vector_schedules SET last_run=?, next_run=? WHERE schedule_id=?"
        await self.execute_write_async(sql, (last_run, next_run, schedule_id))
        
    async def prune_telemetry(self, unit_id: str, older_than_days: int) -> None:
        # Full query per spec 14.4 is "deletes vector_telemetry older than VECTOR_TELEMETRY_RETENTION_DAYS (default 90)"
        # And downsamples rows 7+ days old
        # For simplicity in this SQLite store, we'll implement simple drop, downsample can be implemented in daemon logic if needed, or simple prune here.
        sql = "DELETE FROM vector_telemetry WHERE unit_id=? AND timestamp < datetime('now', ? || ' days')"
        await self.execute_write_async(sql, (unit_id, f"-{older_than_days}"))

    # Adding simple generic list access for UI routes
    async def get_zones(self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_zones")
    async def get_programs(self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_programs")
    async def get_schedules(self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_schedules")
    async def get_sessions(self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_sessions ORDER BY started_at DESC LIMIT 100")
"""

if old_crud in content:
    content = content.replace(old_crud, new_crud)
else:
    print("Could not find old_crud in content!")

with open(filepath, "w") as f:
    f.write(content)

