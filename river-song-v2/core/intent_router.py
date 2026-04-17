# =============================================================================
# core/intent_router.py
#
# Two-stage intent routing for River Song AI.
#
# Stage 1 -- Keyword/phrase scoring:
#   Each registered intent has a set of trigger phrases and keywords.
#   The transcript is checked for exact phrase matches (high confidence) and
#   individual keyword matches (lower confidence). The highest-scoring intent
#   above INTENT_CONFIDENCE_THRESHOLD is selected.
#
# Stage 2 -- Google provider dispatch:
#   The winning intent is routed to its handler, which calls the appropriate
#   Google provider and returns a (intent_name, spoken_response) tuple.
#   An empty spoken_response signals the caller to use the Ollama path instead.
#
# Confidence scoring:
#   - Exact phrase match: 0.9 confidence (strong signal)
#   - Keyword fraction:   (matching_keywords / total_keywords) * 0.8
#   - Final confidence:   max(phrase_score, keyword_score)
#   - Threshold:          INTENT_CONFIDENCE_THRESHOLD (default 0.7 from .env)
#
# Adding a new intent:
#   1. Add an entry to INTENT_REGISTRY with phrases, keywords, and a handler.
#   2. Write the handler function: async def _handle_<name>(transcript, user_id)
#      -> str. Return a spoken response string.
#   3. No other code changes needed -- the router picks it up automatically.
# =============================================================================

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

from config.settings import get_settings


logger = logging.getLogger(__name__)

# Handler type: async (transcript, user_id) -> spoken_response
HandlerFn = Callable[[str, str], Coroutine[Any, Any, str]]


# =============================================================================
# Intent definition
# =============================================================================

@dataclass
class Intent:
    """
    A single registered intent with its matching signals and handler.

    Attributes:
        name: Unique identifier used in log messages and event payloads.
        phrases: List of trigger phrases. Any phrase match scores 0.9.
        keywords: Individual trigger words. Fraction matched scores up to 0.8.
        handler: Async callable that executes the intent and returns a spoken
            response string. Receives (transcript, user_id).
    """
    name: str
    phrases: List[str] = field(default_factory=list)
    keywords: List[str] = field(default_factory=list)
    handler: Optional[HandlerFn] = None


# =============================================================================
# Intent handlers
# =============================================================================

async def _handle_calendar(transcript: str, user_id: str) -> str:
    """Fetch upcoming calendar events and return a spoken summary."""
    try:
        from providers.google.calendar import build_calendar_provider
        provider = build_calendar_provider(user_id=user_id)
        events = await provider.get_upcoming_events()
        return provider.format_events_for_speech(events)
    except Exception as exc:
        logger.error("Calendar handler failed: %s", exc)
        return "Sorry, I had trouble accessing your calendar right now."


async def _handle_gmail(transcript: str, user_id: str) -> str:
    """Fetch unread Gmail messages and return a spoken summary."""
    try:
        from providers.google.gmail import build_gmail_provider
        provider = build_gmail_provider(user_id=user_id)
        messages = await provider.get_unread_messages()
        return provider.format_messages_for_speech(messages)
    except Exception as exc:
        logger.error("Gmail handler failed: %s", exc)
        return "Sorry, I had trouble accessing your email right now."


async def _handle_youtube_music(transcript: str, user_id: str) -> str:
    """Search YouTube Music and play the first result."""
    try:
        from providers.google.youtube_music import build_youtube_music_provider

        # Strip leading play/music keywords to get the raw search query.
        query = transcript.lower()
        for prefix in ("play ", "play some ", "music ", "put on ", "queue "):
            if query.startswith(prefix):
                query = transcript[len(prefix):]
                break
        else:
            query = transcript

        provider = build_youtube_music_provider()
        return await provider.play_first_result(query)
    except Exception as exc:
        logger.error("YouTube Music handler failed: %s", exc)
        return "Sorry, I had trouble playing music right now."


async def _handle_maps(transcript: str, user_id: str) -> str:
    """Get directions or location info and return a spoken summary."""
    try:
        from providers.google.maps import build_maps_provider

        provider = build_maps_provider()
        lower = transcript.lower()

        # Try to detect a directions request vs a general location lookup.
        if "to " in lower and any(
            kw in lower for kw in ("directions", "navigate", "how do i get", "take me")
        ):
            # Simple extraction: split on " to " and take the last segment as destination.
            parts = lower.split(" to ", 1)
            destination = transcript[transcript.lower().index(" to ") + 4:]

            # Try to find an "from" clause; otherwise use "current location".
            if " from " in lower:
                origin_raw = lower.split(" from ", 1)[1].split(" to ")[0]
                origin = transcript[transcript.lower().index(" from ") + 6:
                                    transcript.lower().index(" to ")]
            else:
                origin = "current location"

            route = await provider.get_directions(origin, destination)
            if route:
                return provider.format_directions_for_speech(route)
            return f"Sorry, I could not find directions to {destination}."

        # Fall back to a general location info lookup.
        # Strip leading navigation keywords.
        query = transcript
        for prefix in ("where is ", "find ", "locate ", "what is ", "search for "):
            if lower.startswith(prefix):
                query = transcript[len(prefix):]
                break

        return await provider.get_location_info(query)

    except Exception as exc:
        logger.error("Maps handler failed: %s", exc)
        return "Sorry, I had trouble accessing maps right now."


async def _handle_conversation(transcript: str, user_id: str) -> str:
    """
    Fallback handler -- signals the conversation loop to use Ollama.

    Returns an empty string. The conversation loop interprets this as
    "no Google response; proceed with LLM streaming."
    """
    return ""


# =============================================================================
# Intent registry
# =============================================================================

INTENT_REGISTRY: List[Intent] = [
    Intent(
        name="calendar",
        phrases=[
            "what's on my calendar",
            "what do i have today",
            "what do i have tomorrow",
            "show me my schedule",
            "my schedule",
            "upcoming events",
            "what are my events",
            "add an event",
            "create a calendar event",
            "schedule a meeting",
            "remind me",
        ],
        keywords=[
            "calendar",
            "schedule",
            "event",
            "appointment",
            "meeting",
            "remind",
        ],
        handler=_handle_calendar,
    ),
    Intent(
        name="gmail",
        phrases=[
            "check my email",
            "do i have any email",
            "any new messages",
            "read my email",
            "any unread messages",
            "send an email",
            "email to",
            "compose a message",
            "what's in my inbox",
        ],
        keywords=[
            "email",
            "gmail",
            "inbox",
            "message",
            "unread",
            "mail",
            "send",
        ],
        handler=_handle_gmail,
    ),
    Intent(
        name="youtube_music",
        phrases=[
            "play some music",
            "play a song",
            "put on some music",
            "i want to listen to",
            "queue up",
            "shuffle my music",
        ],
        keywords=[
            "play",
            "music",
            "song",
            "album",
            "artist",
            "playlist",
            "queue",
            "listen",
        ],
        handler=_handle_youtube_music,
    ),
    Intent(
        name="maps",
        phrases=[
            "how do i get to",
            "take me to",
            "directions to",
            "navigate to",
            "where is",
            "find directions",
            "what's the address of",
        ],
        keywords=[
            "directions",
            "navigate",
            "maps",
            "route",
            "drive",
            "walk",
            "transit",
            "location",
            "address",
        ],
        handler=_handle_maps,
    ),
    # "conversation" must always be last -- it is the catch-all fallback.
    Intent(
        name="conversation",
        phrases=[],
        keywords=[],
        handler=_handle_conversation,
    ),
]


# =============================================================================
# IntentRouter
# =============================================================================

class IntentRouter:
    """
    Routes a transcript to a Google provider or falls back to Ollama.

    Args:
        confidence_threshold: Minimum score (0.0 - 1.0) to accept a non-fallback
            intent. Loaded from INTENT_CONFIDENCE_THRESHOLD in .env.

    Usage:
        router = IntentRouter()
        intent_name, spoken_response = await router.route(transcript, user_id)
        if intent_name == "conversation":
            # Use Ollama path
        else:
            # Speak spoken_response directly
    """

    def __init__(self, confidence_threshold: Optional[float] = None) -> None:
        if confidence_threshold is None:
            confidence_threshold = get_settings().intent_confidence_threshold
        self._threshold = confidence_threshold
        logger.info(
            "IntentRouter initialized. Threshold: %.2f. Registered intents: %s.",
            self._threshold,
            [i.name for i in INTENT_REGISTRY if i.name != "conversation"],
        )

    async def route(
        self, transcript: str, user_id: str
    ) -> Tuple[str, str]:
        """
        Score a transcript against all intents and dispatch to the winner.

        Args:
            transcript: Raw transcription string from the STT provider.
            user_id: Used by Google provider handlers for OAuth token lookup.

        Returns:
            Tuple of (intent_name, spoken_response).
            - intent_name: Name of the matched intent (e.g. "calendar", "conversation").
            - spoken_response: Text to speak via TTS. Empty string when intent
              is "conversation" -- the caller should use the Ollama path instead.
        """
        if not transcript.strip():
            return "conversation", ""

        best_intent, best_score = self._score(transcript)

        logger.info(
            "Intent routing: transcript='%s...', winner='%s', score=%.2f, threshold=%.2f.",
            transcript[:60],
            best_intent.name,
            best_score,
            self._threshold,
        )

        if best_intent.handler is None:
            return "conversation", ""

        spoken = await best_intent.handler(transcript, user_id)
        return best_intent.name, spoken

    # -------------------------------------------------------------------------
    # Scoring
    # -------------------------------------------------------------------------

    def _score(self, transcript: str) -> Tuple[Intent, float]:
        """
        Score every non-fallback intent and return the best match.

        Falls back to the "conversation" intent if nothing exceeds the threshold.

        Args:
            transcript: Transcript string to score.

        Returns:
            Tuple of (best_intent, best_score).
        """
        lower = transcript.lower()
        best_score = 0.0
        best_intent: Intent = INTENT_REGISTRY[-1]  # Default: conversation fallback

        for intent in INTENT_REGISTRY:
            if intent.name == "conversation":
                continue  # Skip the fallback during scoring

            score = self._compute_score(lower, intent)
            if score > best_score:
                best_score = score
                best_intent = intent

        # If nothing cleared the threshold, route to conversation.
        if best_score < self._threshold:
            return INTENT_REGISTRY[-1], 0.0

        return best_intent, best_score

    @staticmethod
    def _compute_score(lower_transcript: str, intent: Intent) -> float:
        """
        Compute a confidence score for one intent against the transcript.

        Scoring:
          - Phrase match: any exact phrase found in the transcript -> 0.9
          - Keyword match: (matched_count / total_keywords) * 0.8
          - Returns the maximum of the two scores.

        Args:
            lower_transcript: Lowercased transcript string.
            intent: The intent to score.

        Returns:
            Float confidence score in [0.0, 0.9].
        """
        phrase_score = 0.0
        for phrase in intent.phrases:
            if phrase.lower() in lower_transcript:
                phrase_score = 0.9
                break

        keyword_score = 0.0
        if intent.keywords:
            matched = sum(
                1 for kw in intent.keywords if kw.lower() in lower_transcript
            )
            keyword_score = (matched / len(intent.keywords)) * 0.8

        return max(phrase_score, keyword_score)


# =============================================================================
# Module-level singleton
# =============================================================================

_router: Optional[IntentRouter] = None


def get_intent_router() -> IntentRouter:
    """
    Return the module-level IntentRouter singleton.

    Thread-safe for read access. The router is stateless after initialization
    so concurrent calls to route() are safe without locking.

    Returns:
        IntentRouter: Shared singleton instance.
    """
    global _router
    if _router is None:
        _router = IntentRouter()
    return _router
