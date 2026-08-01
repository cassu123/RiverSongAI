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
import logging
from typing import Any, Dict, Optional

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
        final: False for a mid-utterance chunk. Only the final chunk runs a
            turn; partial chunks just keep the orb in its listening state.

    Nothing is returned — responses go out over the unit's WebSocket as
    presence, audio and amplitude frames.
    """
    from core.intent_router import ORIGIN_VORTEX_UNIT, RequestOrigin, origin_scope
    from core.vortex_hub import get_vortex_hub

    hub = get_vortex_hub()

    if not final:
        await hub.presence(unit_id, "listening")
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
