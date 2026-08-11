"""
tests/test_multi_family_isolation.py

Two families on one instance.

Everything about running two households off one box rests on a single claim:
that `resolve_module_owner` sends each family to its own owner key, and that
every module-scoped query is filtered by that key. If that holds, the families
cannot see each other and no further isolation work is needed. If it does not,
the shared-instance plan is unsafe and no amount of UI care fixes it.

So this asserts the claim rather than trusting it. It is written against the
resolution layer and the culinary migration together, because that pair is
where a leak would actually happen: resolution decides the owner, migration
decides which rows carry it.

The interesting cases are not the happy path. They are the boundaries --
a module one group shares and the other does not, a user in no group at all,
and two groups migrating in sequence, which is the order that would let a
second migration capture the first family's rows if the queries were sloppy.
"""

import json
import sqlite3

import pytest


@pytest.fixture()
def two_families(tmp_path, monkeypatch):
    """Main DB with two groups: the Smiths share culinary, the Joneses do not.

    Deliberately asymmetric. A test where both groups are configured the same
    way cannot tell "correctly isolated" from "the same lookup twice".
    """
    main = tmp_path / "main.db"
    conn = sqlite3.connect(main)
    conn.execute(
        "CREATE TABLE family_groups (id TEXT PRIMARY KEY, name TEXT, "
        "shared_modules TEXT)")
    conn.execute(
        "CREATE TABLE family_memberships (profile_id TEXT PRIMARY KEY, "
        "family_group_id TEXT)")

    conn.execute(
        "INSERT INTO family_groups VALUES ('grp-smith', 'Smiths', ?)",
        (json.dumps(["culinary", "inventory"]),))
    conn.execute(
        "INSERT INTO family_groups VALUES ('grp-jones', 'Joneses', ?)",
        (json.dumps(["inventory"]),))          # culinary deliberately absent

    conn.execute("INSERT INTO family_memberships VALUES ('chris', 'grp-smith')")
    conn.execute("INSERT INTO family_memberships VALUES ('pat',   'grp-smith')")
    conn.execute("INSERT INTO family_memberships VALUES ('sam',   'grp-jones')")
    conn.commit()
    conn.close()

    monkeypatch.setattr("core.family._db_path", lambda: str(main))
    # The module caches one connection per thread, so a previous test's
    # database would otherwise still be attached.
    import core.family
    if hasattr(core.family._local, "conn"):
        del core.family._local.conn
    yield str(main)
    if hasattr(core.family._local, "conn"):
        del core.family._local.conn


@pytest.fixture()
def culinary_db(tmp_path, monkeypatch):
    path = tmp_path / "culinary.db"
    monkeypatch.setenv("CULINARY_DB_URL", f"sqlite:///{path}")
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE cul_households (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT)")
    for table in ("cul_recipes", "cul_banned_ingredients", "cul_shopping_list"):
        conn.execute(
            f"CREATE TABLE {table} (id TEXT PRIMARY KEY, household_id TEXT)")
    conn.commit()
    conn.close()
    return str(path)


def _rows(db, sql, params=()):
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Owner resolution
# ---------------------------------------------------------------------------

def test_two_families_resolve_to_different_owners(two_families):
    from core.family import resolve_module_owner

    assert resolve_module_owner("chris", "inventory") == "family:grp-smith"
    assert resolve_module_owner("sam", "inventory") == "family:grp-jones"
    assert resolve_module_owner("chris", "inventory") != \
        resolve_module_owner("sam", "inventory")


def test_members_of_one_family_share_an_owner(two_families):
    """The point of a group: two people, one pantry."""
    from core.family import resolve_module_owner

    assert resolve_module_owner("chris", "culinary") == \
        resolve_module_owner("pat", "culinary")


def test_an_unshared_module_stays_personal(two_families):
    """The Joneses share inventory but not culinary.

    Sam must land on his own key for culinary even though he is in a group --
    otherwise joining a group for one module silently pools every module.
    """
    from core.family import resolve_module_owner

    assert resolve_module_owner("sam", "culinary") == "sam"
    assert resolve_module_owner("sam", "inventory") == "family:grp-jones"


def test_a_user_in_no_group_is_their_own_owner(two_families):
    from core.family import resolve_module_owner

    assert resolve_module_owner("stranger", "culinary") == "stranger"
    assert resolve_module_owner("stranger", "inventory") == "stranger"


# ---------------------------------------------------------------------------
# Data isolation, once those owners are written to rows
# ---------------------------------------------------------------------------

def test_neither_family_can_reach_the_others_rows(two_families, culinary_db):
    """Migrate both families in sequence and check nothing crosses over.

    Sequence matters. A second migration that filtered loosely -- on the
    table rather than on the departing household -- would sweep up the first
    family's rows, and doing them one after the other is the only ordering
    that exposes it.
    """
    from core.family import resolve_module_owner
    from core.family_migration import _migrate_culinary

    conn = sqlite3.connect(culinary_db)
    conn.execute("INSERT INTO cul_households VALUES ('hh-chris', 'chris', 'Mine')")
    conn.execute("INSERT INTO cul_households VALUES ('hh-sam', 'sam', 'Theirs')")
    conn.execute("INSERT INTO cul_recipes VALUES ('r-chris', 'hh-chris')")
    conn.execute("INSERT INTO cul_recipes VALUES ('r-sam', 'hh-sam')")
    conn.execute(
        "INSERT INTO cul_banned_ingredients VALUES ('b-chris', 'hh-chris')")
    conn.execute("INSERT INTO cul_banned_ingredients VALUES ('b-sam', 'hh-sam')")
    conn.commit()
    conn.close()

    _migrate_culinary("chris", "family:grp-smith", "grp-smith")
    # Sam's group does not share culinary, so he is never migrated -- which is
    # itself the isolation guarantee for an unshared module.
    assert resolve_module_owner("sam", "culinary") == "sam"

    smith_hh = _rows(
        culinary_db,
        "SELECT id FROM cul_households WHERE owner_id='family:grp-smith'")
    assert len(smith_hh) == 1
    smith_id = smith_hh[0]["id"]

    sam_hh = _rows(
        culinary_db, "SELECT id FROM cul_households WHERE owner_id='sam'")
    assert len(sam_hh) == 1, "Sam's household was disturbed by another family"
    sam_id = sam_hh[0]["id"]
    assert sam_id != smith_id

    # The load-bearing assertion: every row still belongs to exactly the
    # household it started in.
    for table, mine, theirs in (
        ("cul_recipes", "r-chris", "r-sam"),
        ("cul_banned_ingredients", "b-chris", "b-sam"),
    ):
        owner = {r["id"]: r["household_id"]
                 for r in _rows(culinary_db, f"SELECT id, household_id FROM {table}")}
        assert owner[mine] == smith_id, f"{table}: {mine} did not follow its family"
        assert owner[theirs] == sam_id, f"{table}: {theirs} leaked out of its household"


def test_a_second_family_migrating_later_does_not_capture_the_first(
        two_families, culinary_db):
    """Both groups sharing culinary, migrated one after the other."""
    from core.family_migration import _migrate_culinary

    conn = sqlite3.connect(culinary_db)
    conn.execute("INSERT INTO cul_households VALUES ('hh-chris', 'chris', '')")
    conn.execute("INSERT INTO cul_households VALUES ('hh-sam', 'sam', '')")
    conn.execute("INSERT INTO cul_recipes VALUES ('r-chris', 'hh-chris')")
    conn.execute("INSERT INTO cul_recipes VALUES ('r-sam', 'hh-sam')")
    conn.commit()
    conn.close()

    _migrate_culinary("chris", "family:grp-smith", "grp-smith")
    _migrate_culinary("sam", "family:grp-jones", "grp-jones")

    by_owner = {}
    for r in _rows(
        culinary_db,
        "SELECT h.owner_id AS owner, r.id AS rid FROM cul_recipes r "
        "JOIN cul_households h ON h.id = r.household_id",
    ):
        by_owner.setdefault(r["owner"], set()).add(r["rid"])

    assert by_owner == {
        "family:grp-smith": {"r-chris"},
        "family:grp-jones": {"r-sam"},
    }


# ---------------------------------------------------------------------------
# Spend
#
# Data isolation is not the whole story on a shared box: the families also
# share one set of API keys, so what each of them costs has to be answerable
# separately. /api/usage/tokens used to return the instance total to every
# authenticated account, which on a one-household box read as your own usage
# and on a two-family box is the other family's spending.
# ---------------------------------------------------------------------------

def test_family_member_ids_groups_the_household(two_families):
    from core.family import family_member_ids

    assert sorted(family_member_ids("chris")) == ["chris", "pat"]
    assert family_member_ids("sam") == ["sam"]
    # Not in a group: filterable without the caller special-casing it.
    assert family_member_ids("stranger") == ["stranger"]


def test_usage_summary_is_filtered_by_account(tmp_path, monkeypatch):
    """The filter the endpoint's scoping rests on."""
    import core.token_tracker as tt

    # Patch _db_path rather than a settings object: the real one imports
    # config.settings, which pulls in the whole application configuration for
    # a test that only needs a table.
    monkeypatch.setattr(tt, "_db_path", lambda: tmp_path / "usage.db")
    monkeypatch.setattr(tt, "_schema_ready", False)
    if hasattr(tt._local, "conn"):
        del tt._local.conn          # thread-local connection outlives a test

    tt.ensure_table()
    conn = tt._connect()
    now = __import__("time").time()
    for uid, inp in (("chris", 100), ("pat", 200), ("sam", 400), ("system", 800)):
        conn.execute(
            "INSERT INTO token_usage (ts, provider, model, input_tokens, "
            "output_tokens, user_id, call_type, source) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (now, "ollama", "llama3.2:3b", inp, 0, uid, "stream", "chat"))
    conn.commit()

    assert tt.get_summary(days=1, user_ids=["chris"])["total_input"] == 100
    assert tt.get_summary(days=1, user_ids=["chris", "pat"])["total_input"] == 300
    assert tt.get_summary(days=1, user_ids=["sam"])["total_input"] == 400

    # Unfiltered still means the instance, background work included -- that is
    # what makes the admin view different from the sum of the households.
    assert tt.get_summary(days=1)["total_input"] == 1500

    # An empty account list must match nothing, not silently widen to all.
    assert tt.get_summary(days=1, user_ids=[])["total_input"] == 0

    if hasattr(tt._local, "conn"):
        del tt._local.conn
