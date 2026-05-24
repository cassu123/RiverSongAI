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
import threading

from typing import Optional

logger = logging.getLogger(__name__)

# Per-thread cached connection. Opens once per thread instead of once per
# call, eliminating the per-call connect overhead the audit flagged in
# LOGIC-006. Sync API is preserved so the 5+ existing callers remain
# unchanged.
_local = threading.local()


def _db_path() -> str:
    from config.settings import get_settings
    return get_settings().db_path


def _get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    conn = sqlite3.connect(
        _db_path(),
        timeout=10.0,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.Error:
        pass
    _local.conn = conn
    return conn


def resolve_module_owner(user_id: str, module: str) -> str:
    """
    Return the effective owner ID for a shared module.

    If the user is a member of a family group that has `module` in its
    shared_modules list, returns 'family:<group_id>' so all family members
    map to the same data record.  Falls back to user_id when the user is
    not in a group or the module is not shared.
    """
    try:
        conn = _get_conn()
        row = conn.execute(
            """
            SELECT fg.id, fg.shared_modules
            FROM family_memberships fm
            JOIN family_groups fg ON fg.id = fm.family_group_id
            WHERE fm.profile_id = ?
            """,
            (user_id,),
        ).fetchone()
        if row:
            modules = json.loads(row["shared_modules"] or "[]")
            if module in modules:
                return f"family:{row['id']}"
    except Exception as exc:
        logger.debug("Family resolution failed for user %s: %s", user_id, exc)
    return user_id


async def is_feature_enabled_for(user_id: str, feature_key: str) -> bool:
    """
    Central permission check for the feature cascade.
    Admin always enabled.
    Parent/User blocked if globally hidden.
    Child blocked if globally hidden OR not explicitly approved.
    """
    from main import get_app
    app = get_app()
    if not app:
        return True

    try:
        mm = getattr(app.state, "memory_manager", None)
        if not mm:
            return True
        store = mm._store

        user = await store.get_user_by_id(user_id)
        if not user:
            return False

        role = user.get("role", "user")
        if role == "admin":
            return True

        config = await store.get_admin_config()
        hidden = set(config.get("hidden_features", []))
        if feature_key in hidden:
            return False

        if role == "child":
            child_features = await store.get_child_features(user_id)
            return feature_key in child_features

        return True
    except Exception as exc:
        logger.error("Feature check failed for user %s, key %s: %s", user_id, feature_key, exc)
        return False
