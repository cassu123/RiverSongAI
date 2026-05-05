"""
core/family_migration.py

Runs when a profile is added to a family group.  For each shared module,
any data already owned by that profile is moved to the shared family owner
so nothing is lost and everything becomes visible to all group members.

Called synchronously from the admin endpoint — all DB access is direct
sqlite3 (no SQLAlchemy) to keep it simple and dependency-free.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import List

logger = logging.getLogger(__name__)

_MAIN_DB  = lambda: os.environ.get("MAIN_DB_PATH") or _settings_db_path()
_CUL_DB   = lambda: os.environ.get("CULINARY_DB_URL",  "sqlite:///./data/culinary.db" ).replace("sqlite:///", "")
_INV_DB   = lambda: os.environ.get("INVENTORY_DB_URL", "sqlite:///./data/inventory.db").replace("sqlite:///", "")
_VEH_DB   = lambda: os.environ.get("VEHICLES_DB_URL",  "sqlite:///./data/vehicles.db" ).replace("sqlite:///", "")
_COM_DB   = lambda: os.environ.get("COMMERCE_DB_URL",  "sqlite:///./data/commerce.db" ).replace("sqlite:///", "")


def _settings_db_path() -> str:
    from config.settings import get_settings
    return get_settings().db_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def migrate_member_to_family(group_id: str, profile_id: str, shared_modules: List[str]) -> dict:
    """
    Move all personal module data for `profile_id` into the shared family
    owner slot for `group_id`.  Safe to call multiple times (idempotent).

    Returns a summary dict of what was migrated.
    """
    family_owner = f"family:{group_id}"
    summary: dict = {}

    if "culinary" in shared_modules:
        summary["culinary"] = _migrate_culinary(profile_id, family_owner, group_id)

    if "inventory" in shared_modules:
        summary["inventory"] = _migrate_inventory(profile_id, family_owner, group_id)

    if "maintenance" in shared_modules:
        summary["maintenance"] = _migrate_vehicles(profile_id, family_owner)

    if "store" in shared_modules:
        summary["store"] = _migrate_commerce(profile_id, family_owner, group_id)

    logger.info(
        "Family migration for profile %s → group %s: %s",
        profile_id[:8], group_id[:8], summary,
    )
    return summary


# ---------------------------------------------------------------------------
# Culinary
# ---------------------------------------------------------------------------

def _migrate_culinary(profile_id: str, family_owner: str, group_id: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_CUL_DB()); conn.row_factory = sqlite3.Row

        personal_hh = conn.execute(
            "SELECT id FROM cul_households WHERE owner_id=?", (profile_id,)
        ).fetchone()
        if not personal_hh:
            conn.close()
            return {"moved": 0}

        phh_id = personal_hh["id"]

        # Get or create the shared household
        family_hh = conn.execute(
            "SELECT id FROM cul_households WHERE owner_id=?", (family_owner,)
        ).fetchone()
        if not family_hh:
            import uuid as _uuid
            new_hh_id = str(_uuid.uuid4())
            conn.execute(
                "INSERT INTO cul_households (id, owner_id, name) VALUES (?,?,?)",
                (new_hh_id, family_owner, "Family Household"),
            )
            conn.commit()
            fhh_id = new_hh_id
        else:
            fhh_id = family_hh["id"]

        if phh_id == fhh_id:
            conn.close()
            return {"moved": 0}

        for tbl in (
            "cul_recipes", "cul_stockroom", "cul_prep_sessions",
            "cul_walmart_mappings", "cul_kitchen_equipment",
        ):
            cur = conn.execute(
                f"UPDATE {tbl} SET household_id=? WHERE household_id=?",
                (fhh_id, phh_id),
            )
            moved += cur.rowcount

        conn.execute("DELETE FROM cul_households WHERE id=?", (phh_id,))
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Culinary migration failed for %s: %s", profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def _migrate_inventory(profile_id: str, family_owner: str, group_id: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_INV_DB()); conn.row_factory = sqlite3.Row

        personal_inv = conn.execute(
            "SELECT id FROM inv_users WHERE external_user_id=?", (profile_id,)
        ).fetchone()
        if not personal_inv:
            conn.close()
            return {"moved": 0}

        puid = str(personal_inv["id"]).replace("-", "")

        family_inv = conn.execute(
            "SELECT id FROM inv_users WHERE external_user_id=?", (family_owner,)
        ).fetchone()
        if not family_inv:
            # Create the shared InvUser using a synthetic email
            sample_tz = conn.execute("SELECT timezone FROM inv_users LIMIT 1").fetchone()
            tz = sample_tz["timezone"] if sample_tz else "UTC"
            # Get group name for display
            main = sqlite3.connect(_MAIN_DB()); main.row_factory = sqlite3.Row
            grp  = main.execute("SELECT name FROM family_groups WHERE id=?", (group_id,)).fetchone()
            main.close()
            group_name = grp["name"] if grp else "Family"
            new_uid = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO inv_users "
                "(id, external_user_id, email, display_name, timezone, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (
                    new_uid, family_owner,
                    f"family-{group_id}@riversong.local",
                    f"{group_name} (shared)", tz, _now(), _now(),
                ),
            )
            conn.commit()
            fuid = new_uid
        else:
            fuid = str(family_inv["id"]).replace("-", "")

        if puid == fuid:
            conn.close()
            return {"moved": 0}

        cur = conn.execute(
            "UPDATE inv_homes SET owner_id=? WHERE owner_id=?", (fuid, puid)
        )
        moved = cur.rowcount
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Inventory migration failed for %s: %s", profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Vehicles / Maintenance
# ---------------------------------------------------------------------------

def _migrate_vehicles(profile_id: str, family_owner: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_VEH_DB()); conn.row_factory = sqlite3.Row

        cur = conn.execute(
            "UPDATE vehicles SET external_user_id=? WHERE external_user_id=?",
            (family_owner, profile_id),
        )
        moved += cur.rowcount

        for col in ("owner_user_id", "external_user_id"):
            try:
                cur = conn.execute(
                    f"UPDATE maint_persons SET {col}=? WHERE {col}=?",
                    (family_owner, profile_id),
                )
                moved += cur.rowcount
            except sqlite3.OperationalError:
                pass

        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Vehicles migration failed for %s: %s", profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Commerce / Store
# ---------------------------------------------------------------------------

def _migrate_commerce(profile_id: str, family_owner: str, group_id: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_COM_DB()); conn.row_factory = sqlite3.Row

        personal_biz = conn.execute(
            "SELECT id FROM biz_users WHERE external_user_id=?", (profile_id,)
        ).fetchone()
        if not personal_biz:
            conn.close()
            return {"moved": 0}

        puid = personal_biz["id"]

        family_biz = conn.execute(
            "SELECT id FROM biz_users WHERE external_user_id=?", (family_owner,)
        ).fetchone()
        if not family_biz:
            main = sqlite3.connect(_MAIN_DB()); main.row_factory = sqlite3.Row
            grp  = main.execute("SELECT name FROM family_groups WHERE id=?", (group_id,)).fetchone()
            main.close()
            group_name = grp["name"] if grp else "Family"
            # Get email from personal user for display
            user_row = conn.execute(
                "SELECT email FROM biz_users WHERE id=?", (puid,)
            ).fetchone()
            new_uid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO biz_users (id, external_user_id, email, display_name, created_at) "
                "VALUES (?,?,?,?,?)",
                (
                    new_uid, family_owner,
                    f"family-{group_id}@riversong.local",
                    f"{group_name} (shared)", _now(),
                ),
            )
            conn.commit()
            fuid = new_uid
        else:
            fuid = family_biz["id"]

        if puid == fuid:
            conn.close()
            return {"moved": 0}

        cur = conn.execute(
            "UPDATE biz_workspaces SET owner_id=? WHERE owner_id=?", (fuid, puid)
        )
        moved += cur.rowcount
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Commerce migration failed for %s: %s", profile_id[:8], exc)

    return {"moved": moved}
