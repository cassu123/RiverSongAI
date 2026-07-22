"""
core/tools_reading.py

Reading / Kindle tool executors.
Split out of core/tools.py (god-file audit #3); re-exported by core.tools
so the dispatcher and any external callers are unchanged.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def _exec_check_reading_status(args: dict, user_id: str) -> str:
    db_path = get_settings().db_path

    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            title = args.get("title", "").strip().lower()
            if title:
                cur.execute(
                    "SELECT title, author, status, progress_pct FROM reading_shelf WHERE user_id = ? AND lower(title) LIKE ?",
                    (user_id,
                     f"%{title}%"))
                rows = cur.fetchall()
                if not rows:
                    return f"I couldn't find '{args['title']}' on your reading shelf."
                r = rows[0]
                return f"'{r[0]}' by {r[1]} is currently marked as '{r[2]}' with {r[3]}% progress."
            else:
                cur.execute(
                    "SELECT title, status FROM reading_shelf WHERE user_id = ? AND status = 'reading'",
                    (user_id,
                     ))
                rows = cur.fetchall()
                if not rows:
                    return "You aren't currently reading anything on your shelf."
                reading_list = ", ".join([r[0] for r in rows])
                return f"You are currently reading: {reading_list}."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


async def _exec_sync_kindle(args: dict, user_id: str) -> str:
    db_path = "data/reading.db"
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    def _sync_work():
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kindle_books (
                    id INTEGER PRIMARY KEY,
                    asin TEXT UNIQUE,
                    title TEXT,
                    author TEXT,
                    sync_date TEXT
                )
            """)
            books = args.get("books", [])
            if not books:
                books = [{"asin": "SYNC_PLACEHOLDER",
                          "title": "Manual Sync Run", "author": "System"}]
            added = 0
            sync_date = datetime.now(timezone.utc).isoformat()
            for b in books:
                try:
                    cur.execute(
                        "INSERT OR IGNORE INTO kindle_books (asin, title, author, sync_date) VALUES (?, ?, ?, ?)",
                        (b.get("asin"), b.get("title"), b.get("author"), sync_date)
                    )
                    if cur.rowcount > 0:
                        added += 1
                except Exception:
                    continue
            conn.commit()
            return f"Kindle sync complete. Processed {len(books)} books ({added} new)."
        finally:
            conn.close()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_work)


