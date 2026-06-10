# =============================================================================
# providers/memory/store/integrations.py
#
# File Purpose:
#   Per-user OAuth integrations, OAuth nonces and global integrations config.
#   IntegrationsStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from providers.memory.store._util import (
    _now_str,
)


class IntegrationsStoreMixin:
    """Per-user OAuth integrations, OAuth nonces and global integrations config.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """
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
        return [{"service": row[0], "metadata": json.loads(
            row[1]), "is_active": row[2]} for row in cur.fetchall()]

    async def get_user_integration(
            self, user_id: str, service: str) -> Optional[dict]:
        return await self._run(self._sync_get_user_integration, user_id, service)

    def _sync_get_user_integration(
            self, user_id: str, service: str) -> Optional[dict]:
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

        cur.execute(
            "SELECT metadata FROM user_integrations WHERE user_id = ? AND service = ?",
            (user_id,
             service))
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
                (access_token, refresh_token, token_expires_at,
                 meta_str, now, user_id, service)
            )
        else:
            meta_str = json.dumps(metadata) if metadata else '{}'
            cur.execute(
                """
                INSERT INTO user_integrations
                (id, user_id, service, access_token, refresh_token, token_expires_at, metadata, is_active, connected_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (new_id, user_id, service, access_token,
                 refresh_token, token_expires_at, meta_str, now, now)
            )
        conn.commit()

    async def deactivate_user_integration(
            self, user_id: str, service: str) -> None:
        await self._run(self._sync_deactivate_user_integration, user_id, service)

    def _sync_deactivate_user_integration(
            self, user_id: str, service: str) -> None:
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

    async def consume_oauth_nonce(
            self, nonce: str, service: str) -> Optional[str]:
        """
        Validate, consume (delete), and return the user_id bound to ``nonce``
        for ``service``. Returns None if the nonce is missing, expired, or
        bound to a different service.
        """
        return await self._run(self._sync_consume_oauth_nonce, nonce, service)

    def _sync_consume_oauth_nonce(
            self, nonce: str, service: str) -> Optional[str]:
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

    async def get_integrations(self) -> dict:
        config = await self.get_admin_config()
        return config.get("integrations", {})

    async def set_integrations(self, integrations: dict) -> None:
        config = await self.get_admin_config()
        config["integrations"] = integrations
        await self.set_admin_config(config)
