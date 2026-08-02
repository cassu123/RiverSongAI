"""
core/vortex_cast.py

Casting — "put this on the living room TV".

WHY THIS GOES THROUGH HOME ASSISTANT
------------------------------------
There is no official Google Cast REST API. The practical route is
`pychromecast`, and Home Assistant already runs it: every Chromecast, Android
TV, Sonos and AirPlay target in the house is already a `media_player` entity
there, already discovered, already authenticated. Reimplementing discovery and
the Cast protocol here would mean a second, worse copy of something the
household already has — and would need credentials on this box that
`/api/home` already holds.

So casting is: resolve a target, then `media_player.play_media` through
`/api/home`. Nothing runs on the Pi.

YouTube *video* casting specifically is reverse-engineered and fragile, and is
deliberately not attempted. A direct stream URL cast to a media_player is
stable; driving the YouTube app on a TV is not.

THE UNIT COMMAND
----------------
`core/fleet_simulator.py` accepts `cast` / `stop_cast` for vortex units and
tracks a `cast_target`, so a unit *can* be told to cast something itself —
useful for a hub wired to a screen. That path queues a fleet command rather
than pushing over the WebSocket, because casting is a slow, offline-tolerant
operation and the poll already handles those. The payload is defined here and
documented for the device side, which has no handler yet.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# HA media_player entities that are worth offering as a cast target. A
# `media_player` that is a receiver with no display is still a valid audio
# target, so nothing is filtered on capability — only on being unavailable.
_UNAVAILABLE_STATES = {"unavailable", "unknown"}

# What a unit is told when we cast *through* it rather than to a TV.
UNIT_CAST_COMMAND = "cast"
UNIT_STOP_COMMAND = "stop_cast"


def _normalise(text: str) -> str:
    return (text or "").strip().lower().replace("_", " ").replace("-", " ")


async def list_targets(user_id: str) -> List[Dict[str, Any]]:
    """
    Everything in the house something can be cast to.

    Two kinds, in one list, because "the living room TV" and "the living room
    hub" are the same request from where the user is standing:

        {"kind": "media_player", "id": "media_player.living_room_tv", ...}
        {"kind": "unit",         "id": "vx-abc", "room": "kitchen", ...}
    """
    targets: List[Dict[str, Any]] = []

    try:
        from api.routes.home import collect_devices

        for device in await collect_devices():
            if device.get("domain") != "media_player":
                continue
            if str(device.get("state", "")).lower() in _UNAVAILABLE_STATES:
                continue
            targets.append({
                "kind": "media_player",
                "id": device["entity_id"],
                "name": device.get("name") or device["entity_id"],
                "state": device.get("state"),
                "now_playing": device.get("media_title"),
                "volume": device.get("volume_level"),
            })
    except Exception as exc:
        logger.warning("Could not list media_player cast targets: %s", exc)

    try:
        from core.vortex_hub import get_vortex_hub
        from core.vortex_units import list_profiles

        hub = get_vortex_hub()
        for profile in await list_profiles(user_id):
            targets.append({
                "kind": "unit",
                "id": profile["unit_id"],
                "name": profile.get("room") or profile["unit_id"],
                "room": profile.get("room") or "",
                "connected": hub.is_connected(profile["unit_id"]),
            })
    except Exception as exc:
        logger.warning("Could not list unit cast targets: %s", exc)

    return targets


async def resolve_target(query: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Turn "the living room TV" into a target.

    Exact entity ids win, then exact names, then a containment match — so
    "living room" finds "Living Room TV" but "TV" does not silently pick
    whichever TV happens to be first when the house has three.
    """
    wanted = _normalise(query)
    if not wanted:
        return None

    targets = await list_targets(user_id)

    # An exact id is unambiguous whatever kind it names.
    for target in targets:
        if target["id"].lower() == query.strip().lower():
            return target

    def _rank(target: Dict[str, Any]) -> Optional[int]:
        name = _normalise(target["name"])
        if name == wanted:
            return 0
        if wanted in name or name in wanted:
            return 1
        return None

    matches = [(rank, t) for t in targets
               if (rank := _rank(t)) is not None]
    if not matches:
        return None

    # A media_player wins over a hub whenever both match, even when the hub
    # matched more exactly. Someone who names their living room hub "living
    # room" and says "cast this to the living room" means the screen — and a
    # hub is only a cast target through a device handler that does not exist
    # yet, so guessing the hub sends video somewhere it cannot play.
    players = [(rank, t) for rank, t in matches if t["kind"] == "media_player"]
    pool = players or matches

    best_rank = min(rank for rank, _ in pool)
    best = [t for rank, t in pool if rank == best_rank]
    if len(best) == 1:
        return best[0]

    logger.info("Cast target '%s' is ambiguous between %s.", query,
                [t["name"] for t in best])
    return None


async def cast(*, user_id: str, target: Dict[str, Any], url: str,
               content_type: str = "video", title: str = "",
               artwork_url: str = "") -> Dict[str, Any]:
    """
    Start casting a stream to a resolved target.

    Args:
        target: From resolve_target — a media_player entity or a Vortex unit.
        url: A direct, fetchable stream URL. Not a YouTube watch page.
        content_type: HA media_content_type — "video", "music", "audio".

    Returns a uniform status dict, matching the rest of the Vortex action
    surface.
    """
    if not url:
        return {"status": "error", "message": "There's nothing to cast."}

    if target["kind"] == "unit":
        return await _cast_via_unit(user_id=user_id, target=target, url=url,
                                    content_type=content_type, title=title,
                                    artwork_url=artwork_url)

    # Route through the intent router so a cast obeys the same permission
    # model as everything else a unit can ask for.
    from core.intent_router import evaluate_device_request

    decision = evaluate_device_request(action="play_media",
                                       entity_id=target["id"],
                                       device_name=target["name"])
    if decision.denied:
        return {"status": "denied", "message": decision.message,
                "reason": decision.reason}

    extra: Dict[str, Any] = {}
    if title or artwork_url:
        # HA passes `extra` through to the Cast platform for metadata.
        metadata: Dict[str, Any] = {}
        if title:
            metadata["title"] = title
        if artwork_url:
            metadata["images"] = [{"url": artwork_url}]
        extra = {"metadata": metadata}

    try:
        from providers.smart_home.home_assistant import build_ha_client

        async with build_ha_client() as client:
            await client.call_service(
                "media_player", "play_media",
                entity_id=target["id"],
                media_content_id=url,
                media_content_type=content_type,
                **({"extra": extra} if extra else {}),
            )
    except Exception as exc:
        logger.error("Cast to %s failed: %s", target["id"], exc)
        return {"status": "error",
                "message": f"I couldn't reach the {target['name']}."}

    logger.info("Casting to %s (%s): %s", target["name"], target["id"],
                title or url[:80])
    return {"status": "ok", "target": target,
            "message": f"Casting{' ' + title if title else ''} "
                       f"to the {target['name']}.".replace("  ", " ")}


async def _cast_via_unit(*, user_id: str, target: Dict[str, Any], url: str,
                         content_type: str, title: str,
                         artwork_url: str) -> Dict[str, Any]:
    """
    Tell a Vortex unit to cast something itself.

    Queued as a fleet command rather than pushed over the WebSocket: casting
    is slow and offline-tolerant, which is exactly what the existing
    `/commands` poll is for, and a unit that is briefly offline should still
    get it when it comes back.

    The payload shape below is the contract for the device handler, which does
    not exist yet — `core/fleet_simulator.py` accepts the command and tracks
    `cast_target`, but no real unit implements it.
    """
    from api.routes.fleet import _ensure_schema, _now
    from providers.memory.sqlite_store import SQLiteStore
    import uuid

    payload = {
        "command": UNIT_CAST_COMMAND,
        "params": {
            "target": target.get("room") or target["name"],
            "url": url,
            "content_type": content_type,
            "title": title,
            "artwork_url": artwork_url,
        },
    }

    store = SQLiteStore()
    await _ensure_schema(store)
    command_id = uuid.uuid4().hex
    await store.execute_write_async(
        "INSERT INTO fleet_commands (command_id, program, unit_id, payload, issued_at) "
        "VALUES (?, 'vortex', ?, ?, ?)",
        (command_id, target["id"], json.dumps(payload), _now()),
    )

    logger.info("Queued cast command %s for unit %s.", command_id, target["id"])
    return {"status": "ok", "target": target, "command_id": command_id,
            "message": f"Casting to the {target['name']}."}


async def stop(*, user_id: str, target: Dict[str, Any]) -> Dict[str, Any]:
    """Stop whatever a target is playing."""
    if target["kind"] == "unit":
        from api.routes.fleet import _ensure_schema, _now
        from providers.memory.sqlite_store import SQLiteStore
        import uuid

        store = SQLiteStore()
        await _ensure_schema(store)
        command_id = uuid.uuid4().hex
        await store.execute_write_async(
            "INSERT INTO fleet_commands (command_id, program, unit_id, payload, issued_at) "
            "VALUES (?, 'vortex', ?, ?, ?)",
            (command_id, target["id"],
             json.dumps({"command": UNIT_STOP_COMMAND, "params": {}}), _now()),
        )
        return {"status": "ok", "target": target, "command_id": command_id,
                "message": f"Stopped casting to the {target['name']}."}

    try:
        from providers.smart_home.home_assistant import build_ha_client

        async with build_ha_client() as client:
            await client.call_service("media_player", "media_stop",
                                      entity_id=target["id"])
    except Exception as exc:
        logger.error("Stopping the cast on %s failed: %s", target["id"], exc)
        return {"status": "error",
                "message": f"I couldn't reach the {target['name']}."}

    return {"status": "ok", "target": target,
            "message": f"Stopped casting to the {target['name']}."}


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

async def cast_from_voice(*, user_id: str, query: str, target_name: str
                          ) -> Tuple[bool, str]:
    """
    "Cast Blue Planet to the living room TV."

    Resolves the target, resolves the media to a stream URL through the same
    resolve-only path music uses, and hands one to the other. Returns
    (handled, spoken).
    """
    target = await resolve_target(target_name, user_id)
    if target is None:
        return True, f"I couldn't find anything called the {target_name}."

    from core.vortex_media import resolve_track

    track = await resolve_track(query)
    if not track:
        return True, f"I couldn't find anything matching '{query}'."

    result = await cast(user_id=user_id, target=target, url=track["url"],
                        content_type="video", title=track.get("title", ""),
                        artwork_url=track.get("artwork_url", ""))
    return True, result.get("message") or "Done."
