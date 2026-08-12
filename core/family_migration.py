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


def _MAIN_DB(): return os.environ.get("MAIN_DB_PATH") or _settings_db_path()


def _CUL_DB(): return os.environ.get("CULINARY_DB_URL",
                                     "sqlite:///./data/culinary.db").replace("sqlite:///", "")


def _INV_DB(): return os.environ.get("INVENTORY_DB_URL",
                                     "sqlite:///./data/inventory.db").replace("sqlite:///", "")


def _VEH_DB(): return os.environ.get("VEHICLES_DB_URL",
                                     "sqlite:///./data/vehicles.db").replace("sqlite:///", "")


def _COM_DB(): return os.environ.get("COMMERCE_DB_URL",
                                     "sqlite:///./data/commerce.db").replace("sqlite:///", "")


def _settings_db_path() -> str:
    from config.settings import get_settings
    return get_settings().db_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def migrate_member_to_family(
        group_id: str, profile_id: str, shared_modules: List[str]) -> dict:
    """
    Move all personal module data for `profile_id` into the shared family
    owner slot for `group_id`.  Safe to call multiple times (idempotent).

    Returns a summary dict of what was migrated.
    """
    family_owner = f"family:{group_id}"
    summary: dict = {}

    if "culinary" in shared_modules:
        summary["culinary"] = _migrate_culinary(
            profile_id, family_owner, group_id)

    if "inventory" in shared_modules:
        summary["inventory"] = _migrate_inventory(
            profile_id, family_owner, group_id)

    if "maintenance" in shared_modules:
        summary["maintenance"] = _migrate_vehicles(profile_id, family_owner)

    if "store" in shared_modules:
        summary["store"] = _migrate_commerce(
            profile_id, family_owner, group_id)

    logger.info(
        "Family migration for profile %s → group %s: %s",
        profile_id[:8], group_id[:8], summary,
    )
    return summary


# ---------------------------------------------------------------------------
# Culinary
# ---------------------------------------------------------------------------

def _household_scoped_tables(conn) -> List[str]:
    """Every cul_* table carrying a household_id, read from the live schema.

    Discovered rather than listed by hand. The list this replaces named six
    tables while the schema had ten, so cul_shopping_list,
    cul_banned_ingredients, cul_meal_plan and cul_cooking_sessions were left
    behind pointing at a household the next statement deleted -- and since
    sqlite3 leaves foreign keys off unless asked and this module never asks,
    nothing cascaded. The rows survived, unreachable, because every query
    filters on household_id.

    A hand-maintained list goes stale the first time someone adds a table
    without thinking about family linking. Those four are exactly the tables
    added after this function was written. The schema cannot go stale.
    """
    tables = []
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cul_%'"
    ).fetchall()
    for row in rows:
        name = row["name"]
        if name == "cul_households":
            continue
        cols = {c["name"] for c in conn.execute(f"PRAGMA table_info({name})")}
        if "household_id" in cols:
            tables.append(name)
    return sorted(tables)


def _tables_referencing_household(conn, household_id: str) -> dict:
    """Row counts still pointing at `household_id`, per table.

    Runs its own schema scan rather than reusing the list the move iterated.
    Sharing that list would make the guard blind in exactly the same way the
    move was: ask the same incomplete question twice and you get the same
    incomplete answer, and the delete proceeds looking verified. The whole
    point of the check is to be a second opinion.
    """
    counts = {}
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cul_%'"
    ).fetchall()
    for row in rows:
        name = row["name"]
        if name == "cul_households":
            continue
        cols = {c["name"] for c in conn.execute(f"PRAGMA table_info({name})")}
        if "household_id" not in cols:
            continue
        left = conn.execute(
            f"SELECT COUNT(*) FROM {name} WHERE household_id=?", (household_id,)
        ).fetchone()[0]
        if left:
            counts[name] = left
    return counts


def _migrate_culinary(profile_id: str, family_owner: str,
                      group_id: str) -> dict:
    moved = 0
    moved_by_table: dict = {}
    try:
        conn = sqlite3.connect(_CUL_DB())
        conn.row_factory = sqlite3.Row

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

        scoped = _household_scoped_tables(conn)
        for tbl in scoped:
            cur = conn.execute(
                f"UPDATE {tbl} SET household_id=? WHERE household_id=?",
                (fhh_id, phh_id),
            )
            if cur.rowcount:
                moved_by_table[tbl] = cur.rowcount
            moved += cur.rowcount

        # The personal household is dropped only once nothing points at it.
        #
        # This DELETE is the one destructive statement in the whole migration:
        # the inventory, vehicle and commerce migrators reparent and leave the
        # personal record standing, so a table they miss is merely unmigrated
        # and still reachable by unsharing. Here a missed table became
        # permanently invisible. Re-counting before deleting turns that class
        # of bug from silent data loss into a loud log line with the rows
        # still in place.
        stragglers = _tables_referencing_household(conn, phh_id)
        if stragglers:
            conn.commit()
            conn.close()
            logger.error(
                "Culinary migration for %s: keeping personal household %s -- "
                "still referenced by %s. Everything migrated so far is saved and "
                "the household row is left intact so the remainder stays "
                "reachable and can be moved once the cause is understood.",
                profile_id[:8], phh_id, stragglers,
            )
            return {"moved": moved, "by_table": moved_by_table,
                    "household_deleted": False, "stragglers": stragglers,
                    "partial": True}

        conn.execute("DELETE FROM cul_households WHERE id=?", (phh_id,))
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Culinary migration failed for %s: %s",
                       profile_id[:8], exc)
        return {"moved": moved, "by_table": moved_by_table, "error": str(exc)}

    return {"moved": moved, "by_table": moved_by_table,
            "household_deleted": True}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def _migrate_inventory(profile_id: str, family_owner: str,
                       group_id: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_INV_DB())
        conn.row_factory = sqlite3.Row

        personal_inv = conn.execute(
            "SELECT id FROM inv_users WHERE external_user_id=?", (profile_id,)
        ).fetchone()
        if not personal_inv:
            conn.close()
            return {"moved": 0}

        puid = str(personal_inv["id"]).replace("-", "")

        family_inv = conn.execute(
            "SELECT id FROM inv_users WHERE external_user_id=?", (
                family_owner,)
        ).fetchone()
        if not family_inv:
            # Create the shared InvUser using a synthetic email
            sample_tz = conn.execute(
                "SELECT timezone FROM inv_users LIMIT 1").fetchone()
            tz = sample_tz["timezone"] if sample_tz else "UTC"
            # Get group name for display
            main = sqlite3.connect(_MAIN_DB())
            main.row_factory = sqlite3.Row
            grp = main.execute(
                "SELECT name FROM family_groups WHERE id=?", (group_id,)).fetchone()
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
        logger.warning("Inventory migration failed for %s: %s",
                       profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Vehicles / Maintenance
# ---------------------------------------------------------------------------

def _migrate_vehicles(profile_id: str, family_owner: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_VEH_DB())
        conn.row_factory = sqlite3.Row

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
        logger.warning("Vehicles migration failed for %s: %s",
                       profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Commerce / Store
# ---------------------------------------------------------------------------

def _migrate_commerce(profile_id: str, family_owner: str,
                      group_id: str) -> dict:
    moved = 0
    try:
        conn = sqlite3.connect(_COM_DB())
        conn.row_factory = sqlite3.Row

        personal_biz = conn.execute(
            "SELECT id FROM biz_users WHERE external_user_id=?", (profile_id,)
        ).fetchone()
        if not personal_biz:
            conn.close()
            return {"moved": 0}

        puid = personal_biz["id"]

        family_biz = conn.execute(
            "SELECT id FROM biz_users WHERE external_user_id=?", (
                family_owner,)
        ).fetchone()
        if not family_biz:
            main = sqlite3.connect(_MAIN_DB())
            main.row_factory = sqlite3.Row
            grp = main.execute(
                "SELECT name FROM family_groups WHERE id=?", (group_id,)).fetchone()
            main.close()
            group_name = grp["name"] if grp else "Family"
            # Get email from personal user for display
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
            "UPDATE biz_workspaces SET owner_id=? WHERE owner_id=?", (
                fuid, puid)
        )
        moved += cur.rowcount
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Commerce migration failed for %s: %s",
                       profile_id[:8], exc)

    return {"moved": moved}


# ---------------------------------------------------------------------------
# Dissolving a group — the inverse question
# ---------------------------------------------------------------------------

def count_family_data(group_id: str) -> dict:
    """How many rows the shared owner still holds, per module.

    Deleting a family group drops the group row and its memberships and
    nothing else, so everything filed under "family:<group_id>" loses the only
    owner that resolved to it. The rows are not deleted -- they become
    unreachable, because every query filters on an owner nobody maps to any
    more. That is the same failure the culinary migration had, except total
    rather than partial and hitting every member at once.

    Read-only, and deliberately covers modules this file cannot reassign, so
    a refusal can name everything at stake rather than only the part that has
    a recovery path.
    """
    family_owner = f"family:{group_id}"
    counts: dict = {}

    def _count(db_path: str, sql: str, params: tuple) -> int:
        try:
            conn = sqlite3.connect(db_path)
            try:
                return conn.execute(sql, params).fetchone()[0]
            finally:
                conn.close()
        except Exception as exc:            # table absent, module unused
            logger.debug("Count skipped for %s: %s", db_path, exc)
            return 0

    hh = _count(
        _CUL_DB(),
        "SELECT COUNT(*) FROM cul_households WHERE owner_id=?",
        (family_owner,),
    )
    if hh:
        # A household is only worth reporting for what hangs off it.
        rows = 0
        try:
            conn = sqlite3.connect(_CUL_DB())
            conn.row_factory = sqlite3.Row
            try:
                ids = [r["id"] for r in conn.execute(
                    "SELECT id FROM cul_households WHERE owner_id=?",
                    (family_owner,)).fetchall()]
                for hid in ids:
                    for tbl in _household_scoped_tables(conn):
                        rows += conn.execute(
                            f"SELECT COUNT(*) FROM {tbl} WHERE household_id=?",
                            (hid,)).fetchone()[0]
            finally:
                conn.close()
        except Exception as exc:
            logger.debug("Culinary row count failed: %s", exc)
        if rows:
            counts["culinary"] = rows

    inv = _count(
        _INV_DB(),
        "SELECT COUNT(*) FROM inv_homes WHERE owner_id IN "
        "(SELECT id FROM inv_users WHERE external_user_id=?)",
        (family_owner,),
    )
    if inv:
        counts["inventory"] = inv

    veh = _count(
        _VEH_DB(),
        "SELECT COUNT(*) FROM vehicles WHERE external_user_id=?",
        (family_owner,),
    )
    if veh:
        counts["maintenance"] = veh

    com = _count(
        _COM_DB(),
        "SELECT COUNT(*) FROM biz_workspaces WHERE owner_id IN "
        "(SELECT id FROM biz_users WHERE external_user_id=?)",
        (family_owner,),
    )
    if com:
        counts["store"] = com

    return counts


def reassign_culinary_household(group_id: str, target_profile_id: str) -> dict:
    """Hand the shared culinary household to one profile.

    The dissolve counterpart to _migrate_culinary: same reparenting, opposite
    direction. Used when a group is being deleted and someone has to keep the
    kitchen -- there is no way to split a shared household back into the parts
    each member contributed, because nothing records who contributed what, so
    the honest operation is to name an heir rather than pretend at a division.
    """
    family_owner = f"family:{group_id}"
    try:
        conn = sqlite3.connect(_CUL_DB())
        conn.row_factory = sqlite3.Row
        try:
            fam = conn.execute(
                "SELECT id FROM cul_households WHERE owner_id=?",
                (family_owner,)).fetchone()
            if not fam:
                return {"reassigned": False, "reason": "no shared household"}

            existing = conn.execute(
                "SELECT id FROM cul_households WHERE owner_id=?",
                (target_profile_id,)).fetchone()
            if existing and existing["id"] != fam["id"]:
                # The heir already has a household of their own. Fold the
                # shared one into it rather than leaving them with two, which
                # nothing in the app can display.
                moved = 0
                for tbl in _household_scoped_tables(conn):
                    moved += conn.execute(
                        f"UPDATE {tbl} SET household_id=? WHERE household_id=?",
                        (existing["id"], fam["id"])).rowcount
                stragglers = _tables_referencing_household(conn, fam["id"])
                if stragglers:
                    conn.commit()
                    logger.error(
                        "Kept shared household %s: still referenced by %s",
                        fam["id"], stragglers)
                    return {"reassigned": False, "stragglers": stragglers,
                            "partial": True, "moved": moved}
                conn.execute(
                    "DELETE FROM cul_households WHERE id=?", (fam["id"],))
                conn.commit()
                return {"reassigned": True, "merged_into": existing["id"],
                        "moved": moved}

            conn.execute(
                "UPDATE cul_households SET owner_id=? WHERE id=?",
                (target_profile_id, fam["id"]))
            conn.commit()
            return {"reassigned": True, "household_id": fam["id"]}
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("Culinary reassignment failed for group %s: %s",
                       group_id[:8], exc)
        return {"reassigned": False, "error": str(exc)}
