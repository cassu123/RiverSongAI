"""
core/identity.py

Who is River Song talking to?

Voice is the first way to answer that, but it will not be the only one --
a camera can answer it too, and so can a phone on the network. Rather than
teaching the conversation loop about microphones specifically, every source
reports the same thing: a signal saying "I think this is <user>, and here is
how sure I am".

Adding face recognition later means writing one more function that returns
an IdentitySignal. Nothing downstream changes.

Enrollment works like Google's Voice Match: the user reads a short script of
fixed phrases, each one becomes a sample, and the samples together form
their voice print. ENROLLMENT_PHRASES is that script.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enrollment script
# ---------------------------------------------------------------------------
#
# Phrases are deliberately varied rather than the wake word repeated. A voice
# print built from one phrase recognises that phrase more than it recognises
# the person; spreading vowels, consonants and sentence rhythm across a few
# lines generalises to ordinary speech.
#
# Each is long enough to give the encoder a usable sample -- roughly three
# seconds read at a normal pace -- without feeling like a chore.
# ---------------------------------------------------------------------------
ENROLLMENT_PHRASES: List[str] = [
    "Hey River, it's me. Remember my voice.",
    "The weather today looks clear, with a chance of rain by evening.",
    "Turn off the kitchen lights and lock the back door.",
    "I usually finish work around six on weekdays.",
    "Thanks — that's exactly what I needed to know.",
]

# Below this many samples a voice print is treated as incomplete. Fewer than
# three and the encoder has not seen enough variation to tell similar voices
# apart -- household members frequently sound alike.
MIN_ENROLLMENT_SAMPLES: int = 3


@dataclass(frozen=True)
class IdentitySignal:
    """
    One source's opinion about who is present.

    source:     "voice" | "face" | "session" | anything added later
    user_id:    None when the source looked but recognised nobody
    confidence: 0.0-1.0, comparable across sources only in the loose sense
                that higher means surer
    runner_up:  the next best candidate, when the source can report one.
                A high score that is barely ahead of the runner-up means two
                people sound (or look) alike, which is worth knowing.
    """
    source: str
    user_id: Optional[str]
    confidence: float
    runner_up_user_id: Optional[str] = None
    runner_up_confidence: Optional[float] = None
    at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc))

    @property
    def recognised(self) -> bool:
        return self.user_id is not None

    @property
    def margin(self) -> Optional[float]:
        """
        Gap between the best and second-best candidate.

        A small margin means the sources disagree about which of two similar
        people this is -- a better reason to fall back to the default user
        than raw confidence alone.
        """
        if self.runner_up_confidence is None:
            return None
        return self.confidence - self.runner_up_confidence


# Sources are ranked when they disagree. Face beats voice because a camera
# seeing someone is harder to fool than a microphone hearing them -- a voice
# carries through a doorway from the next room, a face does not. Session is
# lowest: it is who logged in, which may be a shared tablet on a counter.
_SOURCE_PRIORITY: Dict[str, int] = {
    "face": 0,
    "voice": 1,
    "session": 2,
}

# How far apart best and runner-up must be to trust the match. Two household
# members with similar voices routinely both score above the raw threshold;
# the margin is what separates them.
DEFAULT_MIN_MARGIN: float = 0.05


def _priority(source: str) -> int:
    return _SOURCE_PRIORITY.get(source, len(_SOURCE_PRIORITY))


def resolve(
    signals: List[IdentitySignal],
    min_margin: float = DEFAULT_MIN_MARGIN,
) -> Optional[IdentitySignal]:
    """
    Pick the best identity from everything that reported.

    Args:
        signals: Whatever the sources produced this turn, in any order.
        min_margin: Reject a match whose lead over the runner-up is smaller
            than this. Set to 0 to accept on confidence alone.

    Returns:
        The winning signal, or None when nothing was recognised confidently.
        None means "treat this as the default user" -- never guess, because
        guessing wrong attaches one person's conversation to another's
        memory, which is worse than not personalising at all.

    Resolution order: recognised signals first, then source priority (face
    over voice over session), then confidence. A confident voice never
    overrides a face that also recognised someone.
    """
    recognised = [s for s in signals if s.recognised]
    if not recognised:
        return None

    trusted = []
    for signal in recognised:
        margin = signal.margin
        if margin is not None and margin < min_margin:
            logger.info(
                "Identity from %s rejected: %s beat %s by only %.3f "
                "(need %.3f) — treating as unknown.",
                signal.source, signal.user_id, signal.runner_up_user_id,
                margin, min_margin,
            )
            continue
        trusted.append(signal)

    if not trusted:
        return None

    trusted.sort(key=lambda s: (_priority(s.source), -s.confidence))
    return trusted[0]


async def identify_by_voice(
    wav_bytes: bytes,
    threshold: Optional[float] = None,
) -> IdentitySignal:
    """
    Ask the voice-print provider who spoke.

    Returns an unrecognised signal rather than raising on any failure --
    Resemblyzer missing, no enrollments yet, a corrupt clip. Not knowing who
    spoke is a normal state that must not break the turn.
    """
    unknown = IdentitySignal(source="voice", user_id=None, confidence=0.0)

    if not wav_bytes:
        return unknown

    try:
        from config.settings import get_settings
        from providers.voice_id.voice_id_provider import VoiceIDProvider

        if threshold is None:
            threshold = float(getattr(get_settings(), "voice_id_threshold", 0.75) or 0.75)

        result = await _get_voice_provider(VoiceIDProvider).identify(
            wav_bytes, threshold=threshold)
    except Exception as exc:
        logger.warning("Voice identification unavailable: %s", exc)
        return unknown

    if not result:
        return unknown

    return IdentitySignal(
        source="voice",
        user_id=result.get("user_id"),
        confidence=float(result.get("score") or 0.0),
        runner_up_user_id=result.get("runner_up_user_id"),
        runner_up_confidence=(
            float(result["runner_up_score"])
            if result.get("runner_up_score") is not None else None
        ),
    )


# Resemblyzer loads a model and caches every enrolled embedding, so the
# provider is built once rather than per turn.
_voice_provider = None


def _get_voice_provider(factory):
    global _voice_provider
    if _voice_provider is None:
        _voice_provider = factory()
    return _voice_provider


async def identify_speaker(
    wav_bytes: bytes,
    session_user_id: Optional[str] = None,
) -> Optional[str]:
    """
    Convenience wrapper for the conversation loop: returns a user id or None.

    Gathers what the available sources know, resolves them, and hands back
    the winner. `session_user_id` is included as a low-priority signal so a
    logged-in session still identifies someone when voice cannot -- but any
    recognised voice or face outranks it, which is what makes a shared hub
    device work for a household.

    Face recognition slots in here as one more signal when it exists.
    """
    signals = [await identify_by_voice(wav_bytes)]

    if session_user_id:
        signals.append(IdentitySignal(
            source="session", user_id=session_user_id, confidence=0.5))

    try:
        from config.settings import get_settings
        min_margin = float(
            getattr(get_settings(), "voice_id_min_margin", DEFAULT_MIN_MARGIN))
    except Exception:
        min_margin = DEFAULT_MIN_MARGIN

    winner = resolve(signals, min_margin=min_margin)
    if winner is None:
        return None

    logger.info(
        "Speaker identified as %s via %s (confidence %.3f).",
        winner.user_id, winner.source, winner.confidence,
    )
    return winner.user_id
