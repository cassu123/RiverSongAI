"""
core/vortex_hub.py

The live channel to River Vortex units.

One authenticated WebSocket per unit, held here so any part of the server can
push to a specific unit, to a room, or to the whole house without knowing how
the socket got there. The `/commands` poll in fleet.py stays as it is for slow,
offline-tolerant operations; this is for everything that has to be sub-second.

Server → unit message vocabulary (fixed — the Vortex orb consumes exactly
these shapes; see prototypes/presence-orb.html):

    presence   {state, amplitude, mood, caption}
    amplitude  {value: 0..1}
    audio      {audio: <base64 wav>, text?}
    surface    <card descriptor>
    surface_withdraw {id}
    navigate   {page}
    replica    {version, ...deltas}
    devices_update / cameras_update / notifications_update  {data: [...]}
    media      {action, ...}

`state` is one of PRESENCE_STATES. Nothing else is valid, and this module
refuses to send anything else rather than letting an unknown state reach a
renderer that will silently drop it.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
import wave
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

PRESENCE_STATES = frozenset(
    {"idle", "listening", "thinking", "speaking", "acting", "error"}
)

# The orb renders at 60fps and interpolates, so 30Hz of real envelope data is
# plenty and keeps the frame budget on a Pi Zero-class unit reasonable.
AMPLITUDE_HZ = 30.0
_AMPLITUDE_PERIOD = 1.0 / AMPLITUDE_HZ


@dataclass
class VortexConnection:
    """One live unit socket."""
    unit_id: str
    websocket: Any
    room: Optional[str] = None
    has_display: bool = True
    connected_at: float = field(default_factory=time.time)
    # Last self-reported presence/occupancy, treated as a hint only.
    state: str = "idle"
    occupancy: Dict[str, Any] = field(default_factory=dict)


class VortexHub:
    """
    Registry of connected units plus the push helpers built on top of it.

    Sends are best effort by design: a unit that has dropped off WiFi must not
    make a caller fail. Failed sends drop the connection and are logged, never
    raised at the publisher.
    """

    def __init__(self) -> None:
        self._connections: Dict[str, VortexConnection] = {}
        self._lock = LoopLock()
        self._speaking_tasks: Dict[str, asyncio.Task] = {}

    # -- registry ---------------------------------------------------------

    async def register(self, unit_id: str, websocket: Any, *,
                       room: Optional[str] = None,
                       has_display: bool = True) -> VortexConnection:
        """
        Attach a socket to a unit id, replacing any previous one.

        A unit that reconnects (Pi reboot, WiFi flap) must not end up with two
        live sockets, or every push is delivered twice.
        """
        conn = VortexConnection(unit_id=unit_id, websocket=websocket,
                                room=room, has_display=has_display)
        async with self._lock:
            existing = self._connections.get(unit_id)
            self._connections[unit_id] = conn
        if existing is not None:
            logger.info("Vortex unit %s reconnected; closing stale socket.", unit_id)
            try:
                await existing.websocket.close()
            except Exception:
                pass
        logger.info("Vortex unit %s connected (room=%s, display=%s).",
                    unit_id, room, has_display)
        return conn

    async def unregister(self, unit_id: str, websocket: Any = None) -> None:
        """Detach a unit, ignoring a stale socket that has already been replaced."""
        async with self._lock:
            conn = self._connections.get(unit_id)
            if conn is None:
                return
            if websocket is not None and conn.websocket is not websocket:
                return  # A newer connection owns this unit id now.
            self._connections.pop(unit_id, None)
        task = self._speaking_tasks.pop(unit_id, None)
        if task is not None:
            task.cancel()
        logger.info("Vortex unit %s disconnected.", unit_id)

    def is_connected(self, unit_id: str) -> bool:
        return unit_id in self._connections

    def connection(self, unit_id: str) -> Optional[VortexConnection]:
        return self._connections.get(unit_id)

    def connected_units(self) -> List[str]:
        return list(self._connections)

    def units_in_room(self, room: str) -> List[str]:
        """Connected unit ids in a room, matched case- and separator-insensitively."""
        target = _normalise_room(room)
        return [
            uid for uid, c in self._connections.items()
            if c.room and _normalise_room(c.room) == target
        ]

    # -- sending ----------------------------------------------------------

    async def send(self, unit_id: str, message_type: str,
                   payload: Optional[Dict[str, Any]] = None) -> bool:
        """Send one frame to one unit. Returns False if it did not land."""
        conn = self._connections.get(unit_id)
        if conn is None:
            return False
        frame = {"type": message_type, **(payload or {})}
        try:
            await conn.websocket.send_json(frame)
            return True
        except Exception as exc:
            logger.info("Vortex send to %s failed (%s); dropping connection.",
                        unit_id, exc)
            await self.unregister(unit_id, conn.websocket)
            return False

    async def send_many(self, unit_ids: Iterable[str], message_type: str,
                        payload: Optional[Dict[str, Any]] = None) -> int:
        """Send the same frame to several units. Returns the delivered count."""
        results = await asyncio.gather(
            *(self.send(uid, message_type, payload) for uid in unit_ids),
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    async def broadcast(self, message_type: str,
                        payload: Optional[Dict[str, Any]] = None) -> int:
        """Send to every connected unit."""
        return await self.send_many(list(self._connections), message_type, payload)

    async def send_to_room(self, room: str, message_type: str,
                           payload: Optional[Dict[str, Any]] = None) -> int:
        return await self.send_many(self.units_in_room(room), message_type, payload)

    # -- presence ---------------------------------------------------------

    async def presence(self, unit_id: str, state: str, *,
                       amplitude: float = 0.0,
                       mood: Optional[str] = None,
                       caption: Optional[str] = None) -> bool:
        """
        Push an orb presence update.

        Args:
            state: One of PRESENCE_STATES. Anything else is refused — the
                renderer's vocabulary is the contract, and a typo here would
                freeze the orb rather than error visibly.
            amplitude: 0..1 envelope value for the current instant.
            mood: Optional palette hint the orb understands.
            caption: Optional short line rendered under the orb.
        """
        if state not in PRESENCE_STATES:
            logger.error(
                "Refusing to send unknown presence state '%s' to %s. Valid: %s",
                state, unit_id, sorted(PRESENCE_STATES),
            )
            return False
        conn = self._connections.get(unit_id)
        if conn is not None:
            conn.state = state
        return await self.send(unit_id, "presence", {
            "state": state,
            "amplitude": round(max(0.0, min(1.0, float(amplitude))), 4),
            "mood": mood,
            "caption": caption,
        })

    async def presence_all(self, state: str, **kwargs: Any) -> int:
        results = await asyncio.gather(
            *(self.presence(uid, state, **kwargs) for uid in list(self._connections)),
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    # -- speech + amplitude ----------------------------------------------

    async def speak(self, unit_id: str, wav_bytes: bytes, *,
                    text: str = "", push_audio: bool = True) -> bool:
        """
        Send a TTS response to a unit and drive its orb for the duration.

        The unit plays an opaque audio blob and cannot measure it meaningfully,
        so the envelope is derived here — from the same synthesis, at the same
        moment — and streamed as `amplitude` frames while it plays.

        Args:
            wav_bytes: WAV audio from the TTS provider.
            text: The spoken text, sent alongside for captioning.
            push_audio: False when the unit already fetched the audio over
                HTTP (POST /api/vortex/tts) and only needs the envelope.
        """
        if not wav_bytes:
            return False
        if push_audio:
            ok = await self.send(unit_id, "audio", {
                "audio": base64.b64encode(wav_bytes).decode("ascii"),
                "format": "wav",
                "text": text,
            })
            if not ok:
                return False
        self.start_amplitude_stream(unit_id, wav_bytes, caption=text)
        return True

    def start_amplitude_stream(self, unit_id: str, wav_bytes: bytes,
                               caption: str = "") -> None:
        """
        Begin streaming the envelope of `wav_bytes` to a unit, in the background.

        Cancels any stream already running for that unit: River interrupting
        herself should replace the old envelope, not interleave with it.
        """
        envelope = amplitude_envelope(wav_bytes)
        if not envelope:
            return
        previous = self._speaking_tasks.get(unit_id)
        if previous is not None:
            previous.cancel()
        task = asyncio.create_task(
            self._run_amplitude_stream(unit_id, envelope, caption))
        self._speaking_tasks[unit_id] = task

    async def _run_amplitude_stream(self, unit_id: str, envelope: Sequence[float],
                                    caption: str) -> None:
        """Emit one amplitude frame per envelope sample, paced to real time."""
        try:
            await self.presence(unit_id, "speaking", amplitude=envelope[0],
                                caption=caption[:180] or None)
            started = time.monotonic()
            for index, value in enumerate(envelope):
                target = started + (index * _AMPLITUDE_PERIOD)
                delay = target - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                elif index and delay < -_AMPLITUDE_PERIOD:
                    continue  # Fell behind: drop the frame rather than lag.
                if not await self.send(unit_id, "amplitude", {"value": value}):
                    return
            await self.presence(unit_id, "idle", amplitude=0.0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Amplitude stream for %s failed: %s", unit_id, exc)
        finally:
            self._speaking_tasks.pop(unit_id, None)

    def is_speaking(self, unit_id: str) -> bool:
        """True while an amplitude stream is running for this unit."""
        return unit_id in self._speaking_tasks

    async def stop_amplitude_stream(self, unit_id: str) -> None:
        task = self._speaking_tasks.pop(unit_id, None)
        if task is not None:
            task.cancel()

    async def reset(self) -> None:
        """Drop all state. Test helper."""
        for task in list(self._speaking_tasks.values()):
            task.cancel()
        self._speaking_tasks.clear()
        self._connections.clear()


# ---------------------------------------------------------------------------
# Envelope extraction
# ---------------------------------------------------------------------------

def amplitude_envelope(wav_bytes: bytes,
                       rate_hz: float = AMPLITUDE_HZ) -> List[float]:
    """
    Reduce WAV audio to a list of 0..1 loudness values at `rate_hz`.

    Peak-based rather than RMS: the orb is tracking the shape of speech, and
    peak tracks consonant attack in a way that reads as "talking" where RMS
    reads as a slow swell. Values are normalised against the loudest window so
    a quiet sentence still animates.

    Returns an empty list for silence or audio this cannot parse — callers
    treat that as "no envelope available" and simply do not animate.
    """
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            framerate = wav.getframerate()
            frames = wav.readframes(wav.getnframes())
    except Exception as exc:
        logger.debug("Could not parse WAV for envelope: %s", exc)
        return []

    if width != 2 or not frames or framerate <= 0:
        # Piper and Kokoro both emit 16-bit PCM. Anything else is unexpected
        # enough that guessing at the sample format would be worse than not
        # animating at all.
        if width != 2:
            logger.debug("Envelope skipped: unsupported sample width %d.", width)
        return []

    samples_per_window = max(1, int(framerate / rate_hz))
    bytes_per_frame = width * channels
    total_frames = len(frames) // bytes_per_frame
    if total_frames <= 0:
        return []

    # Decimate within each window: an orb does not need every sample, and this
    # keeps a ten-second response to a few thousand int conversions.
    stride = max(1, samples_per_window // 32)

    peaks: List[float] = []
    for start in range(0, total_frames, samples_per_window):
        end = min(start + samples_per_window, total_frames)
        peak = 0
        for frame_index in range(start, end, stride):
            offset = frame_index * bytes_per_frame
            value = int.from_bytes(frames[offset:offset + 2], "little", signed=True)
            magnitude = -value if value < 0 else value
            if magnitude > peak:
                peak = magnitude
        peaks.append(peak / 32768.0)

    loudest = max(peaks, default=0.0)
    if loudest <= 0.001:
        return []

    # Normalise, then apply a mild curve: raw peak amplitude looks flat on a
    # renderer that maps it straight to radius.
    return [round(min(1.0, (p / loudest) ** 0.7), 4) for p in peaks]


def _normalise_room(room: str) -> str:
    return (room or "").strip().lower().replace("_", " ").replace("-", " ")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_hub: Optional[VortexHub] = None


def get_vortex_hub() -> VortexHub:
    """Return the shared VortexHub."""
    global _hub
    if _hub is None:
        _hub = VortexHub()
    return _hub
