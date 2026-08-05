# =============================================================================
# providers/memory/store/content.py
#
# File Purpose:
#   Documents workspace, skills, session presets and reading shelf.
#   ContentStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from providers.memory.store._util import (
    _now_str,
)


class ContentStoreMixin:
    """Documents workspace, skills, session presets and reading shelf.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

    # -------------------------------------------------------------------------
    # Documents workspace (Q2#6)
    # -------------------------------------------------------------------------

    async def list_documents(self, owner_id: str) -> List[dict]:
        return await self._run(self._sync_list_documents, owner_id)

    def _sync_list_documents(self, owner_id: str) -> List[dict]:
        conn = self._get_conn()
        cur = conn.execute(
            "SELECT id, title, kind, pinned, created_at, updated_at, LENGTH(body) "
            "FROM documents WHERE owner_id=? ORDER BY pinned DESC, updated_at DESC",
            (owner_id,),
        )
        out: List[dict] = []
        for row in cur.fetchall():
            out.append({
                "id": row[0],
                "title": row[1],
                "kind": row[2],
                "pinned": bool(row[3]),
                "created_at": row[4],
                "updated_at": row[5],
                "size": int(row[6] or 0),
            })
        return out

    async def get_document(self, owner_id: str, doc_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_document, owner_id, doc_id)

    def _sync_get_document(self, owner_id: str, doc_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, title, kind, body, pinned, created_at, updated_at "
            "FROM documents WHERE id=? AND owner_id=?",
            (doc_id, owner_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "title": row[1],
            "kind": row[2],
            "body": row[3],
            "pinned": bool(row[4]),
            "created_at": row[5],
            "updated_at": row[6],
        }

    async def count_documents(self, owner_id: str) -> int:
        return await self._run(self._sync_count_documents, owner_id)

    def _sync_count_documents(self, owner_id: str) -> int:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE owner_id=?", (owner_id,)
        ).fetchone()
        return int(row[0]) if row else 0

    async def create_document(
            self, owner_id: str, title: str, kind: str, body: str) -> dict:
        return await self._run(self._sync_create_document, owner_id, title, kind, body)

    def _sync_create_document(
            self, owner_id: str, title: str, kind: str, body: str) -> dict:
        conn = self._get_conn()
        doc_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO documents (id, owner_id, title, kind, body, pinned, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            (doc_id, owner_id, title, kind, body, now, now),
        )
        conn.commit()
        return {
            "id": doc_id,
            "title": title,
            "kind": kind,
            "body": body,
            "pinned": False,
            "created_at": now,
            "updated_at": now,
        }

    async def update_document(
        self,
        owner_id: str,
        doc_id: str,
        *,
        title: Optional[str] = None,
        kind: Optional[str] = None,
        body: Optional[str] = None,
        pinned: Optional[bool] = None,
    ) -> Optional[dict]:
        return await self._run(
            self._sync_update_document, owner_id, doc_id, title, kind, body, pinned
        )

    def _sync_update_document(
        self,
        owner_id: str,
        doc_id: str,
        title: Optional[str],
        kind: Optional[str],
        body: Optional[str],
        pinned: Optional[bool],
    ) -> Optional[dict]:
        existing = self._sync_get_document(owner_id, doc_id)
        if existing is None:
            return None
        new_title = existing["title"] if title is None else title
        new_kind = existing["kind"] if kind is None else kind
        new_body = existing["body"] if body is None else body
        new_pin = existing["pinned"] if pinned is None else bool(pinned)
        now = _now_str()
        conn = self._get_conn()
        conn.execute(
            "UPDATE documents SET title=?, kind=?, body=?, pinned=?, updated_at=? "
            "WHERE id=? AND owner_id=?",
            (new_title, new_kind, new_body,
             1 if new_pin else 0, now, doc_id, owner_id),
        )
        conn.commit()
        return {
            "id": doc_id,
            "title": new_title,
            "kind": new_kind,
            "body": new_body,
            "pinned": new_pin,
            "created_at": existing["created_at"],
            "updated_at": now,
        }

    async def delete_document(self, owner_id: str, doc_id: str) -> bool:
        return await self._run(self._sync_delete_document, owner_id, doc_id)

    def _sync_delete_document(self, owner_id: str, doc_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM documents WHERE id=? AND owner_id=?", (
                doc_id, owner_id)
        )
        conn.commit()
        return cur.rowcount > 0

    # -------------------------------------------------------------------------
    # Skills library (Q2#7)
    # -------------------------------------------------------------------------

    async def list_skills(self, owner_id: str, *,
                          active_only: bool = False) -> List[dict]:
        return await self._run(self._sync_list_skills, owner_id, active_only)

    def _sync_list_skills(self, owner_id: str,
                          active_only: bool) -> List[dict]:
        conn = self._get_conn()
        sql = (
            "SELECT id, name, prompt, trigger_phrases, is_active, created_at, updated_at "
            "FROM skills WHERE owner_id=?"
        )
        params: tuple = (owner_id,)
        if active_only:
            sql += " AND is_active=1"
        sql += " ORDER BY updated_at DESC"
        rows = conn.execute(sql, params).fetchall()
        return [self._row_to_skill(r) for r in rows]

    @staticmethod
    def _row_to_skill(row) -> dict:
        return {
            "id": row[0],
            "name": row[1],
            "prompt": row[2],
            "trigger_phrases": row[3],
            "is_active": bool(row[4]),
            "created_at": row[5],
            "updated_at": row[6],
        }

    async def get_skill(self, owner_id: str, skill_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_skill, owner_id, skill_id)

    def _sync_get_skill(self, owner_id: str, skill_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, name, prompt, trigger_phrases, is_active, created_at, updated_at "
            "FROM skills WHERE id=? AND owner_id=?",
            (skill_id, owner_id),
        ).fetchone()
        return self._row_to_skill(row) if row else None

    async def count_skills(self, owner_id: str) -> int:
        return await self._run(self._sync_count_skills, owner_id)

    def _sync_count_skills(self, owner_id: str) -> int:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT COUNT(*) FROM skills WHERE owner_id=?", (owner_id,)).fetchone()
        return int(row[0]) if row else 0

    async def create_skill(
        self,
        owner_id: str,
        name: str,
        prompt: str,
        trigger_phrases: str = "",
    ) -> dict:
        return await self._run(
            self._sync_create_skill, owner_id, name, prompt, trigger_phrases
        )

    def _sync_create_skill(
        self, owner_id: str, name: str, prompt: str, trigger_phrases: str
    ) -> dict:
        conn = self._get_conn()
        skill_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO skills (id, owner_id, name, prompt, trigger_phrases, is_active, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            (skill_id, owner_id, name, prompt, trigger_phrases, now, now),
        )
        conn.commit()
        return {
            "id": skill_id,
            "name": name,
            "prompt": prompt,
            "trigger_phrases": trigger_phrases,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }

    async def update_skill(
        self,
        owner_id: str,
        skill_id: str,
        *,
        name: Optional[str] = None,
        prompt: Optional[str] = None,
        trigger_phrases: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[dict]:
        return await self._run(
            self._sync_update_skill,
            owner_id, skill_id, name, prompt, trigger_phrases, is_active,
        )

    def _sync_update_skill(
        self,
        owner_id: str,
        skill_id: str,
        name: Optional[str],
        prompt: Optional[str],
        trigger_phrases: Optional[str],
        is_active: Optional[bool],
    ) -> Optional[dict]:
        existing = self._sync_get_skill(owner_id, skill_id)
        if existing is None:
            return None
        new_name = existing["name"] if name is None else name
        new_prompt = existing["prompt"] if prompt is None else prompt
        new_trig = existing["trigger_phrases"] if trigger_phrases is None else trigger_phrases
        new_active = existing["is_active"] if is_active is None else bool(
            is_active)
        now = _now_str()
        conn = self._get_conn()
        conn.execute(
            "UPDATE skills SET name=?, prompt=?, trigger_phrases=?, is_active=?, updated_at=? "
            "WHERE id=? AND owner_id=?",
            (new_name,
             new_prompt,
             new_trig,
             1 if new_active else 0,
             now,
             skill_id,
             owner_id),
        )
        conn.commit()
        return {
            "id": skill_id,
            "name": new_name,
            "prompt": new_prompt,
            "trigger_phrases": new_trig,
            "is_active": new_active,
            "created_at": existing["created_at"],
            "updated_at": now,
        }

    async def delete_skill(self, owner_id: str, skill_id: str) -> bool:
        return await self._run(self._sync_delete_skill, owner_id, skill_id)

    def _sync_delete_skill(self, owner_id: str, skill_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM skills WHERE id=? AND owner_id=?", (
                skill_id, owner_id)
        )
        conn.commit()
        return cur.rowcount > 0

    # -------------------------------------------------------------------------
    # Session presets (Q2#9)
    # -------------------------------------------------------------------------

    async def list_presets(self, owner_id: str) -> List[dict]:
        return await self._run(self._sync_list_presets, owner_id)

    def _sync_list_presets(self, owner_id: str) -> List[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, name, config_json, is_default, created_at, updated_at "
            "FROM session_presets WHERE owner_id=? ORDER BY is_default DESC, updated_at DESC",
            (owner_id,),
        ).fetchall()
        return [self._row_to_preset(r) for r in rows]

    @staticmethod
    def _row_to_preset(row) -> dict:
        try:
            cfg = json.loads(row[2]) if row[2] else {}
            if not isinstance(cfg, dict):
                cfg = {}
        except (ValueError, TypeError):
            cfg = {}
        return {
            "id": row[0],
            "name": row[1],
            "config": cfg,
            "is_default": bool(row[3]),
            "created_at": row[4],
            "updated_at": row[5],
        }

    async def get_preset(self, owner_id: str,
                         preset_id: str) -> Optional[dict]:
        return await self._run(self._sync_get_preset, owner_id, preset_id)

    def _sync_get_preset(self, owner_id: str,
                         preset_id: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, name, config_json, is_default, created_at, updated_at "
            "FROM session_presets WHERE id=? AND owner_id=?",
            (preset_id, owner_id),
        ).fetchone()
        return self._row_to_preset(row) if row else None

    async def count_presets(self, owner_id: str) -> int:
        return await self._run(self._sync_count_presets, owner_id)

    def _sync_count_presets(self, owner_id: str) -> int:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT COUNT(*) FROM session_presets WHERE owner_id=?", (owner_id,)
        ).fetchone()
        return int(row[0]) if row else 0

    async def create_preset(self, owner_id: str,
                            name: str, config: dict) -> dict:
        return await self._run(self._sync_create_preset, owner_id, name, config)

    def _sync_create_preset(self, owner_id: str,
                            name: str, config: dict) -> dict:
        conn = self._get_conn()
        preset_id = str(uuid.uuid4())
        now = _now_str()
        conn.execute(
            "INSERT INTO session_presets (id, owner_id, name, config_json, is_default, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 0, ?, ?)",
            (preset_id, owner_id, name, json.dumps(config or {}), now, now),
        )
        conn.commit()
        return {
            "id": preset_id,
            "name": name,
            "config": config or {},
            "is_default": False,
            "created_at": now,
            "updated_at": now,
        }

    async def update_preset(
        self,
        owner_id: str,
        preset_id: str,
        *,
        name: Optional[str] = None,
        config: Optional[dict] = None,
        is_default: Optional[bool] = None,
    ) -> Optional[dict]:
        return await self._run(
            self._sync_update_preset, owner_id, preset_id, name, config, is_default
        )

    def _sync_update_preset(
        self,
        owner_id: str,
        preset_id: str,
        name: Optional[str],
        config: Optional[dict],
        is_default: Optional[bool],
    ) -> Optional[dict]:
        existing = self._sync_get_preset(owner_id, preset_id)
        if existing is None:
            return None
        new_name = existing["name"] if name is None else name
        new_cfg = existing["config"] if config is None else config
        new_def = existing["is_default"] if is_default is None else bool(
            is_default)
        now = _now_str()
        conn = self._get_conn()
        if new_def:
            # Only one default per owner — clear the flag on others first.
            conn.execute(
                "UPDATE session_presets SET is_default=0 WHERE owner_id=? AND id!=?",
                (owner_id, preset_id),
            )
        conn.execute(
            "UPDATE session_presets SET name=?, config_json=?, is_default=?, updated_at=? "
            "WHERE id=? AND owner_id=?",
            (new_name, json.dumps(new_cfg or {}),
             1 if new_def else 0, now, preset_id, owner_id),
        )
        conn.commit()
        return {
            "id": preset_id,
            "name": new_name,
            "config": new_cfg or {},
            "is_default": new_def,
            "created_at": existing["created_at"],
            "updated_at": now,
        }

    async def delete_preset(self, owner_id: str, preset_id: str) -> bool:
        return await self._run(self._sync_delete_preset, owner_id, preset_id)

    def _sync_delete_preset(self, owner_id: str, preset_id: str) -> bool:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM session_presets WHERE id=? AND owner_id=?",
            (preset_id, owner_id),
        )
        conn.commit()
        return cur.rowcount > 0

    # =========================================================================
    # Reading shelf
    # =========================================================================

    def _row_to_book(self, row) -> dict:
        return {
            "id": row[0],
            "user_id": row[1],
            "service": row[2],
            "title": row[3],
            "author": row[4],
            "cover_url": row[5],
            "progress_pct": row[6],
            "status": row[7],
            "rating": row[8],
            "notes": row[9],
            "launch_url": row[10],
            "created_at": row[11],
            "updated_at": row[12],
        }

    async def list_shelf(self, user_id: str, service: str = None, status: str = None) -> list:  # type: ignore
        return await self._run(self._sync_list_shelf, user_id, service, status)

    def _sync_list_shelf(self, user_id: str, service: str,
                         status: str) -> list:
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
             float(
                book.get(
                    "progress_pct", 0.0)), book.get(
                "status", "reading"),
                book.get("rating"), book.get(
                "notes", ""), book.get(
                "launch_url", ""),
                now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id,user_id,service,title,author,cover_url,progress_pct,status,rating,notes,launch_url,created_at,updated_at "
            "FROM reading_shelf WHERE id=?", (bid,)
        ).fetchone()
        return self._row_to_book(row)

    async def update_book(self, book_id: str, user_id: str,
                          fields: dict) -> Optional[dict]:
        return await self._run(self._sync_update_book, book_id, user_id, fields)

    def _sync_update_book(self, book_id: str, user_id: str,
                          fields: dict) -> Optional[dict]:
        conn = self._get_conn()
        allowed = {
            "service",
            "title",
            "author",
            "cover_url",
            "progress_pct",
            "status",
            "rating",
            "notes",
            "launch_url"}
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
            "UPDATE reading_shelf SET " +
            ", ".join(parts) + " WHERE id=? AND user_id=?",
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
        cur = conn.execute(
            "DELETE FROM reading_shelf WHERE id=? AND user_id=?", (book_id, user_id))
        conn.commit()
        return cur.rowcount > 0
