"""
core/vortex_calls.py

Room-to-room intercom and video calls — and the phone app talking to the house.

WHAT THIS SERVER ACTUALLY DOES
------------------------------
Signalling, and nothing else. Audio and video never pass through here: the two
endpoints exchange WebRTC offers, answers and ICE candidates *via* this server
and then send media directly to each other. On a home LAN that is a couple of
hops over the switch, which is why a Pi in the kitchen can hold a video call
with a Pi in the bedroom without this machine doing any work at all.

That also means the interesting failure mode is not bandwidth here, it is ICE:
two devices on the same LAN find each other with host candidates and need
nothing configured. A phone on mobile data does not, and needs a TURN server —
see `vortex_ice_servers`. This module hands both peers the same ICE
configuration at setup so neither has to be told separately.

PARTICIPANTS
------------
A call has exactly two, and either can be:

    unit:<unit_id>   a River Vortex hub, reached over /api/vortex/ws
    user:<user_id>   the phone app or a browser, over /api/vortex/calls/ws

Both are addressed the same way and the relay does not care which is which, so
kitchen-to-bedroom, phone-to-kitchen and kitchen-to-phone are one code path
rather than three.

CONSENT
-------
Video from a unit requires the `video_calls` camera purpose to be enabled on
that unit. Consent lives on the device and this only ever narrows what gets
asked for: a unit without it is offered the call as audio, not refused and not
worked around. Audio intercom needs no camera at all.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

# A call nobody answers stops ringing. Long enough to walk to the hallway,
# short enough that a forgotten call does not tie up a screen.
RING_TIMEOUT_SECONDS = 45.0

# Calls are torn down if signalling never completes. A half-open call holds a
# camera light on at one end, which is not a state to leave lying around.
SETUP_TIMEOUT_SECONDS = 120.0

STATE_RINGING = "ringing"
STATE_ACTIVE = "active"
STATE_ENDED = "ended"

MODE_AUDIO = "audio"
MODE_VIDEO = "video"


def participant_id(*, unit_id: Optional[str] = None,
                   user_id: Optional[str] = None) -> str:
    """Address a unit or a person with one string."""
    if unit_id:
        return f"unit:{unit_id}"
    if user_id:
        return f"user:{user_id}"
    raise ValueError("A participant needs either a unit_id or a user_id.")


def split_participant(address: str) -> Tuple[str, str]:
    """('unit', 'vx-abc') from 'unit:vx-abc'."""
    kind, _, value = (address or "").partition(":")
    return kind, value


@dataclass
class Call:
    """One two-party call and everything needed to route its signalling."""
    id: str
    caller: str
    callee: str
    mode: str = MODE_AUDIO
    state: str = STATE_RINGING
    # The household this call belongs to. Both ends must be in it — a call is
    # never a way to reach a device in someone else's house.
    owner_user_id: str = ""
    created_at: float = field(default_factory=time.monotonic)
    answered_at: Optional[float] = None
    ended_at: Optional[float] = None
    end_reason: str = ""
    # Buffered signalling for a participant that has not connected yet, so a
    # phone that answers a moment before its socket opens does not lose the
    # offer.
    pending: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def other(self, address: str) -> str:
        return self.callee if address == self.caller else self.caller

    def involves(self, address: str) -> bool:
        return address in (self.caller, self.callee)

    def to_wire(self, *, viewer: Optional[str] = None) -> Dict[str, Any]:
        payload = {
            "call_id": self.id,
            "caller": self.caller,
            "callee": self.callee,
            "mode": self.mode,
            "state": self.state,
        }
        if viewer:
            payload["peer"] = self.other(viewer)
            payload["is_caller"] = viewer == self.caller
        if self.end_reason:
            payload["reason"] = self.end_reason
        return payload


class CallRegistry:
    """
    Live calls, and the relay between their two ends.

    In memory only. A call is a thing happening right now between two devices;
    if this server restarts mid-call the peers lose their signalling channel
    and should hang up, not rediscover a call record that outlived the
    connection it described.
    """

    def __init__(self) -> None:
        self._calls: Dict[str, Call] = {}
        self._lock = LoopLock()
        self._ring_timers: Dict[str, asyncio.Task] = {}

    # -- lookup -----------------------------------------------------------

    def get(self, call_id: str) -> Optional[Call]:
        return self._calls.get(call_id)

    def active_for(self, address: str) -> Optional[Call]:
        """The call this participant is in, if any."""
        for call in self._calls.values():
            if call.state != STATE_ENDED and call.involves(address):
                return call
        return None

    def list_calls(self, owner_user_id: str) -> List[Dict[str, Any]]:
        return [c.to_wire() for c in self._calls.values()
                if c.owner_user_id == owner_user_id and c.state != STATE_ENDED]

    # -- lifecycle --------------------------------------------------------

    async def start(self, *, caller: str, callee: str, owner_user_id: str,
                    mode: str = MODE_AUDIO,
                    ice_servers: Optional[List[Dict[str, Any]]] = None
                    ) -> Tuple[Optional[Call], str]:
        """
        Ring `callee` from `caller`.

        Returns (call, error). `error` is a message safe to show or speak —
        already in a call, not reachable, same device at both ends.
        """
        if caller == callee:
            return None, "That's the same device at both ends."

        async with self._lock:
            for address in (caller, callee):
                busy = self.active_for(address)
                if busy is not None:
                    who = "You're" if address == caller else "They're"
                    return None, f"{who} already on a call."

            call = Call(id=uuid.uuid4().hex[:16], caller=caller, callee=callee,
                        mode=mode, owner_user_id=owner_user_id)
            self._calls[call.id] = call

        logger.info("Call %s: %s → %s (%s).", call.id, caller, callee, mode)

        await self._deliver(callee, {
            "type": "call_invite",
            **call.to_wire(viewer=callee),
            "ice_servers": ice_servers or [],
        })
        await self._deliver(caller, {
            "type": "call_state",
            **call.to_wire(viewer=caller),
            "ice_servers": ice_servers or [],
        })

        self._ring_timers[call.id] = asyncio.create_task(
            self._ring_timeout(call.id))
        return call, ""

    async def _ring_timeout(self, call_id: str) -> None:
        try:
            await asyncio.sleep(RING_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            return
        call = self._calls.get(call_id)
        if call is not None and call.state == STATE_RINGING:
            logger.info("Call %s: nobody answered.", call_id)
            await self.end(call_id, reason="no_answer")

    async def answer(self, call_id: str, address: str) -> Tuple[Optional[Call], str]:
        """Accept a ringing call. Only the callee may."""
        call = self._calls.get(call_id)
        if call is None:
            return None, "That call has already ended."
        if call.callee != address:
            return None, "That call isn't for this device."
        if call.state != STATE_RINGING:
            return None, "That call is no longer ringing."

        call.state = STATE_ACTIVE
        call.answered_at = time.monotonic()
        self._cancel_ring(call_id)

        logger.info("Call %s answered by %s.", call_id, address)
        await self._deliver(call.caller, {
            "type": "call_state", **call.to_wire(viewer=call.caller)})
        await self._deliver(call.callee, {
            "type": "call_state", **call.to_wire(viewer=call.callee)})
        return call, ""

    async def end(self, call_id: str, *, reason: str = "hung_up",
                  by: str = "") -> Optional[Call]:
        """
        End a call and tell both ends.

        Told to both ends deliberately: the party that did not hang up needs
        to know to release its camera, and on a Vortex unit that camera light
        is an interlock the user can see.
        """
        call = self._calls.get(call_id)
        if call is None or call.state == STATE_ENDED:
            return call

        call.state = STATE_ENDED
        call.ended_at = time.monotonic()
        call.end_reason = reason
        self._cancel_ring(call_id)

        logger.info("Call %s ended (%s%s).", call_id, reason,
                    f", by {by}" if by else "")
        for address in (call.caller, call.callee):
            await self._deliver(address, {
                "type": "call_end", "call_id": call_id, "reason": reason})

        # Keep the record briefly so a late frame gets a clear answer rather
        # than "unknown call", then drop it.
        asyncio.create_task(self._forget(call_id))
        return call

    async def _forget(self, call_id: str, delay: float = 30.0) -> None:
        await asyncio.sleep(delay)
        self._calls.pop(call_id, None)

    def _cancel_ring(self, call_id: str) -> None:
        task = self._ring_timers.pop(call_id, None)
        if task is not None:
            task.cancel()

    # -- signalling relay -------------------------------------------------

    async def relay(self, call_id: str, sender: str,
                    frame: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Pass one signalling frame to the other end, unread.

        SDP and ICE are between the peers. This server checks only that the
        sender is in the call and forwards the payload verbatim — it does not
        parse, rewrite or store the session description.
        """
        call = self._calls.get(call_id)
        if call is None:
            return False, "That call has already ended."
        if not call.involves(sender):
            logger.warning("Call %s: %s tried to signal a call it is not in.",
                           call_id, sender)
            return False, "That call isn't yours."
        if call.state == STATE_ENDED:
            return False, "That call has already ended."

        await self._deliver(call.other(sender), {
            **frame, "call_id": call_id, "from": sender})
        return True, ""

    async def _deliver(self, address: str, frame: Dict[str, Any]) -> bool:
        """
        Send a frame to a participant, whichever kind it is.

        Buffers for a participant with no live socket: a phone that accepted a
        push notification and is still opening its WebSocket should get the
        offer that was already waiting rather than a call that silently failed.
        """
        kind, value = split_participant(address)

        if kind == "unit":
            from core.vortex_hub import get_vortex_hub
            if await get_vortex_hub().send(value, frame.get("type", "call"),
                                           {k: v for k, v in frame.items()
                                            if k != "type"}):
                return True
        elif kind == "user":
            from core.vortex_calls_ws import send_to_user
            if await send_to_user(value, frame):
                return True

        call_id = frame.get("call_id")
        if call_id and call_id in self._calls:
            self._calls[call_id].pending.setdefault(address, []).append(frame)
            logger.debug("Buffered %s for %s (not connected).",
                         frame.get("type"), address)
        return False

    async def drain_pending(self, address: str) -> List[Dict[str, Any]]:
        """Frames buffered for a participant while it had no socket."""
        drained: List[Dict[str, Any]] = []
        for call in self._calls.values():
            queued = call.pending.pop(address, None)
            if queued:
                drained.extend(queued)
        return drained

    async def end_all_for(self, address: str, *, reason: str = "peer_gone"
                          ) -> None:
        """End whatever this participant was in — called when it disconnects."""
        call = self.active_for(address)
        if call is not None:
            await self.end(call.id, reason=reason, by=address)

    async def reset(self) -> None:
        """Drop every call. Test helper."""
        for task in list(self._ring_timers.values()):
            task.cancel()
        self._ring_timers.clear()
        self._calls.clear()


_registry: Optional[CallRegistry] = None


def get_call_registry() -> CallRegistry:
    """Return the shared CallRegistry."""
    global _registry
    if _registry is None:
        _registry = CallRegistry()
    return _registry


# ---------------------------------------------------------------------------
# ICE configuration
# ---------------------------------------------------------------------------

def ice_servers() -> List[Dict[str, Any]]:
    """
    The ICE servers both peers are handed at call setup.

    Empty by default, which is the right answer for the case this was built
    for: two devices on the same LAN connect on host candidates alone and need
    no STUN and no TURN. A phone on mobile data does need them, so
    `VORTEX_ICE_SERVERS` takes a JSON array in the standard WebRTC shape:

        [{"urls": "stun:stun.example.org:3478"},
         {"urls": "turn:turn.example.org:3478",
          "username": "river", "credential": "..."}]

    Nothing is defaulted to a public STUN server: that would quietly send
    every household's IP to a third party to solve a problem most of these
    calls do not have.
    """
    import json

    from config.settings import get_settings

    raw = (getattr(get_settings(), "vortex_ice_servers", "") or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        logger.error("VORTEX_ICE_SERVERS is not valid JSON (%s); "
                     "calls will be LAN-only.", exc)
        return []
    if not isinstance(parsed, list):
        logger.error("VORTEX_ICE_SERVERS must be a JSON array; "
                     "calls will be LAN-only.")
        return []
    return parsed


# ---------------------------------------------------------------------------
# Mode negotiation
# ---------------------------------------------------------------------------

async def negotiate_mode(requested: str, caller: str, callee: str) -> Tuple[str, str]:
    """
    Settle on audio or video, given what each end can actually do.

    A video call to a unit whose owner has not enabled the `video_calls`
    camera purpose becomes an audio call. That is the correct handling of a
    consent boundary: the call still connects, it just does not carry video.
    Downgrading is not routing around a refusal — asking the unit anyway, or
    asking for a different purpose, would be.

    Returns (mode, note). `note` explains a downgrade, for the caller to see.
    """
    if requested != MODE_VIDEO:
        return MODE_AUDIO, ""

    from core.vortex_units import camera_purpose_enabled, get_profile

    for address in (caller, callee):
        kind, value = split_participant(address)
        if kind != "unit":
            continue
        profile = await get_profile(value)
        if not camera_purpose_enabled(profile, "video_calls"):
            room = (profile or {}).get("room") or value
            logger.info("Call downgraded to audio: video_calls is not enabled "
                        "on unit %s.", value)
            return MODE_AUDIO, (
                f"Video calls aren't switched on for the {room} unit, "
                "so this is audio only."
            )
    return MODE_VIDEO, ""
