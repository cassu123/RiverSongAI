#!/usr/bin/env python3
"""
scripts/check_culinary_orphans.py

Read-only. Reports culinary rows whose household no longer exists.

Linking a profile into a family group used to move six of the ten
household-scoped tables and then delete the personal household. Rows in the
four it missed -- banned ingredients, shopping list, meal plan, cooking
sessions -- still exist but point at a household that is gone, and every query
filters on household_id, so they are unreachable rather than deleted.

The migration is fixed, but the fix is forward-looking: anyone linked before
it landed may still be carrying orphans. This says whether that happened and
how ambiguous the recovery would be.

Banned ingredients are the ones that matter most. They drive substitution
during recipe ingest and scaling, so orphaning them does not raise anything --
an allergy restriction simply stops applying.

Writes nothing. Opens the database read-only.

    python3 scripts/check_culinary_orphans.py [path/to/culinary.db]
"""

from __future__ import annotations

import os
import sqlite3
import sys


def _default_db_path() -> str:
    url = os.environ.get("CULINARY_DB_URL")
    if not url:
        # Mirrors core/family_migration._CUL_DB()
        for line in _env_file_lines():
            if line.startswith("CULINARY_DB_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    url = url or "sqlite:///./data/culinary.db"
    return url.replace("sqlite:///", "")


def _env_file_lines() -> list:
    try:
        with open(".env", "r", encoding="utf-8") as fh:
            return [ln.strip() for ln in fh]
    except OSError:
        return []


def _scoped_tables(conn) -> list:
    """Every cul_* table carrying a household_id, from the live schema."""
    tables = []
    for (name,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cul_%'"
    ).fetchall():
        if name == "cul_households":
            continue
        cols = {row[1] for row in conn.execute(f"PRAGMA table_info({name})")}
        if "household_id" in cols:
            tables.append(name)
    return sorted(tables)


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else _default_db_path()
    if not os.path.exists(path):
        print(f"No database at {path}")
        print("Pass the path explicitly:  python3 scripts/check_culinary_orphans.py /path/to/culinary.db")
        return 1

    # Read-only URI, so this cannot modify anything even by accident.
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        print(f"database : {path}\n")

        households = conn.execute(
            "SELECT id, owner_id, COALESCE(name, '') FROM cul_households "
            "ORDER BY owner_id").fetchall()
        families = [h for h in households if str(h[1]).startswith("family:")]

        print(f"households: {len(households)}  "
              f"({len(families)} shared, {len(households) - len(families)} personal)")
        for hid, owner, name in households:
            kind = "shared  " if str(owner).startswith("family:") else "personal"
            print(f"  {kind}  {owner:<45} {name}")
        print()

        total = 0
        rows = []
        for table in _scoped_tables(conn):
            n = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE household_id NOT IN "
                "(SELECT id FROM cul_households)").fetchone()[0]
            total += n
            rows.append((table, n))

        width = max((len(t) for t, _ in rows), default=20)
        for table, n in rows:
            flag = "  <-- ORPHANED" if n else ""
            print(f"  {table:<{width}}  {n:>5}{flag}")

        print()
        if total == 0:
            print("No orphans. Nothing to recover.")
            return 0

        print(f"{total} orphaned row(s).")
        dead = conn.execute(
            "SELECT DISTINCT household_id FROM cul_banned_ingredients "
            "WHERE household_id NOT IN (SELECT id FROM cul_households)"
        ).fetchall()
        if dead:
            print(f"Orphaned allergy rows reference {len(dead)} missing "
                  f"household(s) -- recovery is unambiguous only if that maps "
                  f"cleanly onto the shared households listed above.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
