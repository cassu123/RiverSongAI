"""
tests/test_family_migration.py

Linking a profile into a family group moves that profile's culinary data to
the shared household and then deletes the personal one. The delete is the only
destructive statement in the whole migration -- the inventory, vehicle and
commerce migrators reparent and leave the personal record standing -- so
anything the move misses is not merely unmigrated, it is unreachable: the rows
survive (sqlite3 leaves foreign keys off unless asked, and that module never
asks) but every query filters on household_id, and that household is gone.

The load-bearing assertion is therefore not "the data moved" but "nothing was
left pointing at a household that is about to be deleted". A hand-maintained
table list satisfied the first and failed the second for four tables --
shopping list, banned ingredients, meal plan, cooking sessions -- which are
exactly the tables added after the migration was written. Banned ingredients
carry allergies, so that one failed quietly and dangerously.
"""

import os
import sqlite3

import pytest

from core.family_migration import _household_scoped_tables, _migrate_culinary


#: Mirrors the household-scoped tables in culinary/models.py.
#: cul_prep_session_recipes and cul_cooking_timers key on their parent
#: session rather than the household, so they are deliberately absent.
SCOPED_TABLES = [
    "cul_recipes", "cul_banned_ingredients", "cul_stockroom",
    "cul_prep_sessions", "cul_kitchen_equipment", "cul_walmart_mappings",
    "cul_active_vote", "cul_shopping_list", "cul_meal_plan",
    "cul_cooking_sessions",
]


@pytest.fixture()
def culinary_db(tmp_path, monkeypatch):
    """A culinary DB with one personal household and a row in every table."""
    path = tmp_path / "culinary.db"
    monkeypatch.setenv("CULINARY_DB_URL", f"sqlite:///{path}")

    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE cul_households (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT)")
    for table in SCOPED_TABLES:
        conn.execute(
            f"CREATE TABLE {table} (id TEXT PRIMARY KEY, household_id TEXT)")
    # Session-keyed, not household-keyed: must survive untouched, and must not
    # trip up schema discovery.
    conn.execute(
        "CREATE TABLE cul_cooking_timers (id TEXT PRIMARY KEY, session_id TEXT)")

    conn.execute(
        "INSERT INTO cul_households VALUES ('hh-personal', 'user-42', 'Mine')")
    for i, table in enumerate(SCOPED_TABLES):
        conn.execute(f"INSERT INTO {table} VALUES ('row-{i}', 'hh-personal')")
    conn.execute("INSERT INTO cul_cooking_timers VALUES ('timer-1', 'sess-1')")
    conn.commit()
    conn.close()
    return str(path)


def _rows(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def test_discovery_finds_every_household_scoped_table(culinary_db):
    """Schema discovery, not a list someone has to remember to update."""
    conn = sqlite3.connect(culinary_db)
    conn.row_factory = sqlite3.Row
    try:
        found = _household_scoped_tables(conn)
    finally:
        conn.close()

    assert found == sorted(SCOPED_TABLES)
    assert "cul_households" not in found          # the parent itself
    assert "cul_cooking_timers" not in found      # keyed on its session


def test_nothing_is_orphaned_by_the_delete(culinary_db):
    """No row may outlive the household it points at.

    This is the assertion the old six-table list failed. It is written against
    every scoped table at once rather than naming the four that regressed, so
    a table added tomorrow is covered without anyone editing this file.
    """
    _migrate_culinary("user-42", "family:grp-7", "grp-7")

    for table in SCOPED_TABLES:
        orphaned = _rows(
            culinary_db,
            f"SELECT COUNT(*) AS n FROM {table} WHERE household_id NOT IN "
            "(SELECT id FROM cul_households)",
        )[0]["n"]
        assert orphaned == 0, f"{table} left {orphaned} row(s) orphaned"


def test_every_table_lands_in_the_shared_household(culinary_db):
    result = _migrate_culinary("user-42", "family:grp-7", "grp-7")

    family = _rows(
        culinary_db,
        "SELECT id FROM cul_households WHERE owner_id='family:grp-7'")
    assert family, "shared household was not created"
    family_id = family[0]["id"]

    for table in SCOPED_TABLES:
        owner = _rows(culinary_db, f"SELECT household_id FROM {table}")[0]
        assert owner["household_id"] == family_id, f"{table} did not move"

    assert result["moved"] == len(SCOPED_TABLES)
    assert result["household_deleted"] is True
    assert not _rows(
        culinary_db, "SELECT id FROM cul_households WHERE id='hh-personal'")


def test_allergies_survive_the_move(culinary_db):
    """Called out on its own because of what it costs when it fails.

    Banned ingredients drive substitution during recipe ingest and scaling.
    Orphaning them does not error -- the restriction just stops applying, and
    nobody is told.
    """
    _migrate_culinary("user-42", "family:grp-7", "grp-7")

    surviving = _rows(
        culinary_db,
        "SELECT b.id FROM cul_banned_ingredients b "
        "JOIN cul_households h ON h.id = b.household_id")
    assert len(surviving) == 1


def test_session_keyed_rows_are_left_alone(culinary_db):
    _migrate_culinary("user-42", "family:grp-7", "grp-7")

    timer = _rows(culinary_db, "SELECT session_id FROM cul_cooking_timers")[0]
    assert timer["session_id"] == "sess-1"


def test_personal_household_is_kept_when_something_still_points_at_it(
        culinary_db, monkeypatch):
    """A future missed table must fail loudly, not silently.

    Discovery is narrowed to one table so the others are left behind, standing
    in for a table nobody thought to migrate. The household must survive so
    the data stays reachable.
    """
    monkeypatch.setattr(
        "core.family_migration._household_scoped_tables",
        lambda conn: ["cul_recipes"],
    )
    result = _migrate_culinary("user-42", "family:grp-7", "grp-7")

    assert result["household_deleted"] is False
    assert "cul_shopping_list" in result["stragglers"]
    assert _rows(
        culinary_db, "SELECT id FROM cul_households WHERE id='hh-personal'")


def test_migration_is_idempotent(culinary_db):
    """Re-linking the same profile must not double-move or re-delete."""
    first = _migrate_culinary("user-42", "family:grp-7", "grp-7")
    second = _migrate_culinary("user-42", "family:grp-7", "grp-7")

    assert first["moved"] == len(SCOPED_TABLES)
    assert second["moved"] == 0

    for table in SCOPED_TABLES:
        assert len(_rows(culinary_db, f"SELECT id FROM {table}")) == 1
