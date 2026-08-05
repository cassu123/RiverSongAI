# =============================================================================
# providers/memory/store/vault.py
#
# File Purpose:
#   CHRONOS vault notes, links, audit log and graph.
#   VaultStoreMixin is mixed into SQLiteStore; all methods were moved
#   verbatim from providers/memory/sqlite_store.py.
# =============================================================================

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional



class VaultStoreMixin:
    """CHRONOS vault notes, links, audit log and graph.

    Mixin for SQLiteStore: relies on self._run / self._get_conn from the
    host class and defines no __init__ of its own.
    """

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
        row = conn.execute(
            "SELECT id FROM vault_notes WHERE virtual_path = ?",
            (virtual_path,
             )).fetchone()
        note_id = row["id"]

        # 2. Clear old links and insert new ones
        conn.execute(
            "DELETE FROM vault_links WHERE src_note_id = ?", (note_id,))
        for target in links:
            conn.execute(
                "INSERT INTO vault_links (src_note_id, target_title) VALUES (?, ?)",
                (note_id,
                 target))

        conn.commit()

    async def delete_vault_note_by_path(self, virtual_path: str) -> None:
        await self._run(self._sync_delete_vault_note_by_path, virtual_path)

    def _sync_delete_vault_note_by_path(self, virtual_path: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "DELETE FROM vault_notes WHERE virtual_path = ?", (virtual_path,))
        conn.commit()

    async def get_vault_note_by_path(
            self, virtual_path: str) -> Optional[dict]:
        return await self._run(self._sync_get_vault_note_by_path, virtual_path)

    def _sync_get_vault_note_by_path(
            self, virtual_path: str) -> Optional[dict]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM vault_notes WHERE virtual_path = ?",
            (virtual_path,
             )).fetchone()
        return dict(row) if row else None

    async def search_vault_notes(
            self, user_id: str, query: str, limit: int = 50) -> list[dict]:
        # NOTE: This search doesn't strictly check permissions by owner_id yet.
        # The caller (VaultProvider) is expected to filter or pass the right
        # constraints.
        return await self._run(self._sync_search_vault_notes, user_id, query, limit)

    def _sync_search_vault_notes(
            self, user_id: str, query: str, limit: int) -> list[dict]:
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

    async def log_vault_audit(
            self, user_id: str, action: str, virtual_path: str) -> None:
        await self._run(self._sync_log_vault_audit, user_id, action, virtual_path)

    def _sync_log_vault_audit(
            self, user_id: str, action: str, virtual_path: str) -> None:
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

        nodes_by_id = {r["id"]: dict(r) for r in note_rows}
        title_to_path = {r["title"]: r["virtual_path"]
                         for r in note_rows if r["title"]}

        edge_rows = conn.execute(
            """
            SELECT vl.src_note_id, vl.target_title, vn.virtual_path AS src_path
            FROM vault_links vl
            JOIN vault_notes vn ON vl.src_note_id = vn.id
            WHERE vn.owner_kind = 'user' AND vn.owner_id = ?
            """,
            (user_id,)
        ).fetchall()

        edges = []
        ghost_nodes = {}

        for row in edge_rows:
            src_path = row["src_path"]
            target_title = row["target_title"]
            target_path = title_to_path.get(target_title)

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
                "id": n["virtual_path"],
                "virtual_path": n["virtual_path"],
                "title": n["title"] or n["virtual_path"].split("/")[-1].replace(".md", ""),
                "owner_kind": n["owner_kind"],
                "ghost": False,
            }
            for n in nodes_by_id.values()
        ]
        nodes.extend(ghost_nodes.values())

        return {"nodes": nodes, "edges": edges}
