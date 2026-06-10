# =============================================================================
# providers/memory/store/vector.py
#
# File Purpose:
#   Vector fleet units, telemetry, alerts, sessions, schedules and commands.
#   VectorStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

from datetime import datetime
from typing import Optional

from providers.memory.store._util import (
    _now_str,
    _safe_cols,
)


class VectorStoreMixin:
    """Vector fleet units, telemetry, alerts, sessions, schedules and commands.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """
    # Simplified general access wrappers
    async def get_vector_units(self) -> list[dict]:
        return await self.execute_read_async("SELECT * FROM vector_units")

    async def get_vector_unit(self, unit_id: str) -> Optional[dict]:
        return await self.execute_read_one_async("SELECT * FROM vector_units WHERE unit_id=?", (unit_id,))

    async def update_vector_unit(self, unit_id: str, updates: dict) -> None:
        if not updates:
            return
        cols = ", ".join([f"{k}=?" for k in _safe_cols(updates.keys())])
        params = list(updates.values()) + [unit_id]
        await self.execute_write_async(f"UPDATE vector_units SET {cols} WHERE unit_id=?", tuple(params))

    async def insert_vector_unit(self, unit_id: str, name: str, platform: str,
                                 unit_token: str, registered_at: str, claimed_at: str) -> None:
        # hardware/safety_floors/home_position are NOT NULL without defaults in
        # the canonical schema; seed them empty so claiming a unit never fails.
        sql = ("INSERT INTO vector_units (unit_id, name, platform, unit_token, "
               "registered_at, claimed_at, hardware, safety_floors, home_position) "
               "VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}')")
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

    # Statuses with a matching <status>_at timestamp column on vector_commands.
    _COMMAND_TIMESTAMP_STATUSES = {"dispatched", "acknowledged", "completed"}

    async def update_command_status(
            self, command_id: str, status: str) -> None:
        if status in self._COMMAND_TIMESTAMP_STATUSES:
            sql = f"UPDATE vector_commands SET status=?, {status}_at=? WHERE command_id=?"
            await self.execute_write_async(sql, (status, _now_str(), command_id))
        else:
            # e.g. "rejected" has no timestamp column; only update the status.
            sql = "UPDATE vector_commands SET status=? WHERE command_id=?"
            await self.execute_write_async(sql, (status, command_id))

    async def insert_telemetry(self, fields: dict) -> None:
        cols = ", ".join(_safe_cols(fields.keys()))
        placeholders = ", ".join(["?"] * len(fields))
        sql = f"INSERT INTO vector_telemetry ({cols}) VALUES ({placeholders})"
        await self.execute_write_async(sql, tuple(fields.values()))

    async def insert_alert(self, fields: dict) -> None:
        cols = ", ".join(_safe_cols(fields.keys()))
        placeholders = ", ".join(["?"] * len(fields))
        sql = f"INSERT INTO vector_alerts ({cols}) VALUES ({placeholders})"
        await self.execute_write_async(sql, tuple(fields.values()))

    async def insert_session_event(
            self, session_id: str, unit_id: str, event: str, data: str) -> None:
        sql = "INSERT INTO vector_session_events (session_id, unit_id, timestamp, event, data) VALUES (?, ?, ?, ?, ?)"
        await self.execute_write_async(sql, (session_id, unit_id, _now_str(), event, data))

    async def insert_session(self, session_id: str, unit_id: str, config_version: int, program_id: str = None) -> None:  # type: ignore
        sql = "INSERT INTO vector_sessions (session_id, unit_id, program_id, config_version, started_at, status) VALUES (?, ?, ?, ?, ?, 'active')"
        await self.execute_write_async(sql, (session_id, unit_id, program_id, config_version, _now_str()))

    async def update_session(self, session_id: str, fields: dict) -> None:
        cols = ", ".join([f"{k}=?" for k in _safe_cols(fields.keys())])
        params = list(fields.values()) + [session_id]
        await self.execute_write_async(f"UPDATE vector_sessions SET {cols} WHERE session_id=?", tuple(params))

    async def get_active_schedules(self) -> list[dict]:
        sql = "SELECT * FROM vector_schedules WHERE enabled = 1"
        return await self.execute_read_async(sql)

    async def update_schedule(self, schedule_id: str,
                              last_run: str, next_run: str) -> None:
        sql = "UPDATE vector_schedules SET last_run=?, next_run=? WHERE schedule_id=?"
        await self.execute_write_async(sql, (last_run, next_run, schedule_id))

    async def prune_telemetry(self, unit_id: str,
                              older_than_days: int) -> None:
        # Full query per spec 14.4 is "deletes vector_telemetry older than VECTOR_TELEMETRY_RETENTION_DAYS (default 90)"
        # And downsamples rows 7+ days old
        # For simplicity in this SQLite store, we'll implement simple drop,
        # downsample can be implemented in daemon logic if needed, or simple
        # prune here.
        sql = "DELETE FROM vector_telemetry WHERE unit_id=? AND timestamp < datetime('now', ? || ' days')"
        await self.execute_write_async(sql, (unit_id, f"-{older_than_days}"))

    # Adding simple generic list access for UI routes
    async def get_zones(
        self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_zones")

    async def get_programs(
        self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_programs")

    async def get_schedules(
        self) -> list[dict]: return await self.execute_read_async("SELECT * FROM vector_schedules")

    async def get_sessions(self) -> list[dict]: return await self.execute_read_async(
        "SELECT * FROM vector_sessions ORDER BY started_at DESC LIMIT 100")
