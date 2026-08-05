"""
core/vortex_units.py

The server's record of what each River Vortex unit *is*: which household owns
it, which room it sits in, whether it has a screen, and what its camera is
capable of and consented to.

`fleet_units` is shared by five satellite programs and holds only the generic
device-fleet columns, so this lives in its own table rather than widening a
schema four other programs also use.

Two rules shape everything here:

  * Ownership is assigned by an authenticated user at pairing time and is the
    only reason this server will ever answer a unit's question about "my"
    weather or "my" devices. A unit never asserts a user id (invariant 4).
  * Camera capability is *reported* by the unit and only ever narrows what
    this server will ask for. Consent lives on the unit; this is a cache of
    what it has told us so we can avoid requesting something it will refuse
    (invariant 6).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

PROGRAM = "vortex"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS vortex_unit_profiles (
    unit_id       TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL DEFAULT '',
    room          TEXT NOT NULL DEFAULT '',
    has_display   INTEGER NOT NULL DEFAULT 1,
    camera_json   TEXT NOT NULL DEFAULT '{}',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vortex_profiles_owner
    ON vortex_unit_profiles(owner_user_id);
CREATE TABLE IF NOT EXISTS vortex_pairing_requests (
    code        TEXT PRIMARY KEY,
    metadata    TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending',
    unit_id     TEXT,
    unit_token  TEXT,
    approved_by TEXT,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    claimed_at  TEXT
);
"""

_schema_ready = False

# The four camera purposes the device layer consents to separately. All
# default off; this server may only ever request a purpose the unit has
# already told us is enabled, and a refusal is never routed around.
CAMERA_PURPOSES = ("video_calls", "motion_snapshots", "presence", "face_recognition")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_schema(store: Optional[SQLiteStore] = None) -> SQLiteStore:
    global _schema_ready
    store = store or SQLiteStore()
    if _schema_ready:
        return store
    for statement in _SCHEMA.split(";"):
        if statement.strip():
            await store.execute_write_async(statement, ())
    _schema_ready = True
    return store


def _decode(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    for key, target in (("camera_json", "camera"), ("settings_json", "settings")):
        try:
            out[target] = json.loads(out.pop(key, "") or "{}")
        except ValueError:
            out[target] = {}
    out["has_display"] = bool(out.get("has_display", 1))
    return out


async def get_profile(unit_id: str) -> Optional[Dict[str, Any]]:
    """Return a unit's profile, or None when it has never been seen."""
    store = await ensure_schema()
    row = await store.execute_read_one_async(
        "SELECT * FROM vortex_unit_profiles WHERE unit_id=?", (unit_id,)
    )
    return _decode(row) if row else None


async def list_profiles(owner_user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    store = await ensure_schema()
    if owner_user_id:
        rows = await store.execute_read_async(
            "SELECT * FROM vortex_unit_profiles WHERE owner_user_id=? ORDER BY room",
            (owner_user_id,),
        )
    else:
        rows = await store.execute_read_async(
            "SELECT * FROM vortex_unit_profiles ORDER BY room", ()
        )
    return [_decode(r) for r in rows]


async def upsert_profile(unit_id: str, *,
                         owner_user_id: Optional[str] = None,
                         room: Optional[str] = None,
                         has_display: Optional[bool] = None,
                         camera: Optional[Dict[str, Any]] = None,
                         settings: Optional[Dict[str, Any]] = None
                         ) -> Dict[str, Any]:
    """
    Create or update a unit profile. Only the fields passed are touched.

    `camera` and `settings` are merged into the stored dicts rather than
    replacing them, so a unit reporting one changed consent flag does not
    blank the others.
    """
    store = await ensure_schema()
    existing = await get_profile(unit_id)

    if existing is None:
        await store.execute_write_async(
            "INSERT INTO vortex_unit_profiles "
            "(unit_id, owner_user_id, room, has_display, camera_json, "
            " settings_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (unit_id, owner_user_id or "", room or "",
             1 if (has_display is None or has_display) else 0,
             json.dumps(camera or {}), json.dumps(settings or {}),
             _now(), _now()),
        )
        return await get_profile(unit_id) or {}

    merged_camera = {**existing.get("camera", {}), **(camera or {})}
    merged_settings = {**existing.get("settings", {}), **(settings or {})}
    await store.execute_write_async(
        "UPDATE vortex_unit_profiles SET owner_user_id=?, room=?, has_display=?, "
        "camera_json=?, settings_json=?, updated_at=? WHERE unit_id=?",
        (
            owner_user_id if owner_user_id is not None else existing["owner_user_id"],
            room if room is not None else existing["room"],
            (1 if has_display else 0) if has_display is not None
            else (1 if existing["has_display"] else 0),
            json.dumps(merged_camera),
            json.dumps(merged_settings),
            _now(),
            unit_id,
        ),
    )
    return await get_profile(unit_id) or {}


async def delete_profile(unit_id: str) -> None:
    store = await ensure_schema()
    await store.execute_write_async(
        "DELETE FROM vortex_unit_profiles WHERE unit_id=?", (unit_id,)
    )


async def resolve_owner(unit_id: str) -> Optional[str]:
    """
    Return the user id a unit acts on behalf of.

    This is the *only* way a unit-authenticated request acquires a user
    identity. It comes from the profile written when a logged-in user approved
    the pairing — never from anything the unit sends.
    """
    profile = await get_profile(unit_id)
    owner = (profile or {}).get("owner_user_id") or ""
    return owner or None


async def resolve_room(room: str) -> List[str]:
    """
    Return unit ids whose profile room matches `room`.

    Matching is case- and separator-insensitive so "living room", "Living
    Room" and "living_room" all resolve, which is what a transcript will
    actually contain.
    """
    target = normalise_room(room)
    if not target:
        return []
    return [p["unit_id"] for p in await list_profiles()
            if normalise_room(p.get("room", "")) == target]


def normalise_room(room: str) -> str:
    return (room or "").strip().lower().replace("_", " ").replace("-", " ")


def camera_purpose_enabled(profile: Optional[Dict[str, Any]],
                           purpose: str) -> bool:
    """
    Whether a unit has told us a camera purpose is consented and usable.

    Defaults to False for everything, including unknown purposes and unknown
    units. The unit enforces this regardless — this only stops us asking for
    something we already know will be refused.
    """
    if not profile or purpose not in CAMERA_PURPOSES:
        return False
    camera = profile.get("camera") or {}
    if not camera.get("fitted") or camera.get("muted"):
        return False
    return bool((camera.get("purposes") or {}).get(purpose))
