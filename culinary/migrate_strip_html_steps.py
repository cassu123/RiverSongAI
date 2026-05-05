"""
culinary/migrate_strip_html_steps.py

One-time migration: strip HTML tags from steps_json on all existing recipes.
Safe to re-run — recipes with no HTML are left unchanged.

Usage:
    python -m culinary.migrate_strip_html_steps
    # or override the DB path:
    CULINARY_DB_URL=sqlite:///./data/culinary.db python -m culinary.migrate_strip_html_steps
"""

from __future__ import annotations

import html
import json
import os
import re
import sqlite3


_DB_PATH = (
    os.environ.get("CULINARY_DB_URL", "sqlite:///./data/culinary.db")
    .replace("sqlite:///", "")
)


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_steps(steps_json: str) -> tuple[str, bool]:
    """Return (cleaned_json, changed)."""
    try:
        steps = json.loads(steps_json)
    except (json.JSONDecodeError, TypeError):
        return steps_json, False

    if not isinstance(steps, list):
        return steps_json, False

    cleaned = [_strip_html(s) if isinstance(s, str) else s for s in steps]
    if cleaned == steps:
        return steps_json, False

    return json.dumps(cleaned, ensure_ascii=False), True


def run() -> None:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT id, title, steps_json FROM cul_recipes").fetchall()
        updated = 0
        for row in rows:
            new_json, changed = _clean_steps(row["steps_json"])
            if changed:
                conn.execute(
                    "UPDATE cul_recipes SET steps_json = ? WHERE id = ?",
                    (new_json, row["id"]),
                )
                print(f"  cleaned: {row['title']} ({row['id']})")
                updated += 1

        conn.commit()
        print(f"\nDone — {updated}/{len(rows)} recipes updated.")
    finally:
        conn.close()


if __name__ == "__main__":
    print(f"Connecting to {_DB_PATH!r} …")
    run()
