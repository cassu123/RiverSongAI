# =============================================================================
# providers/memory/store/users.py
#
# File Purpose:
#   User accounts, JWT revocation, TOTP, Google OAuth and parent-child links.
#   UsersStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from providers.memory.store._util import (
    _dt_to_str,
    _now_str,
)


class UsersStoreMixin:
    """User accounts, JWT revocation, TOTP, Google OAuth and parent-child links.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """
    # -------------------------------------------------------------------------
    # JWT Revocation
    # -------------------------------------------------------------------------

    async def revoke_token(self, jti: str, user_id: str,
                           expires_at: datetime) -> None:
        await self._run(self._sync_revoke_token, jti, user_id, expires_at)

    def _sync_revoke_token(self, jti: str, user_id: str,
                           expires_at: datetime) -> None:
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
        row = conn.execute(
            "SELECT 1 FROM revoked_tokens WHERE jti=?", (jti,)).fetchone()
        return row is not None

    async def delete_expired_tokens(self) -> int:
        return await self._run(self._sync_delete_expired_tokens)

    def _sync_delete_expired_tokens(self) -> int:
        conn = self._get_conn()
        res = conn.execute(
            "DELETE FROM revoked_tokens WHERE expires_at < ?", (_now_str(),))
        conn.commit()
        return res.rowcount

    # =========================================================================
    # User auth methods
    # =========================================================================

    async def create_user(self, id: str, email: str, password_hash: str,
                          display_name: str, role: str = "user", is_approved: bool = False) -> None:
        await self._run(self._sync_create_user, id, email, password_hash, display_name, role, is_approved)

    def _sync_create_user(self, id: str, email: str, password_hash: str,
                          display_name: str, role: str, is_approved: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, force_password_change, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (id, email, password_hash, display_name,
             role, int(is_approved), 0, now, now),
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
        
    async def get_all_users(self) -> list[dict]:
        return await self._run(self._sync_get_all_users)

    def _sync_get_all_users(self) -> list[dict]:
        conn = self._get_conn()
        cursor = conn.execute(
            """
            SELECT id, email, name, role, is_active, is_approved,
                   force_password_change, created_at
            FROM users
            """
        )
        return [
            {
                "id": row[0],
                "email": row[1],
                "name": row[2],
                "role": row[3],
                "is_active": bool(row[4]),
                "is_approved": bool(row[5]),
                "force_password_change": bool(row[6]),
                "created_at": row[7]
            }
            for row in cursor.fetchall()
        ]

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
        conn.execute(
            "UPDATE users SET theme=?, updated_at=? WHERE id=?",
            (theme,
             _now_str(),
             user_id))
        conn.commit()

    async def update_user_palette(self, user_id: str, palette: str) -> None:
        await self._run(self._sync_update_user_palette, user_id, palette)

    def _sync_update_user_palette(self, user_id: str, palette: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET palette=?, updated_at=? WHERE id=?",
            (palette,
             _now_str(),
             user_id))
        conn.commit()

    async def update_user_environment(
            self, user_id: str, environment: str) -> None:
        await self._run(self._sync_update_user_environment, user_id, environment)

    def _sync_update_user_environment(
            self, user_id: str, environment: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET environment=?, updated_at=? WHERE id=?",
            (environment,
             _now_str(),
             user_id))
        conn.commit()

    async def update_user_universe(self, user_id: str, universe: str) -> None:
        await self._run(self._sync_update_user_universe, user_id, universe)

    def _sync_update_user_universe(self, user_id: str, universe: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET universe=?, updated_at=? WHERE id=?",
            (universe,
             _now_str(),
             user_id))
        conn.commit()

    async def update_user_mood(self, user_id: str, mood: str) -> None:
        await self._run(self._sync_update_user_mood, user_id, mood)

    def _sync_update_user_mood(self, user_id: str, mood: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET mood=?, updated_at=? WHERE id=?",
            (mood,
             _now_str(),
             user_id))
        conn.commit()

    async def email_exists(self, email: str) -> bool:
        return await self._run(self._sync_email_exists, email)

    def _sync_email_exists(self, email: str) -> bool:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        return row is not None

    async def has_admin(self) -> bool:
        return await self._run(self._sync_has_admin)

    def _sync_has_admin(self) -> bool:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone()
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

    async def update_user(self, user_id: str, role: Optional[str] = None, is_approved: Optional[bool]
                          = None, force_password_change: Optional[bool] = None, is_suspended: Optional[bool] = None) -> bool:
        return await self._run(self._sync_update_user, user_id, role, is_approved, force_password_change, is_suspended)

    def _sync_update_user(self, user_id: str, role: Optional[str], is_approved: Optional[bool],
                          force_password_change: Optional[bool], is_suspended: Optional[bool]) -> bool:
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
            vals.append(int(is_approved))  # type: ignore
        if force_password_change is not None:
            parts.append("force_password_change = ?")
            vals.append(int(force_password_change))  # type: ignore
        if is_suspended is not None:
            parts.append("is_suspended = ?")
            vals.append(int(is_suspended))  # type: ignore
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

    async def update_user_password(
            self, user_id: str, password_hash: str, force_change: bool = False) -> None:
        await self._run(self._sync_update_user_password, user_id, password_hash, force_change)

    def _sync_update_user_password(
            self, user_id: str, password_hash: str, force_change: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        force_val = 1 if force_change else 0
        conn.execute(
            "UPDATE users SET password_hash = ?, force_password_change = ?, updated_at = ? WHERE id = ?",
            (password_hash, force_val, now, user_id)
        )
        conn.commit()

    # -------------------------------------------------------------------------
    # TOTP 2FA (Q1#5)
    # -------------------------------------------------------------------------

    async def get_totp_state(self, user_id: str) -> dict:
        """Return {enabled, secret, recovery_codes (list of bcrypt hashes)}."""
        return await self._run(self._sync_get_totp_state, user_id)

    def _sync_get_totp_state(self, user_id: str) -> dict:
        conn = self._get_conn()
        cur = conn.execute(
            "SELECT totp_enabled, totp_secret, totp_recovery_codes FROM users WHERE id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return {"enabled": False, "secret": "", "recovery_codes": []}
        try:
            recovery = json.loads(row[2]) if row[2] else []
            if not isinstance(recovery, list):
                recovery = []
        except (ValueError, TypeError):
            recovery = []
        return {
            "enabled": bool(row[0]),
            "secret": row[1] or "",
            "recovery_codes": recovery,
        }

    async def enable_totp(self, user_id: str, secret: str,
                          recovery_hashes: list[str]) -> None:
        await self._run(self._sync_enable_totp, user_id, secret, recovery_hashes)

    def _sync_enable_totp(self, user_id: str, secret: str,
                          recovery_hashes: list[str]) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_recovery_codes = ?, updated_at = ? WHERE id = ?",
            (secret, json.dumps(recovery_hashes), now, user_id),
        )
        conn.commit()

    async def disable_totp(self, user_id: str) -> None:
        await self._run(self._sync_disable_totp, user_id)

    def _sync_disable_totp(self, user_id: str) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "UPDATE users SET totp_secret = '', totp_enabled = 0, totp_recovery_codes = '', updated_at = ? WHERE id = ?",
            (now, user_id),
        )
        conn.commit()

    async def consume_recovery_code(self, user_id: str, index: int) -> None:
        """Remove a single recovery code (by index) from the stored list."""
        await self._run(self._sync_consume_recovery_code, user_id, index)

    def _sync_consume_recovery_code(self, user_id: str, index: int) -> None:
        state = self._sync_get_totp_state(user_id)
        codes = state["recovery_codes"]
        if 0 <= index < len(codes):
            codes.pop(index)
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "UPDATE users SET totp_recovery_codes = ?, updated_at = ? WHERE id = ?",
            (json.dumps(codes), now, user_id),
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
        conn.execute(
            "UPDATE users SET tokens_valid_after = ?, updated_at = ? WHERE id = ?",
            (now,
             now,
             user_id))
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
        return {"id": row[0], "email": row[1], "password_hash": row[2], "display_name": row[3], "role": row[4],
                "is_approved": bool(row[5]), "created_at": row[6], "google_id": row[7], "google_email": row[8]}

    async def link_google_account(
            self, user_id: str, google_id: str, google_email: str) -> None:
        await self._run(self._sync_link_google_account, user_id, google_id, google_email)

    def _sync_link_google_account(
            self, user_id: str, google_id: str, google_email: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE users SET google_id=?, google_email=?, updated_at=? WHERE id=?",
            (google_id, google_email, _now_str(), user_id),
        )
        conn.commit()

    async def create_google_user(self, id: str, email: str, display_name: str, google_id: str,
                                 google_email: str, role: str = "user", is_approved: bool = True) -> None:
        await self._run(self._sync_create_google_user, id, email, display_name, google_id, google_email, role, is_approved)

    def _sync_create_google_user(self, id: str, email: str, display_name: str,
                                 google_id: str, google_email: str, role: str, is_approved: bool) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, is_approved, google_id, google_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (id, email, "", display_name, role, int(
                is_approved), google_id, google_email, now, now),
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
        return [{"parent_id": r[0], "child_id": r[1], "created_at": r[2]}
                for r in rows]

    # =========================================================================
    # Child feature settings (parent-controlled per-child feature access)
    # =========================================================================

    async def get_child_features(self, child_id: str) -> list[str]:
        return await self._run(self._sync_get_child_features, child_id)

    def _sync_get_child_features(self, child_id: str) -> list[str]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT enabled_features FROM child_features WHERE child_id=?", (
                child_id,)
        ).fetchone()
        if not row:
            return []
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return []

    async def set_child_features(
            self, child_id: str, features: list[str]) -> None:
        await self._run(self._sync_set_child_features, child_id, features)

    def _sync_set_child_features(
            self, child_id: str, features: list[str]) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO child_features (child_id, enabled_features) VALUES (?,?)",
            (child_id, json.dumps(features)),
        )
