from typing import List, Dict, Any, Optional
import uuid
import json
from datetime import datetime, timezone

class ChatStoreMixin:
    # Requires self._run and self._get_conn from the main SQLiteStore

    async def get_chat_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        def _get() -> List[Dict[str, Any]]:
            conn = self._get_conn()
            conn.row_factory = dict_factory
            c = conn.execute(
                """
                SELECT s.id, s.title, s.updated_at, COUNT(m.id) as message_count
                FROM chat_sessions s
                LEFT JOIN chat_messages m ON s.id = m.session_id
                WHERE s.user_id = ? AND s.archived = 0
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                """,
                (user_id,)
            )
            return [dict(row) for row in c.fetchall()]
        return await self._run(_get)

    async def create_chat_session(self, user_id: str, title: str = "") -> str:
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        def _create() -> str:
            conn = self._get_conn()
            conn.execute(
                """
                INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, user_id, title, now, now)
            )
            conn.commit()
            return session_id
        return await self._run(_create)

    async def get_chat_messages(self, user_id: str, session_id: str) -> List[Dict[str, Any]]:
        def _get() -> List[Dict[str, Any]]:
            conn = self._get_conn()
            conn.row_factory = dict_factory
            # Verify ownership
            c = conn.execute("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
            if not c.fetchone():
                return []
            
            c = conn.execute(
                """
                SELECT id, role, content, meta, created_at
                FROM chat_messages
                WHERE session_id = ?
                ORDER BY id ASC
                """,
                (session_id,)
            )
            return [dict(row) for row in c.fetchall()]
        return await self._run(_get)
        
    async def get_chat_session(self, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        def _get() -> Optional[Dict[str, Any]]:
            conn = self._get_conn()
            conn.row_factory = dict_factory
            c = conn.execute("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
            row = c.fetchone()
            return dict(row) if row else None
        return await self._run(_get)

    async def add_chat_message(self, session_id: str, role: str, content: str, meta: Dict[str, Any] = None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        meta_json = json.dumps(meta) if meta else "{}"
        def _add() -> None:
            conn = self._get_conn()
            conn.execute(
                """
                INSERT INTO chat_messages (session_id, role, content, meta, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, role, content, meta_json, now)
            )
            conn.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id)
            )
            conn.commit()
        await self._run(_add)

    async def archive_chat_session(self, user_id: str, session_id: str) -> None:
        def _archive() -> None:
            conn = self._get_conn()
            conn.execute(
                "UPDATE chat_sessions SET archived = 1 WHERE id = ? AND user_id = ?",
                (session_id, user_id)
            )
            conn.commit()
        await self._run(_archive)

    async def update_chat_session_title(self, session_id: str, title: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        def _update() -> None:
            conn = self._get_conn()
            conn.execute(
                "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, session_id)
            )
            conn.commit()
        await self._run(_update)

    async def get_undistilled_sessions(self, idle_minutes: int = 30) -> List[Dict[str, Any]]:
        def _get() -> List[Dict[str, Any]]:
            conn = self._get_conn()
            conn.row_factory = dict_factory
            c = conn.execute(
                """
                SELECT * FROM chat_sessions 
                WHERE distilled_at IS NULL 
                AND updated_at < datetime('now', ?)
                """,
                (f"-{idle_minutes} minutes",)
            )
            return [dict(row) for row in c.fetchall()]
        return await self._run(_get)

    async def mark_session_distilled(self, session_id: str, title: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        def _mark() -> None:
            conn = self._get_conn()
            conn.execute(
                "UPDATE chat_sessions SET distilled_at = ?, title = ? WHERE id = ?",
                (now, title, session_id)
            )
            conn.commit()
        await self._run(_mark)

    async def delete_old_chat_messages(self, retention_days: int = 90) -> int:
        def _delete() -> int:
            conn = self._get_conn()
            c = conn.execute(
                """
                DELETE FROM chat_messages 
                WHERE session_id IN (SELECT id FROM chat_sessions WHERE distilled_at IS NOT NULL)
                AND created_at < datetime('now', ?)
                """,
                (f"-{retention_days} days",)
            )
            conn.commit()
            return c.rowcount
        return await self._run(_delete)

def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}
