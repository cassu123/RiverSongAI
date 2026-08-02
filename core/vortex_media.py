"""
core/vortex_media.py

Music comes out of the room you asked in.

`providers/google/youtube_music.py` plays audio on the River Song box itself —
it opens an output device and streams to it — so asking for music in the
kitchen has been playing it out of whatever this server is plugged into. This
module splits *resolving* a track from *playing* one:

  * resolve  → {url, title, artist, album, artwork_url, duration_seconds}
               and an optional queue. Nothing is played here.
  * target   → the unit that heard the request, or the unit in the room the
               request named ("play it in the living room"), or the unit where
               someone actually is.
  * dispatch → push the payload to that unit. The device needs nothing from us
               but a URL; transport, queue, volume and ducking all work there,
               and the unit ducks its own music while River speaks.

Requests that did not come from a unit keep the existing local playback path,
so the web UI is unaffected.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# "play X in the kitchen", "play X on the bedroom speaker"
_ROOM_PATTERN = re.compile(
    r"\b(?:in|on|to)\s+(?:the\s+)?([a-z][a-z\s]{2,24}?)\s*"
    r"(?:speaker|hub|unit|display)?\s*$",
    re.IGNORECASE,
)

TRANSPORT_ACTIONS = {
    "pause", "resume", "play", "skip", "next", "previous", "back",
    "stop", "volume", "louder", "quieter",
}


def extract_room(transcript: str) -> Optional[str]:
    """
    Pull a room name out of a request, if it named one.

    Returns None when no room was named, which means "the unit that heard it".
    """
    match = _ROOM_PATTERN.search((transcript or "").strip())
    if not match:
        return None
    candidate = match.group(1).strip().lower()
    # Guard against swallowing the track name: "play Waterloo in the rain"
    # should not resolve "the rain" to a room. Only names that match a real
    # unit's room count.
    return candidate or None


async def resolve_track(query: str) -> Optional[Dict[str, Any]]:
    """
    Search YouTube Music and return a playable descriptor without playing it.

    The `url` is a direct stream URL the unit can fetch. Returns None when
    nothing matched or no stream could be extracted.
    """
    from providers.google.youtube_music import build_youtube_music_provider

    provider = build_youtube_music_provider()
    return await provider.resolve_first_result(query)


async def target_unit(*, user_id: str, requesting_unit: Optional[str],
                      room: Optional[str]) -> Optional[str]:
    """
    Decide which unit should play.

    Order: an explicitly named room, then the unit that heard the request,
    then — if neither — the occupied room, so "follow-me audio" lands where
    the person is. Occupancy is a hint used for routing only; it never grants
    anything.
    """
    from core.vortex_hub import get_vortex_hub
    from core.vortex_units import resolve_room

    hub = get_vortex_hub()

    if room:
        candidates = [u for u in await resolve_room(room) if hub.is_connected(u)]
        if candidates:
            return candidates[0]
        logger.info("No connected Vortex unit in room '%s'.", room)
        return None

    if requesting_unit and hub.is_connected(requesting_unit):
        return requesting_unit

    occupied = [
        unit_id for unit_id in hub.connected_units()
        if (hub.connection(unit_id).occupancy or {}).get("occupied")
    ]
    return occupied[0] if occupied else None


async def play_on_unit(*, unit_id: str, track: Dict[str, Any],
                       queue: Optional[List[Dict[str, Any]]] = None) -> bool:
    """
    Hand a resolved track to a unit.

    Pushed over the WebSocket rather than POSTed to the unit's
    `/api/vortex/v1/media/play`: units poll and connect outbound, and nothing
    here should be opening an inbound connection to a Pi.
    """
    from core.vortex_hub import get_vortex_hub

    payload = {"action": "play", "track": track}
    if queue:
        payload["queue"] = queue
    return await get_vortex_hub().send(unit_id, "media", payload)


async def control_playback(*, user_id: str, requesting_unit: str,
                           action: str, value: Optional[int] = None
                           ) -> Dict[str, Any]:
    """
    Send a transport command to whichever unit is playing.

    Falls back to the requesting unit when nothing is known to be playing, so
    "pause" on a silent hub is a no-op rather than an error.
    """
    action = (action or "").lower()
    if action not in TRANSPORT_ACTIONS:
        return {"status": "error", "message": f"Unknown transport action '{action}'."}

    from core.vortex_hub import get_vortex_hub

    hub = get_vortex_hub()
    target = _playing_unit(user_id) or requesting_unit
    if not hub.is_connected(target):
        return {"status": "error", "message": "That speaker isn't connected."}

    payload: Dict[str, Any] = {"action": action}
    if value is not None:
        payload["value"] = value
    delivered = await hub.send(target, "media", payload)
    return {"status": "ok" if delivered else "error", "unit_id": target,
            "action": action}


# Which unit is currently playing, per household. Set when we dispatch a
# track, cleared on stop — the unit owns the real transport state, this is
# only enough to aim the next "pause" at the right speaker.
_playing: Dict[str, str] = {}


def _playing_unit(user_id: str) -> Optional[str]:
    return _playing.get(user_id)


def note_playing(user_id: str, unit_id: Optional[str]) -> None:
    if unit_id:
        _playing[user_id] = unit_id
    else:
        _playing.pop(user_id, None)


async def handle_play_request(*, transcript: str, user_id: str,
                              query: str) -> Optional[str]:
    """
    Route a play intent that came from a unit.

    Returns a spoken confirmation, or None when this request did not come from
    a unit and should fall through to the existing local playback path.
    """
    from core.intent_router import current_origin

    origin = current_origin()
    if not origin.is_unit:
        return None

    room = extract_room(transcript)
    target = await target_unit(user_id=user_id, requesting_unit=origin.unit_id,
                               room=room)
    if target is None:
        if room:
            return f"I don't have a speaker in the {room}."
        return "I couldn't find a speaker to play that on."

    track = await resolve_track(query)
    if not track:
        return f"Sorry, I couldn't find anything matching '{query}'."

    if not await play_on_unit(unit_id=target, track=track):
        return "I found it, but the speaker didn't answer."

    note_playing(user_id, target)

    from core.vortex_units import get_profile

    where = ""
    if target != origin.unit_id:
        profile = await get_profile(target) or {}
        where = f" in the {profile.get('room')}" if profile.get("room") else ""

    artist = track.get("artist")
    title = track.get("title", "that")
    return (f"Playing {title} by {artist}{where}." if artist
            else f"Playing {title}{where}.")
