# =============================================================================
# providers/memory/store/family.py
#
# File Purpose:
#   Family groups, memberships and routines.
#   FamilyStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
import uuid
from typing import Optional

from providers.memory.store._util import (
    _now_str,
)


class FamilyStoreMixin:
    """Family groups, memberships and routines.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

    # =========================================================================
    # Family Groups
    # =========================================================================

    def _row_to_family_group(self, row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "shared_modules": json.loads(row["shared_modules"] or "[]"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    async def create_family_group(
            self, group_id: str, name: str, shared_modules: list) -> dict:
        return await self._run(self._sync_create_family_group, group_id, name, shared_modules)

    def _sync_create_family_group(
            self, group_id: str, name: str, shared_modules: list) -> dict:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO family_groups (id, name, shared_modules, created_at, updated_at) VALUES (?,?,?,?,?)",
            (group_id, name, json.dumps(shared_modules), now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
        return self._row_to_family_group(row)

    async def get_family_group(self, group_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_family_group, group_id)

    def _sync_get_family_group(self, group_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
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
            r["id"]: {
                "id": r["id"],
                "display_name": r["display_name"],
                "email": r["email"],
                "role": r["role"]}
            for r in conn.execute("SELECT id, display_name, email, role FROM users").fetchall()
        }
        members_rows = conn.execute(
            "SELECT * FROM family_memberships ORDER BY joined_at ASC"
        ).fetchall()
        member_map: dict = {g["id"]: [] for g in groups}
        for m in members_rows:
            gid = m["family_group_id"]
            if gid in member_map:
                user = users.get(
                    m["profile_id"], {
                        "id": m["profile_id"], "display_name": m["profile_id"], "email": "", "role": ""})
                member_map[gid].append({
                    "profile_id": m["profile_id"],
                    "display_name": user["display_name"],
                    "email": user["email"],
                    "role": user["role"],
                    "relationship": m["relationship"],
                    "joined_at": m["joined_at"],
                })
        for g in groups:
            g["members"] = member_map.get(g["id"], [])
        return groups

    async def update_family_group(
            self, group_id: str, name: Optional[str], shared_modules: Optional[list]) -> Optional[dict]:
        return await self._run(self._sync_update_family_group, group_id, name, shared_modules)

    def _sync_update_family_group(
            self, group_id: str, name: Optional[str], shared_modules: Optional[list]) -> Optional[dict]:
        conn = self._get_conn()
        parts, vals = [], []
        if name is not None:
            parts.append("name = ?")
            vals.append(name)
        if shared_modules is not None:
            parts.append("shared_modules = ?")
            vals.append(json.dumps(shared_modules))
        if not parts:
            row = conn.execute(
                "SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
            return self._row_to_family_group(row) if row else None
        parts.append("updated_at = ?")
        vals.append(_now_str())
        vals.append(group_id)
        conn.execute(
            "UPDATE family_groups SET " +
            ", ".join(parts) +
            " WHERE id=?",
            vals)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
        return self._row_to_family_group(row) if row else None

    async def delete_family_group(self, group_id: str) -> None:
        await self._run(self._sync_delete_family_group, group_id)

    def _sync_delete_family_group(self, group_id: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM family_memberships WHERE family_group_id=?", (group_id,))
        conn.execute("DELETE FROM family_groups WHERE id=?", (group_id,))
        conn.commit()

    async def add_family_member(
            self, group_id: str, profile_id: str, relationship: str) -> dict:
        return await self._run(self._sync_add_family_member, group_id, profile_id, relationship)

    def _sync_add_family_member(
            self, group_id: str, profile_id: str, relationship: str) -> dict:
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
        return {"profile_id": profile_id,
                "family_group_id": group_id, "relationship": relationship}

    async def remove_family_member(
            self, group_id: str, profile_id: str) -> None:
        await self._run(self._sync_remove_family_member, group_id, profile_id)

    def _sync_remove_family_member(
            self, group_id: str, profile_id: str) -> None:
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
            "id": row["id"],
            "name": row["name"],
            "shared_modules": json.loads(row["shared_modules"] or "[]"),
            "relationship": row["relationship"],
        }

    # =========================================================================
    # Routines
    # =========================================================================

    def _row_to_routine(self, row) -> dict:
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "name": row["name"],
            "trigger": row["trigger"],
            "time": row["time"],
            "days": json.loads(row["days"] or "[]"),
            "prompt": row["prompt"],
            "type": row["type"],
            "severity": row.get("severity", "info"),
            "webhook_url": row["webhook_url"],
            "enabled": bool(row["enabled"]),
            "last_run": row["last_run"],
            "last_output": row.get("last_output"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
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
                (id, user_id, name, trigger, time, days, prompt, type, severity, webhook_url, enabled, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (rid, routine["user_id"], routine["name"], routine.get("trigger", "manual"),
             routine.get("time"), json.dumps(
                routine.get(
                    "days", [])), routine.get(
                "prompt", ""),
                routine.get("type", "simple"),
                routine.get("severity", "info"), routine.get("webhook_url"),
                int(routine.get("enabled", True)), now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM routines WHERE id=?", (rid,)).fetchone()
        return self._row_to_routine(row)

    async def update_routine(self, routine_id: str,
                             user_id: str, fields: dict) -> Optional[dict]:
        return await self._run(self._sync_update_routine, routine_id, user_id, fields)

    def _sync_update_routine(self, routine_id: str,
                             user_id: str, fields: dict) -> Optional[dict]:
        conn = self._get_conn()
        allowed = {
            "name",
            "trigger",
            "time",
            "days",
            "prompt",
            "type",
            "severity",
            "webhook_url",
            "enabled",
            "last_run",
            "last_output"}
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
            "UPDATE routines SET " +
            ", ".join(set_parts) + " WHERE id=? AND user_id=?",
            vals,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM routines WHERE id=? AND user_id=?",
            (routine_id,
             user_id)).fetchone()
        return self._row_to_routine(row) if row else None

    async def delete_routine(self, routine_id: str, user_id: str) -> bool:
        return await self._run(self._sync_delete_routine, routine_id, user_id)

    def _sync_delete_routine(self, routine_id: str, user_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM routines WHERE id=? AND user_id=?", (routine_id, user_id))
        conn.commit()
        return cur.rowcount > 0

    async def get_enabled_routines(self) -> list:
        return await self._run(self._sync_get_enabled_routines)

    def _sync_get_enabled_routines(self) -> list:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM routines WHERE enabled=1",
        ).fetchall()
        return [self._row_to_routine(r) for r in rows]
