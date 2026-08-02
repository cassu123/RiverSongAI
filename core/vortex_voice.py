"""
core/vortex_voice.py

Voice for River Vortex units: speech in, River's voice out, and the orb
animated by the same synthesis that produced the audio.

Two jobs.

**Utterances.** A unit confirms its wake word locally (openWakeWord, on the
device) and streams the audio that followed. Everything after that — speech
recognition, intent, memory, permission — happens here, through the same
ConversationLoop the browser uses, so a unit gets River rather than a reduced
version of her. The loop is wrapped in a Vortex request origin, which is what
makes the hard deny apply to a spoken "unlock the front door".

**Synthesis.** `core/voice.py` on the device probes for `synthesize_speech`
and falls through to offline espeak-ng when it is absent — which, until this
module existed, was always. That is why every unit in the house has been
answering in a robotic voice rather than River's.

The amplitude stream comes off the same synthesis. The unit plays an opaque
blob and cannot measure it meaningfully; the envelope only exists here, at the
moment the WAV is produced.
"""

from __future__ import annotations

import base64
import io
import logging
import wave
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

# One ConversationLoop per unit. They are expensive to build (STT and TTS
# providers) and carry the conversation history that makes "and the other one"
# work on the second sentence.
_loops: Dict[str, Any] = {}
_loop_lock = LoopLock()

# A single shared TTS provider for one-shot synthesis (POST /api/vortex/tts),
# kept apart from the per-unit loops so a unit asking for speech does not have
# to own a conversation.
_tts_provider: Optional[Any] = None
_tts_lock = LoopLock()

# ---------------------------------------------------------------------------
# Utterance accumulation
# ---------------------------------------------------------------------------
#
# A unit streams one utterance as several `audio_chunk` frames and marks the
# last of them `final`. Anything before the final chunk has to be kept, or the
# whole utterance has to fit in a single frame — which capped speech at about
# four seconds and silently dropped everything longer. "Set a timer for ten
# minutes" fit. "Put milk and eggs on the shopping list and start the oven
# timer" did not.
#
# The bound that matters is the total, not the frame: a unit that never sends
# `final` must not be able to grow this without limit. The device records at
# most 30 seconds, which at 16 kHz mono s16le is 960,000 bytes; the cap sits
# just above that so a normal long command is never the thing that trips it.

AUDIO_BYTES_PER_SECOND = 16_000 * 2  # 16 kHz, mono, s16le
MAX_UTTERANCE_SECONDS = 32
MAX_UTTERANCE_BYTES = AUDIO_BYTES_PER_SECOND * MAX_UTTERANCE_SECONDS


@dataclass
class _Utterance:
    """Audio accumulated for one unit since its last final chunk."""
    chunks: List[bytes] = field(default_factory=list)
    total: int = 0
    # Set when the cap is passed. The utterance is then dropped *whole* rather
    # than transcribed from whatever fitted — half a command acted on is worse
    # than a command that visibly failed.
    overflowed: bool = False


_utterances: Dict[str, _Utterance] = {}
_utterance_lock = LoopLock()


def _pcm_of(chunk: bytes) -> bytes:
    """
    Return the raw PCM inside a chunk, unwrapping a WAV container if present.

    Chunks are raw 16 kHz mono s16le by protocol, but a unit that wraps each
    one in a WAV header would otherwise produce `RIFF…RIFF…` on concatenation,
    which decodes as only the first chunk — the audio would go quietly missing
    rather than fail. Unwrapping here makes the join valid either way.
    """
    if not chunk.startswith(b"RIFF"):
        return chunk
    try:
        with wave.open(io.BytesIO(chunk), "rb") as handle:
            return handle.readframes(handle.getnframes())
    except Exception:
        # Not a WAV this can parse. Passing it through keeps a single-chunk
        # utterance working, which is the case that matters.
        return chunk


async def _accumulate(unit_id: str, audio: bytes) -> bool:
    """
    Hold a non-final chunk. Returns False once the utterance is over the cap.
    """
    async with _utterance_lock:
        pending = _utterances.setdefault(unit_id, _Utterance())
        if pending.overflowed:
            return False
        if pending.total + len(audio) > MAX_UTTERANCE_BYTES:
            pending.overflowed = True
            pending.chunks.clear()  # Release the audio; only the marker matters.
            logger.warning(
                "Vortex unit %s exceeded the %ds utterance limit; dropping it.",
                unit_id, MAX_UTTERANCE_SECONDS,
            )
            return False
        pending.chunks.append(audio)
        pending.total += len(audio)
        return True


async def _take_utterance(unit_id: str, final_chunk: bytes) -> Optional[bytes]:
    """
    Join the buffered chunks with the final one and reset the buffer.

    Returns None when the utterance overflowed and should be discarded. The
    buffer is cleared either way, so a half-spoken command can never prepend
    itself to the next one.
    """
    async with _utterance_lock:
        pending = _utterances.pop(unit_id, None)

    if pending is None or not pending.chunks:
        if pending is not None and pending.overflowed:
            return None
        # Single-frame utterance: hand it over untouched so a WAV container
        # keeps its header and its own sample rate.
        return final_chunk

    if pending.overflowed:
        return None

    joined = b"".join(_pcm_of(c) for c in pending.chunks) + _pcm_of(final_chunk)
    logger.info(
        "Vortex unit %s utterance assembled: %d chunk(s), %d bytes (~%.1fs).",
        unit_id, len(pending.chunks) + 1, len(joined),
        len(joined) / AUDIO_BYTES_PER_SECOND,
    )
    return joined


async def clear_utterance(unit_id: str) -> None:
    """
    Drop whatever a unit had part-spoken.

    Called when its socket closes: the rest of that sentence is never arriving,
    and it must not become the opening of the next one.
    """
    async with _utterance_lock:
        _utterances.pop(unit_id, None)


async def _get_loop(unit_id: str, user_id: str) -> Any:
    from core.conversation_loop import ConversationLoop

    async with _loop_lock:
        loop = _loops.get(unit_id)
        if loop is None:
            loop = ConversationLoop(user_id=user_id)
            await loop.initialize()
            _loops[unit_id] = loop
            logger.info("Vortex voice: conversation loop ready for unit %s.", unit_id)
        return loop


async def release_loop(unit_id: str) -> None:
    """Drop a unit's conversation loop — call when a unit is deleted."""
    async with _loop_lock:
        _loops.pop(unit_id, None)


async def handle_unit_utterance(*, unit_id: str, user_id: str, audio: bytes,
                                final: bool = True) -> None:
    """
    Run one turn of conversation on behalf of a unit.

    Args:
        unit_id: The unit that heard it. Used to target every response.
        user_id: The unit's owner, resolved from the pairing record. Never
            taken from the device.
        audio: 16kHz mono s16le PCM, or a WAV container.
        final: False for a mid-utterance chunk. Non-final chunks are buffered
            and joined onto the final one, so an utterance is bounded by the
            device's own recording limit rather than by the size of a single
            frame.

    Nothing is returned — responses go out over the unit's WebSocket as
    presence, audio and amplitude frames.
    """
    from core.intent_router import ORIGIN_VORTEX_UNIT, RequestOrigin, origin_scope
    from core.vortex_hub import get_vortex_hub

    hub = get_vortex_hub()

    if not final:
        if not await _accumulate(unit_id, audio):
            await hub.presence(unit_id, "error",
                               caption="That was longer than I can listen for")
            return
        await hub.presence(unit_id, "listening")
        return

    audio = await _take_utterance(unit_id, audio)
    if audio is None:
        # Over the cap. Already logged; tell the room rather than going quiet.
        await hub.presence(unit_id, "error",
                           caption="That was longer than I can listen for")
        return
    if not audio:
        await hub.presence(unit_id, "idle")
        return

    from core.vortex_actions import origin_for_unit

    origin = await origin_for_unit(unit_id)
    origin = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id=unit_id,
                           room=origin.room, has_display=origin.has_display)

    try:
        loop = await _get_loop(unit_id, user_id)
    except Exception as exc:
        logger.error("Vortex voice: could not build a loop for %s: %s", unit_id, exc)
        await hub.presence(unit_id, "error", caption="Voice is unavailable")
        return

    async def on_event(event: Dict[str, Any]) -> None:
        await _relay_event(hub, unit_id, event)

    await hub.presence(unit_id, "thinking")
    try:
        with origin_scope(origin):
            await loop.run_once(audio, on_event=on_event)  # type: ignore[arg-type]
    except Exception as exc:
        logger.error("Vortex voice turn failed for %s: %s", unit_id, exc)
        await hub.presence(unit_id, "error", caption="Something went wrong")


async def _relay_event(hub: Any, unit_id: str, event: Dict[str, Any]) -> None:
    """
    Translate a ConversationLoop event into the unit's presence vocabulary.

    The orb's state names are fixed by the renderer; this is the only place
    the loop's richer event set is collapsed onto them.
    """
    kind = event.get("type")

    if kind in ("transcribing", "routing"):
        await hub.presence(unit_id, "thinking")
    elif kind == "transcript":
        text = event.get("text") or ""
        if text:
            await hub.presence(unit_id, "thinking", caption=text[:180])
    elif kind == "tool_call":
        await hub.presence(unit_id, "acting",
                           caption=str(event.get("name") or "")[:80] or None)
    elif kind == "response_complete":
        await hub.presence(unit_id, "speaking",
                           caption=(event.get("text") or "")[:180] or None)
    elif kind == "audio":
        payload = event.get("data") or ""
        fmt = event.get("format", "wav")
        if not payload:
            return
        if fmt != "wav":
            # Only WAV can be measured for the orb. Send the audio anyway —
            # a non-pulsing orb beats a silent unit.
            await hub.send(unit_id, "audio", {"audio": payload, "format": fmt})
            await hub.presence(unit_id, "speaking")
            return
        try:
            wav = base64.b64decode(payload)
        except Exception:
            return
        await hub.speak(unit_id, wav, text=event.get("text") or "")
    elif kind == "error":
        await hub.presence(unit_id, "error",
                           caption=str(event.get("message") or "")[:180] or None)
    elif kind == "idle":
        # The amplitude stream returns the orb to idle when it finishes, so
        # resetting here mid-sentence would stop the pulse early.
        if not hub.is_speaking(unit_id):
            await hub.presence(unit_id, "idle")


# ---------------------------------------------------------------------------
# One-shot synthesis
# ---------------------------------------------------------------------------

async def synthesize_for_unit(text: str) -> bytes:
    """
    Synthesize `text` with the household's active voice and return WAV bytes.

    Uses the same provider resolution as every other voice path in the system,
    so a unit and the browser sound identical. Returns b"" when synthesis is
    unavailable, which the caller surfaces as a 503 rather than pretending.
    """
    text = (text or "").strip()
    if not text:
        return b""

    global _tts_provider
    async with _tts_lock:
        if _tts_provider is None:
            try:
                from core.conversation_loop import _build_tts_provider
                _tts_provider = _build_tts_provider()
            except Exception as exc:
                logger.error("Vortex TTS unavailable: %s", exc)
                return b""

    try:
        return await _tts_provider.synthesize(text)
    except Exception as exc:
        logger.error("Vortex TTS synthesis failed: %s", exc)
        return b""


async def speak_to_unit(unit_id: str, text: str) -> bool:
    """
    Say something to a unit that did not ask — a reminder, a timer, an alert.

    Pushes the audio and drives the orb for its duration. Anything sent to a
    screenless unit has to arrive as speech or it is invisible, so this is the
    delivery path for those.
    """
    wav = await synthesize_for_unit(text)
    if not wav:
        return False
    from core.vortex_hub import get_vortex_hub
    return await get_vortex_hub().speak(unit_id, wav, text=text)
