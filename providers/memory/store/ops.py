# =============================================================================
# providers/memory/store/ops.py
#
# File Purpose:
#   Webhook tokens, model compare runs and remote Ollama rigs.
#   OpsStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from providers.memory.store._util import (
    _now_str,
)


class OpsStoreMixin:
    """Webhook tokens, model compare runs and remote Ollama rigs.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

    # -------------------------------------------------------------------------
    # Webhook tokens (Q2#10)
    # -------------------------------------------------------------------------

    async def create_webhook_token(
        self,
        label: str,
        token_hash: str,
        scopes: list,
        created_by: str,
        expires_at: Optional[str] = None,
    ) -> dict:
        return await self._run(
            self._sync_create_webhook_token,
            label, token_hash, scopes, created_by, expires_at,
        )

    def _sync_create_webhook_token(
        self,
        label: str,
        token_hash: str,
        scopes: list,
        created_by: str,
        expires_at: Optional[str],
    ) -> dict:
        conn = self._get_conn()
        token_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO webhook_tokens (id, label, token_hash, scopes_json, created_by, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (token_id, label, token_hash, json.dumps(
                scopes or []), created_by, now, expires_at),
        )
        conn.execute(
            "INSERT INTO webhook_token_audit (token_id, action, detail, actor, ts) VALUES (?, ?, ?, ?, ?)",
            (token_id, "issued", json.dumps(
                {"label": label, "scopes": scopes}), created_by, now),
        )
        conn.commit()
        return {
            "id": token_id,
            "label": label,
            "scopes": scopes or [],
            "created_by": created_by,
            "created_at": now,
            "expires_at": expires_at,
            "revoked_at": None,
        }

    async def list_webhook_tokens(
            self, include_revoked: bool = False) -> List[dict]:
        return await self._run(self._sync_list_webhook_tokens, include_revoked)

    def _sync_list_webhook_tokens(self, include_revoked: bool) -> List[dict]:
        conn = self._get_conn()
        sql = (
            "SELECT id, label, scopes_json, created_by, created_at, expires_at, "
            "revoked_at, last_used_at, use_count FROM webhook_tokens"
        )
        if not include_revoked:
            sql += " WHERE revoked_at IS NULL"
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql).fetchall()
        out: List[dict] = []
        for r in rows:
            try:
                scopes = json.loads(r[2]) if r[2] else []
            except (ValueError, TypeError):
                scopes = []
            out.append({
                "id": r[0],
                "label": r[1],
                "scopes": scopes,
                "created_by": r[3],
                "created_at": r[4],
                "expires_at": r[5],
                "revoked_at": r[6],
                "last_used_at": r[7],
                "use_count": int(r[8] or 0),
            })
        return out

    async def get_webhook_token_by_hash(
            self, token_hash: str) -> Optional[dict]:
        return await self._run(self._sync_get_webhook_token_by_hash, token_hash)

    def _sync_get_webhook_token_by_hash(
            self, token_hash: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, label, scopes_json, created_by, created_at, expires_at, revoked_at "
            "FROM webhook_tokens WHERE token_hash=?",
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        try:
            scopes = json.loads(row[2]) if row[2] else []
        except (ValueError, TypeError):
            scopes = []
        return {
            "id": row[0],
            "label": row[1],
            "scopes": scopes,
            "created_by": row[3],
            "created_at": row[4],
            "expires_at": row[5],
            "revoked_at": row[6],
        }

    async def revoke_webhook_token(self, token_id: str, actor: str) -> bool:
        return await self._run(self._sync_revoke_webhook_token, token_id, actor)

    def _sync_revoke_webhook_token(self, token_id: str, actor: str) -> bool:
        conn = self._get_conn()
        now = _now_str()
        cur = conn.execute(
            "UPDATE webhook_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
            (now, token_id),
        )
        if cur.rowcount > 0:
            conn.execute(
                "INSERT INTO webhook_token_audit (token_id, action, detail, actor, ts) VALUES (?, ?, ?, ?, ?)",
                (token_id, "revoked", "", actor, now),
            )
            conn.commit()
            return True
        conn.commit()
        return False

    async def record_webhook_token_use(
            self, token_id: str, detail: str = "") -> None:
        await self._run(self._sync_record_webhook_token_use, token_id, detail)

    def _sync_record_webhook_token_use(
            self, token_id: str, detail: str) -> None:
        conn = self._get_conn()
        now = _now_str()
        conn.execute(
            "UPDATE webhook_tokens SET last_used_at=?, use_count=use_count+1 WHERE id=?",
            (now, token_id),
        )
        conn.execute(
            "INSERT INTO webhook_token_audit (token_id, action, detail, actor, ts) VALUES (?, ?, ?, ?, ?)",
            (token_id, "used", detail, None, now),
        )
        conn.commit()

    async def list_webhook_token_audit(
            self, token_id: Optional[str] = None, limit: int = 200) -> List[dict]:
        return await self._run(self._sync_list_webhook_token_audit, token_id, limit)

    def _sync_list_webhook_token_audit(
            self, token_id: Optional[str], limit: int) -> List[dict]:
        conn = self._get_conn()
        if token_id:
            rows = conn.execute(
                "SELECT id, token_id, action, detail, actor, ts FROM webhook_token_audit "
                "WHERE token_id=? ORDER BY ts DESC LIMIT ?",
                (token_id, int(limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, token_id, action, detail, actor, ts FROM webhook_token_audit "
                "ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [
            {"id": r[0], "token_id": r[1], "action": r[2],
                "detail": r[3], "actor": r[4], "ts": r[5]}
            for r in rows
        ]

    # -------------------------------------------------------------------------
    # Blind model comparison (Q3#12)
    # -------------------------------------------------------------------------

    async def create_compare_run(
        self,
        owner_id: str,
        prompt: str,
        prompt_hash: str,
        model_a: dict,
        model_b: dict,
        response_a: str,
        response_b: str,
    ) -> dict:
        return await self._run(
            self._sync_create_compare_run,
            owner_id, prompt, prompt_hash, model_a, model_b, response_a, response_b,
        )

    def _sync_create_compare_run(
        self,
        owner_id: str,
        prompt: str,
        prompt_hash: str,
        model_a: dict,
        model_b: dict,
        response_a: str,
        response_b: str,
    ) -> dict:
        conn = self._get_conn()
        run_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO compare_history (id, owner_id, prompt_hash, prompt, "
            "model_a_provider, model_a_id, model_b_provider, model_b_id, "
            "response_a, response_b, winner, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)",
            (
                run_id, owner_id, prompt_hash, prompt,
                model_a.get("provider", ""), model_a.get("model", ""),
                model_b.get("provider", ""), model_b.get("model", ""),
                response_a, response_b, now,
            ),
        )
        conn.commit()
        return {
            "id": run_id,
            "prompt": prompt,
            "model_a": model_a,
            "model_b": model_b,
            "response_a": response_a,
            "response_b": response_b,
            "winner": "",
            "created_at": now,
        }

    async def record_compare_vote(
            self, run_id: str, owner_id: str, winner: str) -> Optional[dict]:
        return await self._run(self._sync_record_compare_vote, run_id, owner_id, winner)

    def _sync_record_compare_vote(
            self, run_id: str, owner_id: str, winner: str) -> Optional[dict]:
        if winner not in {"a", "b", "tie"}:
            return None
        conn = self._get_conn()
        now = _now_str()
        cur = conn.execute(
            "UPDATE compare_history SET winner=?, voted_at=? "
            "WHERE id=? AND owner_id=? AND (winner='' OR winner IS NULL)",
            (winner, now, run_id, owner_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
        return self._sync_get_compare_run(owner_id, run_id)

    async def get_compare_run(self, owner_id: str,
                              run_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_compare_run, owner_id, run_id)

    def _sync_get_compare_run(self, owner_id: str,
                              run_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, prompt, model_a_provider, model_a_id, model_b_provider, "
            "model_b_id, response_a, response_b, winner, created_at, voted_at "
            "FROM compare_history WHERE id=? AND owner_id=?",
            (run_id, owner_id),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "prompt": row[1],
            "model_a": {"provider": row[2], "model": row[3]},
            "model_b": {"provider": row[4], "model": row[5]},
            "response_a": row[6],
            "response_b": row[7],
            "winner": row[8],
            "created_at": row[9],
            "voted_at": row[10],
        }

    async def list_compare_history(
            self, owner_id: str, limit: int = 50) -> List[dict]:
        return await self._run(self._sync_list_compare_history, owner_id, limit)

    def _sync_list_compare_history(
            self, owner_id: str, limit: int) -> List[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, prompt, model_a_provider, model_a_id, model_b_provider, "
            "model_b_id, winner, created_at, voted_at "
            "FROM compare_history WHERE owner_id=? "
            "ORDER BY created_at DESC LIMIT ?",
            (owner_id, int(limit)),
        ).fetchall()
        return [
            {
                "id": r[0],
                "prompt": r[1],
                "model_a": {"provider": r[2], "model": r[3]},
                "model_b": {"provider": r[4], "model": r[5]},
                "winner": r[6],
                "created_at": r[7],
                "voted_at": r[8],
            }
            for r in rows
        ]

    async def compare_leaderboard(
            self, owner_id: Optional[str] = None) -> List[dict]:
        """Aggregate win-counts per (provider, model) across voted runs."""
        return await self._run(self._sync_compare_leaderboard, owner_id)

    def _sync_compare_leaderboard(self, owner_id: Optional[str]) -> List[dict]:
        conn = self._get_conn()
        params: tuple = ()
        scope = ""
        if owner_id:
            scope = " AND owner_id=?"
            params = (owner_id,)
        rows_a = conn.execute(
            "SELECT model_a_provider, model_a_id, "
            "SUM(CASE WHEN winner='a' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN winner='tie' THEN 1 ELSE 0 END), "
            "COUNT(*) "
            "FROM compare_history WHERE winner!='' " + scope +
            " GROUP BY model_a_provider, model_a_id",
            params,
        ).fetchall()
        rows_b = conn.execute(
            "SELECT model_b_provider, model_b_id, "
            "SUM(CASE WHEN winner='b' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN winner='tie' THEN 1 ELSE 0 END), "
            "COUNT(*) "
            "FROM compare_history WHERE winner!='' " + scope +
            " GROUP BY model_b_provider, model_b_id",
            params,
        ).fetchall()
        stats: dict = {}
        for prov, mid, wins, ties, total in list(rows_a) + list(rows_b):
            key = (prov or "", mid or "")
            entry = stats.setdefault(
                key, {"provider": prov, "model": mid, "wins": 0, "ties": 0, "total": 0})
            entry["wins"] += int(wins or 0)
            entry["ties"] += int(ties or 0)
            entry["total"] += int(total or 0)
        out = list(stats.values())
        for e in out:
            e["losses"] = max(0, e["total"] - e["wins"] - e["ties"])
            e["win_rate"] = round(
                e["wins"] / e["total"],
                3) if e["total"] else 0.0
        out.sort(key=lambda r: (-r["win_rate"], -r["wins"]))
        return out

    # -------------------------------------------------------------------------
    # Remote Ollama rigs (Q3#14)
    # -------------------------------------------------------------------------

    async def list_remote_rigs(
            self, *, include_inactive: bool = True) -> List[dict]:
        return await self._run(self._sync_list_remote_rigs, include_inactive)

    def _sync_list_remote_rigs(self, include_inactive: bool) -> List[dict]:
        conn = self._get_conn()
        sql = (
            "SELECT id, label, base_url, is_active, notes, last_health, "
            "last_checked_at, last_models, created_by, created_at, updated_at "
            "FROM remote_ollama_rigs"
        )
        if not include_inactive:
            sql += " WHERE is_active=1"
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql).fetchall()
        return [self._row_to_rig(r) for r in rows]

    @staticmethod
    def _row_to_rig(row) -> dict:
        try:
            models = json.loads(row[7]) if row[7] else []
            if not isinstance(models, list):
                models = []
        except (ValueError, TypeError):
            models = []
        return {
            "id": row[0],
            "label": row[1],
            "base_url": row[2],
            "is_active": bool(row[3]),
            "notes": row[4],
            "last_health": row[5],
            "last_checked_at": row[6],
            "last_models": models,
            "created_by": row[8],
            "created_at": row[9],
            "updated_at": row[10],
        }

    async def get_remote_rig(self, rig_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_remote_rig, rig_id)

    def _sync_get_remote_rig(self, rig_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, label, base_url, is_active, notes, last_health, "
            "last_checked_at, last_models, created_by, created_at, updated_at "
            "FROM remote_ollama_rigs WHERE id=?",
            (rig_id,),
        ).fetchone()
        return self._row_to_rig(row) if row else None

    async def create_remote_rig(
        self,
        label: str,
        base_url: str,
        notes: str,
        created_by: str,
    ) -> dict:
        return await self._run(
            self._sync_create_remote_rig, label, base_url, notes, created_by
        )

    def _sync_create_remote_rig(
        self, label: str, base_url: str, notes: str, created_by: str
    ) -> dict:
        conn = self._get_conn()
        rig_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO remote_ollama_rigs (id, label, base_url, is_active, notes, "
            "last_health, last_checked_at, last_models, created_by, created_at, updated_at) "
            "VALUES (?, ?, ?, 1, ?, 'unknown', NULL, '[]', ?, ?, ?)",
            (rig_id, label, base_url, notes, created_by, now, now),
        )
        conn.commit()
        return self._sync_get_remote_rig(rig_id)  # type: ignore

    async def update_remote_rig(
        self,
        rig_id: str,
        *,
        label: Optional[str] = None,
        base_url: Optional[str] = None,
        notes: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[dict]:
        return await self._run(
            self._sync_update_remote_rig, rig_id, label, base_url, notes, is_active
        )

    def _sync_update_remote_rig(
        self,
        rig_id: str,
        label: Optional[str],
        base_url: Optional[str],
        notes: Optional[str],
        is_active: Optional[bool],
    ) -> Optional[dict]:
        existing = self._sync_get_remote_rig(rig_id)
        if existing is None:
            return None
        new_label = existing["label"] if label is None else label
        new_url = existing["base_url"] if base_url is None else base_url
        new_notes = existing["notes"] if notes is None else notes
        new_act = existing["is_active"] if is_active is None else bool(
            is_active)
        now = _now_str()
        conn = self._get_conn()
        conn.execute(
            "UPDATE remote_ollama_rigs SET label=?, base_url=?, notes=?, is_active=?, updated_at=? WHERE id=?",
            (new_label, new_url, new_notes, 1 if new_act else 0, now, rig_id),
        )
        conn.commit()
        return self._sync_get_remote_rig(rig_id)

    async def record_remote_rig_health(
        self, rig_id: str, *, health: str, models: List[str]
    ) -> Optional[dict]:
        return await self._run(self._sync_record_remote_rig_health, rig_id, health, models)

    def _sync_record_remote_rig_health(
        self, rig_id: str, health: str, models: List[str]
    ) -> Optional[dict]:
        if health not in {"ok", "down", "unknown"}:
            health = "unknown"
        now = _now_str()
        conn = self._get_conn()
        cur = conn.execute(
            "UPDATE remote_ollama_rigs SET last_health=?, last_checked_at=?, last_models=?, updated_at=? WHERE id=?",
            (health, now, json.dumps(list(models or [])), now, rig_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
        return self._sync_get_remote_rig(rig_id)

    async def delete_remote_rig(self, rig_id: str) -> bool:
        return await self._run(self._sync_delete_remote_rig, rig_id)

    def _sync_delete_remote_rig(self, rig_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM remote_ollama_rigs WHERE id=?", (rig_id,))
        conn.commit()
        return cur.rowcount > 0
