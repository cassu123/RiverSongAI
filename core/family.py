"""
core/family.py — Family group owner resolution

Provides resolve_module_owner(user_id, module) which returns either
'family:<group_id>' (when the user belongs to a family group that has the
given module shared) or the original user_id.

Both culinary and inventory import this so the logic lives in one place.
"""

from __future__ import annotations

import json
import logging
import sqlite3

from typing import Optional

logger = logging.getLogger(__name__)


def _db_path() -> str:
    from config.settings import get_settings
    return get_settings().db_path


def resolve_module_owner(user_id: str, module: str) -> str:
    """
    Return the effective owner ID for a shared module.

    If the user is a member of a family group that has `module` in its
    shared_modules list, returns 'family:<group_id>' so all family members
    map to the same data record.  Falls back to user_id when the user is
    not in a group or the module is not shared.
    """
    try:
        conn = sqlite3.connect(_db_path())
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT fg.id, fg.shared_modules
            FROM family_memberships fm
            JOIN family_groups fg ON fg.id = fm.family_group_id
            WHERE fm.profile_id = ?
            """,
            (user_id,),
        ).fetchone()
        conn.close()
        if row:
            modules = json.loads(row["shared_modules"] or "[]")
            if module in modules:
                return f"family:{row['id']}"
    except Exception as exc:
        logger.debug("Family resolution failed for user %s: %s", user_id, exc)
    return user_id
