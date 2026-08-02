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
# Stage 2 -- Provider dispatch:
#   The winning intent is routed to its handler, which calls the appropriate
#   provider and returns a (intent_name, spoken_response) tuple.
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
#
# Registered intents (in priority order):
#   kova_chores   - River Kova chore robot dispatch
#   commerce      - Amazon + Walmart seller inventory/orders (Phase 8)
#   smart_home    - Home Assistant device control (Phase 3)
#   calendar      - Google Calendar (Phase 2)
#   gmail         - Gmail (Phase 2)
#   youtube_music - YouTube Music (Phase 2)
#   audiobook     - Audible library and playback (Phase 6)
#   maps          - Google Maps (Phase 2)
#   weather       - OpenWeatherMap (Phase 5)
#   news          - NewsAPI (Phase 5)
#   stocks        - Alpha Vantage (Phase 5)
#   sports        - TheSportsDB (Phase 5)
#   library       - Libby holds and loans (Phase 6)
#   conversation  - Ollama fallback (always last)
# =============================================================================

from __future__ import annotations

import contextlib
import logging
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, Iterator, List, Optional, Tuple

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
# Request origin
# =============================================================================
#
# Where a request physically came from changes what it is allowed to do. A
# River Vortex unit is a thin client on a kitchen counter: it relays, it never
# decides. Handlers read the origin from a context variable rather than a
# widened signature, so every existing `(transcript, user_id)` handler keeps
# working and any code path — voice, a tapped surface button, a device grid
# toggle — can declare its origin the same way.

ORIGIN_USER = "user"
ORIGIN_VORTEX_UNIT = "vortex_unit"


@dataclass(frozen=True)
class RequestOrigin:
    """
    Provenance of a request reaching the router.

    Attributes:
        kind: ORIGIN_USER for an authenticated session (web, app, server-side
            automation) or ORIGIN_VORTEX_UNIT for anything relayed by a hub.
        unit_id: The relaying unit, when kind is ORIGIN_VORTEX_UNIT.
        room: The unit's room, used to target responses (music, surfaces).
        has_display: Whether the unit can render a confirmation prompt. A
            screenless unit cannot collect a second factor, since invariant 5
            forbids a spoken one.
    """
    kind: str = ORIGIN_USER
    unit_id: Optional[str] = None
    room: Optional[str] = None
    has_display: bool = True

    @property
    def is_unit(self) -> bool:
        return self.kind == ORIGIN_VORTEX_UNIT


_DEFAULT_ORIGIN = RequestOrigin()
_CURRENT_ORIGIN: ContextVar[RequestOrigin] = ContextVar(
    "river_request_origin", default=_DEFAULT_ORIGIN
)


def current_origin() -> RequestOrigin:
    """Return the origin of the request being handled on this task."""
    return _CURRENT_ORIGIN.get()


@contextlib.contextmanager
def origin_scope(origin: Optional[RequestOrigin]) -> Iterator[RequestOrigin]:
    """
    Bind a request origin for the duration of a block.

    Usage:
        with origin_scope(RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id=uid)):
            await router.route(transcript, user_id)
    """
    effective = origin or _DEFAULT_ORIGIN
    token = _CURRENT_ORIGIN.set(effective)
    try:
        yield effective
    finally:
        _CURRENT_ORIGIN.reset(token)


# =============================================================================
# Permission model for device actions
# =============================================================================
#
# Invariant 2 of the River Vortex brief: locks, garage doors and alarm disarm
# are hard-denied to units. Not gated behind a confirmation — refused, because
# the request came from a unit. A Pi stolen from a kitchen must not be able to
# open a door, however convincing the voice or the face in front of it is.

# Whole HA domains a unit may never operate.
UNIT_DENIED_DOMAINS = frozenset({"lock", "alarm_control_panel"})

# Actions denied on any entity that looks like a garage door, whatever its
# domain. Garage doors are `cover.*` in Home Assistant and share that domain
# with blinds and curtains, so the entity has to be inspected by name.
#
# Matched against the *compacted* haystack — every non-alphanumeric character
# stripped — rather than with word boundaries. Word boundaries do not survive
# real entity ids: `\bgarage\b` misses "cover.garage_door" because `_` is a
# word character, and misses "cover.GarageDoor" because there is no separator
# at all. Both of those are a hard deny silently downgraded to a confirmation
# prompt, which is precisely the failure this exists to prevent.
#
# Substring matching errs toward denying. That is the correct direction here:
# refusing to toggle something merely named like a gate is an inconvenience,
# and opening a real one from a stolen Pi is not. "gateway" is excluded
# because a network gateway is a plausible switch and is not a way into the
# house.
_GARAGE_PATTERN = re.compile(r"garage|carport|gate(?!way)", re.IGNORECASE)


def _normalise_target(entity_id: Optional[str], device_name: str) -> str:
    """Flatten an entity id and device name into a space-separated haystack."""
    raw = f"{entity_id or ''} {device_name or ''}"
    return re.sub(r"[._\-]+", " ", raw).lower()


def _compact_target(entity_id: Optional[str], device_name: str) -> str:
    """
    Strip an entity id and device name to letters and digits only.

    "cover.garage_door", "cover.garage-door" and "cover.GarageDoor" all
    collapse to the same haystack, so a naming convention cannot decide
    whether a safety rule applies.
    """
    return re.sub(r"[^a-z0-9]+", "", f"{entity_id or ''}{device_name or ''}".lower())


# Entities that are risky enough to want a second factor, but not a flat
# refusal: anything that opens the house up or heats something.
_MEDIUM_RISK_DOMAINS = frozenset({"cover", "water_heater", "valve"})
_MEDIUM_RISK_PATTERN = re.compile(
    r"\boven\b|\bhob\b|\bstove\b|\bcooker\b|\bheater\b|\bboiler\b|\bfurnace\b"
    r"|\bpump\b|\bsauna\b|\bhot\s*tub\b|\bfront\s*door\b",
    re.IGNORECASE,
)

DECISION_ALLOW = "allow"
DECISION_DENY = "deny"
DECISION_CONFIRM = "confirm"


@dataclass(frozen=True)
class PermissionDecision:
    """
    The router's verdict on one device action.

    Attributes:
        decision: DECISION_ALLOW, DECISION_DENY or DECISION_CONFIRM.
        reason: Machine-readable reason code, for logs and telemetry.
        message: Spoken/displayable explanation. Never blames the user.
    """
    decision: str
    reason: str = ""
    message: str = ""

    @property
    def allowed(self) -> bool:
        return self.decision == DECISION_ALLOW

    @property
    def denied(self) -> bool:
        return self.decision == DECISION_DENY

    @property
    def needs_confirmation(self) -> bool:
        return self.decision == DECISION_CONFIRM


def evaluate_device_request(
    *,
    action: str,
    entity_id: Optional[str] = None,
    device_name: str = "",
    origin: Optional[RequestOrigin] = None,
) -> PermissionDecision:
    """
    Decide whether a device action may proceed, given where it came from.

    This is the single choke point for the Vortex hard deny. Voice commands,
    tapped surface buttons and device-grid toggles all pass through here, so a
    confirm card on a wall panel is a prompt and never an authorisation.

    Args:
        action: Parsed action name, e.g. "unlock", "turn_on", "set_brightness".
        entity_id: Home Assistant entity ID when one has been resolved.
        device_name: Free-text device name, used when no entity is resolved yet.
        origin: Request provenance. Defaults to the ambient context origin.

    Returns:
        PermissionDecision. Callers must not execute on DENY, and must mint a
        pending confirmation on CONFIRM.
    """
    origin = origin or current_origin()
    action = (action or "").lower()
    haystack = _normalise_target(entity_id, device_name)
    compact = _compact_target(entity_id, device_name)
    domain = (entity_id or "").split(".")[0].lower() if entity_id else ""

    # Non-unit requests keep their existing behaviour untouched.
    if not origin.is_unit:
        return PermissionDecision(DECISION_ALLOW)

    is_garage = bool(_GARAGE_PATTERN.search(compact))
    is_lock_domain = domain in UNIT_DENIED_DOMAINS
    mentions_alarm = "alarm" in compact
    # Without a resolved entity, fall back to the verb: "unlock the front door"
    # must be refused before the registry lookup, not after it.
    looks_like_lock = action in ("lock", "unlock") or mentions_alarm
    is_disarm = action in ("disarm", "alarm_disarm") or (
        mentions_alarm and action in ("turn_off", "unlock", "open")
    )

    if is_lock_domain or looks_like_lock or is_garage or is_disarm:
        what = (
            "the garage" if is_garage
            else "the alarm" if is_disarm or mentions_alarm
            else "door locks"
        )
        logger.warning(
            "Vortex hard deny: unit %s requested action '%s' on '%s' "
            "(domain=%s, garage=%s). Locks, garage doors and alarm disarm are "
            "refused at the router for unit-originated requests.",
            origin.unit_id, action, (entity_id or device_name or "?"),
            domain or "?", is_garage,
        )
        return PermissionDecision(
            DECISION_DENY,
            reason="vortex_hard_deny",
            message=(
                f"I can't operate {what} from a room hub. "
                "You'll need to do that from your phone or the web app."
            ),
        )

    if domain in _MEDIUM_RISK_DOMAINS or _MEDIUM_RISK_PATTERN.search(haystack):
        if not origin.has_display:
            logger.info(
                "Vortex deny: unit %s has no display and cannot collect a "
                "second factor for '%s' on '%s'.",
                origin.unit_id, action, entity_id or device_name,
            )
            return PermissionDecision(
                DECISION_DENY,
                reason="second_factor_impossible",
                message=(
                    "That one needs confirming on a screen, and this speaker "
                    "doesn't have one."
                ),
            )
        return PermissionDecision(
            DECISION_CONFIRM,
            reason="medium_risk",
            message="That needs confirming on the screen first.",
        )

    return PermissionDecision(DECISION_ALLOW)


# =============================================================================
# Intent handlers
# =============================================================================

# =============================================================================
# Smart home command parser
# =============================================================================

# Patterns that identify the action. Checked in order -- first match wins.
# Each entry is (action_name, regex_pattern).
_ACTION_PATTERNS: List[tuple] = [
    ("turn_on", r"\bturn\s+on\b"),
    ("turn_off", r"\bturn\s+off\b"),
    ("toggle", r"\btoggle\b"),
    ("dim", r"\bdim\b|\bdarken\b"),
    ("brighten", r"\bbrighten\b|\braise\b|\bbrighter\b"),
    ("lock", r"\block\b"),
    ("unlock", r"\bunlock\b"),
    ("open", r"\bopen\b"),
    ("close", r"\bclose\b"),
    ("activate", r"\bactivate\b|\brun scene\b"),
    ("run", r"\brun script\b"),
]

# Patterns stripped from the transcript to isolate the device name.
_DEVICE_STRIP_PATTERNS: List[str] = [
    r"\bturn\s+(?:on|off)\b",
    r"\bset\b",
    r"\bto\s+\d+\s*(?:percent|%)?",
    r"\b\d+\s*(?:percent|%)\b",
    r"\bdim\b|\bdarken\b",
    r"\bbrighten\b|\braise\b|\bbrighter\b",
    r"\btoggle\b",
    r"\block\b|\bunlock\b",
    r"\bopen\b|\bclose\b",
    r"\bactivate\b|\brun\b",
    r"\bscene\b|\bscript\b",
    r"\bthe\b|\bmy\b|\ba\b|\ban\b|\ball\b",
    r"\bplease\b",
    r"\bcan you\b|\bwould you\b",
    r"\bright now\b|\bfor me\b",
]


def _parse_smart_home_command(transcript: str) -> Dict[str, Any]:
    """
    Parse action, device name, and optional numeric value from a transcript.

    Args:
        transcript: Raw transcription string.

    Returns:
        Dict with keys:
          'action'      - str action name, or None if unrecognized.
          'device_name' - cleaned device name string for registry lookup.
          'value'       - int or None (brightness %, temperature, position).
    """
    lower = transcript.lower()

    # Detect action.
    action: Optional[str] = None
    for action_name, pattern in _ACTION_PATTERNS:
        if re.search(pattern, lower):
            action = action_name
            break

    # Detect numeric value (e.g., "50 percent", "set to 72").
    value: Optional[int] = None
    m = re.search(r"\b(\d+)\s*(?:percent|%|degrees?)?\b", lower)
    if m:
        value = int(m.group(1))

    # If a numeric value is present alongside a directional verb (set/put/turn),
    # override the action so the handler can resolve set_brightness vs set_temperature.
    # Covers: "set to 50%", "turn to 50%", "put at 50%", "lights to 50%".
    if value is not None and re.search(r"\bto\s+\d+", lower):
        # Resolved to set_brightness or set_temperature in handler.
        action = "set_value"

    # Strip action/filler words to isolate the device name.
    device_name = lower
    for pattern in _DEVICE_STRIP_PATTERNS:
        device_name = re.sub(pattern, " ", device_name)
    device_name = " ".join(device_name.split())

    return {"action": action, "device_name": device_name, "value": value}


async def _handle_smart_home(transcript: str, user_id: str) -> str:
    """
    Parse a smart home command and execute it via Home Assistant.
    """
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "home"):
        return "I'm sorry, home automation controls are not enabled for your account."

    try:
        from providers.smart_home.home_assistant import build_ha_client
        from providers.smart_home.device_registry import get_device_registry

        cmd = _parse_smart_home_command(transcript)
        action = cmd["action"]
        device_name = cmd["device_name"]
        value = cmd["value"]

        if not action:
            return (
                "I heard a smart home command but could not determine what action "
                "to take. Try saying 'turn on the living room lights' or "
                "'set the bedroom lights to 50 percent'."
            )

        if not device_name:
            return (
                "I understood the action but could not identify which device. "
                "Try naming the device, like 'turn off the kitchen lights'."
            )

        # Hard deny before resolution: "unlock the front door" is refused on
        # the verb, so a unit never even learns which entity would have moved.
        early = evaluate_device_request(action=action, device_name=device_name)
        if early.denied:
            return early.message

        registry = get_device_registry()
        resolved = await registry.resolve(device_name)

        if resolved is None:
            # Fallback: check if the ContextEngine knows where the user is
            from main import get_app
            app = get_app()
            if app and hasattr(app.state, 'context_engine'):
                ctx = app.state.context_engine
                rooms = ctx.get_rooms()
                # Find the single active room if there is exactly one
                active_rooms = [name for name, r in rooms.items() if r.get('activity') == 'active']
                if len(active_rooms) == 1:
                    implied_name = f"{active_rooms[0].replace('_', ' ')} {device_name}"
                    resolved = await registry.resolve(implied_name)
                    if resolved:
                        device_name = implied_name
            
        if resolved is None:
            return (
                f"I could not find a device called '{device_name}' in your registry. "
                "Check that it is listed in your device_registry.json file."
            )

        # Resolve "set_value" to a domain-specific action.
        if action == "set_value":
            entity_list = resolved if isinstance(
                resolved, list) else [resolved]
            domain = entity_list[0].split(".")[0]
            action = "set_temperature" if domain == "climate" else "set_brightness"

        # Re-check now that the entity is known. Resolution can turn a benign
        # phrase into a lock ("open the side door" → lock.side_door), so the
        # decision is taken again against the real entity.
        for entity in (resolved if isinstance(resolved, list) else [resolved]):
            decision = evaluate_device_request(
                action=action, entity_id=entity, device_name=device_name)
            if decision.denied:
                return decision.message
            if decision.needs_confirmation:
                return await _request_unit_confirmation(
                    user_id=user_id,
                    action=action,
                    entity_ids=(resolved if isinstance(resolved, list)
                                else [resolved]),
                    device_name=device_name,
                    value=value,
                    message=decision.message,
                )

        async with build_ha_client() as client:
            if isinstance(resolved, list):
                ok = await client.execute_action_on_many(resolved, action, value)
                friendly_name = device_name
            else:
                ok = await client.execute_action(resolved, action, value)
                friendly_name = device_name

        if not ok:
            return (
                f"I tried to {action.replace('_', ' ')} the {friendly_name} "
                "but Home Assistant reported an error. Check your HA logs."
            )

        return _build_confirmation(action, friendly_name, value)

    except FileNotFoundError as exc:
        logger.error("Smart home handler -- device registry missing: %s", exc)
        return (
            "Your device registry file is missing. "
            "Copy device_registry.example.json to device_registry.json "
            "and fill in your entity IDs."
        )
    except Exception as exc:
        logger.error("Smart home handler failed: %s", exc)
        return "Sorry, I had trouble controlling that device right now."


async def _request_unit_confirmation(
    *,
    user_id: str,
    action: str,
    entity_ids: List[str],
    device_name: str,
    value: Optional[int],
    message: str,
) -> str:
    """
    Park a medium-risk action behind a second factor entered on the unit.

    Mints a pending confirmation holding everything needed to run the action
    later, then pushes a `confirm` surface to the unit that heard the request.
    Nothing is executed here — the action runs only if
    `core.vortex_actions.resolve_confirmation` is later handed a valid factor
    against this challenge id.
    """
    from core.vortex_security import confirmations

    origin = current_origin()
    label = action.replace("_", " ")
    description = f"{label} the {device_name}".strip()

    pending = await confirmations.create(
        user_id=user_id,
        unit_id=origin.unit_id,
        action="home_action",
        description=description,
        payload={
            "entity_ids": list(entity_ids),
            "action": action,
            "value": value,
            "device_name": device_name,
        },
    )

    try:
        from core.vortex_surfaces import get_surface_publisher

        await get_surface_publisher().publish(
            {
                "id": f"confirm:{pending.challenge_id}",
                "kind": "confirm",
                "priority": "high",
                "title": f"Confirm: {description}",
                "body": "Enter your code on this screen to continue.",
                "icon": "🔒",
                "ttl_seconds": 120,
                "speech": message,
                "challenge_id": pending.challenge_id,
                "actions": [
                    {"label": "Confirm", "intent": f"confirm:{pending.challenge_id}",
                     "style": "primary"},
                    {"label": "Cancel", "intent": f"cancel:{pending.challenge_id}",
                     "style": "secondary"},
                ],
            },
            unit_ids=[origin.unit_id] if origin.unit_id else None,
        )
    except Exception as exc:  # pragma: no cover - surface push is best effort
        logger.error("Could not push confirmation surface: %s", exc)

    return message


def _build_confirmation(action: str, device_name: str,
                        value: Optional[int]) -> str:
    """Build a natural-sounding spoken confirmation for a completed action."""
    if action == "turn_on":
        return f"Turning on the {device_name}."
    if action == "turn_off":
        return f"Turning off the {device_name}."
    if action == "toggle":
        return f"Toggling the {device_name}."
    if action == "set_brightness":
        return f"Setting the {device_name} to {value} percent."
    if action == "set_temperature":
        return f"Setting the thermostat to {value} degrees."
    if action == "dim":
        return f"Dimming the {device_name}."
    if action == "brighten":
        return f"Brightening the {device_name}."
    if action == "lock":
        return f"Locking the {device_name}."
    if action == "unlock":
        return f"Unlocking the {device_name}."
    if action == "open":
        return f"Opening the {device_name}."
    if action == "close":
        return f"Closing the {device_name}."
    if action == "activate":
        return f"Activating {device_name}."
    if action == "run":
        return f"Running {device_name}."
    return f"Done -- {action.replace('_', ' ')} the {device_name}."


# =============================================================================
# Kova chore robot dispatch
# =============================================================================

# Both maps mirror TaskManager.submit_from_voice() in river-kova
# tasks/task_manager.py so a command parses the same on either side.
_KOVA_CHORE_KEYWORDS: Dict[str, str] = {
    "vacuum": "VACUUM",
    "mop": "MOP",
    "clean": "VACUUM",
    "fetch": "FETCH",
    "get": "FETCH",
    "bring": "FETCH",
    "organize": "ORGANIZE",
    "organise": "ORGANIZE",
    "tidy": "ORGANIZE",
    "wipe": "WIPE_SURFACE",
    "trash": "TAKE_OUT_TRASH",
    "rubbish": "TAKE_OUT_TRASH",
    "dishwasher": "LOAD_DISHWASHER",
    "dishes": "LOAD_DISHWASHER",
    "laundry": "LAUNDRY_TRANSFER",
}

_KOVA_ROOM_KEYWORDS: List[str] = [
    "kitchen", "living room", "bedroom", "bathroom",
    "hallway", "dining room", "office", "garage",
]

_KOVA_CHORE_LABELS: Dict[str, str] = {
    "VACUUM": "vacuum",
    "MOP": "mop",
    "FETCH": "run a fetch errand",
    "ORGANIZE": "tidy up",
    "WIPE_SURFACE": "wipe the surfaces",
    "TAKE_OUT_TRASH": "take out the trash",
    "LOAD_DISHWASHER": "load the dishwasher",
    "UNLOAD_DISHWASHER": "unload the dishwasher",
    "LAUNDRY_TRANSFER": "move the laundry over",
}


def _parse_kova_chore(transcript: str) -> Dict[str, Optional[str]]:
    """Parse chore type and room from a Kova voice command."""
    lower = transcript.lower()
    chore_type = None
    for keyword, ctype in _KOVA_CHORE_KEYWORDS.items():
        if keyword in lower:
            chore_type = ctype
            break
    room = None
    for r in _KOVA_ROOM_KEYWORDS:
        if r in lower:
            room = r.replace(" ", "_")
            break
    return {"chore_type": chore_type, "room": room}


async def _handle_kova_chore(transcript: str, user_id: str) -> str:
    """
    Dispatch a chore to a River Kova unit's task queue.

    The unit picks the task up on its next GET /api/kova/units/{id}/tasks
    poll. Voice tasks queue at priority 7, matching the robot's own
    submit_from_voice() behavior.
    """
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "home"):
        return "I'm sorry, home automation controls are not enabled for your account."

    try:
        from api.routes.kova import dispatch_chore

        parsed = _parse_kova_chore(transcript)
        chore_type = parsed["chore_type"]
        room = parsed["room"]

        if not chore_type:
            return (
                "I heard a Kova request but couldn't match it to a chore. "
                "Try something like 'have Kova vacuum the living room'."
            )

        task_id, unit = await dispatch_chore(
            chore_type, room, priority=7,
            source="voice", requested_by=user_id)
        if not task_id or not unit:
            return (
                "No Kova units are registered yet. "
                "Claim one in settings and it will appear once it connects."
            )

        chore_label = _KOVA_CHORE_LABELS.get(chore_type, chore_type.lower())
        unit_label = unit.get("name") or unit.get("robot_id")
        where = f" in the {room.replace('_', ' ')}" if room else ""
        if unit.get("online"):
            return f"On it — sending {unit_label} to {chore_label}{where}."
        return (
            f"Queued — {unit_label} will {chore_label}{where} "
            "as soon as it comes back online."
        )

    except Exception as exc:
        logger.error("Kova chore handler failed: %s", exc)
        return "Sorry, I had trouble reaching the Kova fleet right now."


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


# =============================================================================
# Casting and intercom
# =============================================================================

# "cast <what> to <where>", "put <what> on the <where>"
_CAST_PATTERN = re.compile(
    r"^(?:cast|put|show|stream)\s+(?P<what>.+?)\s+(?:to|on|onto)\s+"
    r"(?:the\s+)?(?P<where>[\w\s]+?)\s*$",
    re.IGNORECASE,
)
_STOP_CAST_PATTERN = re.compile(
    r"\bstop\s+(?:the\s+)?cast(?:ing)?(?:\s+(?:to|on)\s+(?:the\s+)?"
    r"(?P<where>[\w\s]+?))?\s*$",
    re.IGNORECASE,
)

# "call the kitchen", "intercom the bedroom", "video call the living room"
_CALL_PATTERN = re.compile(
    r"^(?:(?P<video>video\s+)?call|intercom|ring|talk to)\s+"
    r"(?:the\s+)?(?P<where>[\w\s]+?)\s*$",
    re.IGNORECASE,
)


async def _handle_cast(transcript: str, user_id: str) -> str:
    """Cast something to a TV, speaker or hub."""
    lowered = (transcript or "").strip()

    stop = _STOP_CAST_PATTERN.search(lowered)
    if stop:
        from core.vortex_cast import resolve_target, stop as stop_cast

        where = (stop.group("where") or "").strip()
        if not where:
            return "Which screen should I stop?"
        target = await resolve_target(where, user_id)
        if target is None:
            return f"I couldn't find anything called the {where}."
        result = await stop_cast(user_id=user_id, target=target)
        return result.get("message") or "Done."

    match = _CAST_PATTERN.match(lowered)
    if not match:
        return ""

    from core.vortex_cast import cast_from_voice

    _, spoken = await cast_from_voice(
        user_id=user_id,
        query=match.group("what").strip(),
        target_name=match.group("where").strip(),
    )
    return spoken


async def _handle_intercom(transcript: str, user_id: str) -> str:
    """
    Start an intercom or video call to another room.

    Only meaningful from a unit — "call the kitchen" from a browser has no
    near end to connect. Returns "" otherwise so the LLM handles it, which
    also keeps "call Mum" out of the room intercom.
    """
    origin = current_origin()
    if not origin.is_unit or not origin.unit_id:
        return ""

    match = _CALL_PATTERN.match((transcript or "").strip())
    if not match:
        return ""

    where = match.group("where").strip()
    mode = "video" if match.group("video") else "audio"

    from core.vortex_calls import (
        get_call_registry, ice_servers, negotiate_mode, participant_id,
    )
    from core.vortex_units import list_profiles, normalise_room

    caller = participant_id(unit_id=origin.unit_id)
    wanted = normalise_room(where)
    callee = None
    for profile in await list_profiles(user_id):
        if normalise_room(profile.get("room", "")) == wanted:
            callee = participant_id(unit_id=profile["unit_id"])
            break
    if callee is None:
        return f"I don't have a hub in the {where}."
    if callee == caller:
        return "That's this room."

    resolved_mode, note = await negotiate_mode(mode, caller, callee)
    call, error = await get_call_registry().start(
        caller=caller, callee=callee, owner_user_id=user_id,
        mode=resolved_mode, ice_servers=ice_servers(),
    )
    if call is None:
        return error

    try:
        from api.routes.vortex import _ring_surface
        await _ring_surface(callee, caller, call.id, resolved_mode)
    except Exception as exc:
        logger.debug("Could not raise the ringing card: %s", exc)

    spoken = f"Calling the {where}."
    return f"{spoken} {note}" if note else spoken


# =============================================================================
# Cooking sessions
# =============================================================================

# Order matters: "how long left" must be tested before "how much", and
# "next" before anything that merely contains it.
_COOKING_PATTERNS: List[tuple] = [
    ("how_long", r"how (?:long|much time)(?:\s+(?:is|has|do i have))?\s*"
                 r"(?:left|to go|remaining)|how long on the timer"),
    ("timer", r"\b(?:set|start)\s+(?:a\s+)?timer\s*(?:for\s+)?(.*)"),
    ("how_much", r"how (?:much|many)\s+(.*?)(?:\s+do i need|\s+is it|\?|$)"),
    ("next", r"\bnext step\b|\bnext\b|\bcontinue\b|\bgo on\b|\bwhat's next\b"),
    ("back", r"\b(?:previous|last) step\b|\bgo back\b|\bback a step\b"),
    ("repeat", r"\brepeat\b|\bsay that again\b|\bread that again\b"
               r"|\bwhat(?:'s| is) the step\b|\bwhere (?:are|was) we\b"),
]

# "10 minutes", "an hour and a half", "90 seconds"
_SPOKEN_DURATION = re.compile(
    r"(\d+(?:\.\d+)?)\s*(second|seconds|sec|secs|minute|minutes|min|mins"
    r"|hour|hours|hr|hrs)",
    re.IGNORECASE,
)
_DURATION_UNITS = {
    "second": 1, "seconds": 1, "sec": 1, "secs": 1,
    "minute": 60, "minutes": 60, "min": 60, "mins": 60,
    "hour": 3600, "hours": 3600, "hr": 3600, "hrs": 3600,
}


def parse_spoken_duration(text: str) -> int:
    """
    Total seconds from a spoken duration, summing every part it names.

    "an hour and a half" is not handled — it has no digits — and returns 0,
    which the caller turns into "how long should I set it for?" rather than
    guessing at a number someone is going to cook by.
    """
    total = 0
    for amount, unit in _SPOKEN_DURATION.findall(text or ""):
        try:
            total += int(float(amount) * _DURATION_UNITS[unit.lower()])
        except (ValueError, KeyError):
            continue
    return total


def parse_cooking_command(transcript: str) -> Optional[Tuple[str, str]]:
    """
    Map a transcript to a (command, argument) pair, or None.

    Returns None for anything that is not a cooking command, so the caller can
    fall through to the LLM instead of answering a question nobody asked.
    """
    lowered = (transcript or "").lower().strip()
    for command, pattern in _COOKING_PATTERNS:
        match = re.search(pattern, lowered)
        if not match:
            continue
        argument = ""
        if match.groups():
            argument = (match.group(1) or "").strip()
        if command == "timer":
            return command, str(parse_spoken_duration(argument or lowered))
        return command, argument
    return None


async def _handle_cooking(transcript: str, user_id: str) -> str:
    """
    Handle a cooking command while a session is active.

    Returns "" when there is no active session or the transcript is not
    actually a cooking command — an empty response tells the caller to use the
    LLM path, so "how much do I owe you" does not get answered out of a
    recipe.
    """
    parsed = parse_cooking_command(transcript)
    if parsed is None:
        return ""

    command, argument = parsed
    try:
        from api.routes.culinary_sessions import voice_command

        spoken = await voice_command(user_id, command, argument)
    except Exception as exc:
        logger.error("Cooking intent failed: %s", exc)
        return ""

    # None means nobody is cooking; hand the transcript back to the LLM.
    return spoken or ""


async def _handle_youtube_music(transcript: str, user_id: str) -> str:
    """
    Search YouTube Music and play the first result.

    A request relayed by a River Vortex unit is resolved to a stream URL and
    handed to that unit, so music asked for in the kitchen comes out of the
    kitchen. Everything else keeps playing on this box as before.
    """
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

        if current_origin().is_unit:
            from core.vortex_media import handle_play_request

            spoken = await handle_play_request(
                transcript=transcript, user_id=user_id, query=query)
            if spoken is not None:
                return spoken

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
            destination = transcript[transcript.lower().index(" to ") + 4:]

            if " from " in lower:
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
        for prefix in ("where is ", "find ", "locate ",
                       "what is ", "search for "):
            if lower.startswith(prefix):
                query = transcript[len(prefix):]
                break

        return await provider.get_location_info(query)

    except Exception as exc:
        logger.error("Maps handler failed: %s", exc)
        return "Sorry, I had trouble accessing maps right now."


async def _handle_weather(transcript: str, user_id: str) -> str:
    """Fetch weather for the detected location and day, return a spoken summary."""
    try:
        from providers.feeds.weather import (  # type: ignore
            build_weather_provider,
            extract_location_from_transcript,
            extract_day_from_transcript,
        )
        from config.settings import get_settings

        provider = build_weather_provider()  # type: ignore
        location = extract_location_from_transcript(
            transcript, get_settings().default_location)
        day = extract_day_from_transcript(transcript)

        if day or any(kw in transcript.lower()
                      for kw in ("forecast", "weekend", "this week", "week")):
            periods = await provider.get_forecast(location=location, day_name=day)
            return provider.format_forecast_for_speech(periods, day_name=day)
        else:
            current = await provider.get_current(location=location)
            return provider.format_current_for_speech(current)

    except Exception as exc:
        logger.error("Weather handler failed: %s", exc)
        return "Sorry, I had trouble fetching the weather right now."


async def _handle_news(transcript: str, user_id: str) -> str:
    """Fetch news headlines or a topic search, return a spoken summary."""
    try:
        from providers.feeds.news import (  # type: ignore
            build_news_provider,
            extract_category_from_transcript,
            extract_topic_from_transcript,
        )

        provider = build_news_provider()  # type: ignore
        topic = extract_topic_from_transcript(transcript)
        category = extract_category_from_transcript(transcript)

        if topic:
            articles = await provider.search_news(topic)
            return provider.format_for_speech(articles, query=topic)
        else:
            articles = await provider.get_headlines(category=category)
            return provider.format_for_speech(articles, category=category)

    except Exception as exc:
        logger.error("News handler failed: %s", exc)
        return "Sorry, I had trouble fetching the news right now."


async def _handle_stocks(transcript: str, user_id: str) -> str:
    """Fetch a stock quote for the detected ticker, return a spoken summary."""
    try:
        from providers.feeds.stocks import (  # type: ignore
            build_stocks_provider,
            extract_ticker_from_transcript,
        )

        provider = build_stocks_provider()  # type: ignore
        ticker = extract_ticker_from_transcript(transcript)

        if not ticker:
            return (
                "I heard a stock query but could not identify which company or ticker. "
                "Try saying the company name, like 'what's Tesla at'."
            )

        quote = await provider.get_quote(ticker)
        return provider.format_for_speech(ticker, quote)

    except ValueError as exc:
        return str(exc)
    except Exception as exc:
        logger.error("Stocks handler failed: %s", exc)
        return "Sorry, I had trouble fetching that stock quote right now."


async def _handle_sports(transcript: str, user_id: str) -> str:
    """Fetch the most recent result for the detected team, return a spoken summary."""
    try:
        from providers.feeds.sports import (  # type: ignore
            build_sports_provider,
            extract_team_from_transcript,
        )

        provider = build_sports_provider()  # type: ignore
        team_name = extract_team_from_transcript(transcript)

        if not team_name:
            return (
                "I heard a sports query but could not identify the team. "
                "Try saying the team name, like 'how did the Cubs do'."
            )

        data = await provider.get_team_results(team_name)
        return provider.format_results_for_speech(
            data, requested_name=team_name)

    except Exception as exc:
        logger.error("Sports handler failed: %s", exc)
        return "Sorry, I had trouble fetching those sports results right now."


async def _handle_commerce(transcript: str, user_id: str) -> str:
    """
    Handle commerce queries: inventory, low stock, and order status.
    """
    from core.family import is_feature_enabled_for
    if not await is_feature_enabled_for(user_id, "commerce"):
        return "I'm sorry, access to commerce data is not enabled for your account."

    try:
        lower = transcript.lower()
        want_walmart = "walmart" in lower
        want_amazon = "amazon" in lower or not want_walmart  # default to Amazon

        want_orders = any(
            kw in lower
            for kw in ("order", "orders", "pending", "ship", "unshipped", "fulfill")
        )

        parts: List[str] = []

        if want_amazon:
            from providers.commerce.amazon import build_amazon_provider
            amazon = build_amazon_provider()

            if want_orders:
                orders = await amazon.get_pending_shipments()
                parts.append(amazon.format_orders_for_speech(orders))
            else:
                items = await amazon.get_low_stock_items()
                parts.append(amazon.format_low_stock_for_speech(items))

        if want_walmart:
            from providers.commerce.walmart import build_walmart_provider
            walmart = build_walmart_provider()

            if want_orders:
                walmart_orders = await walmart.get_orders(status="Created")
                parts.append(walmart.format_orders_for_speech(walmart_orders))
            else:
                walmart_items = await walmart.get_low_stock_items()
                parts.append(
                    walmart.format_low_stock_for_speech(walmart_items))

        return " ".join(parts) if parts else (
            "I heard a commerce query but could not determine what to look up. "
            "Try saying 'what are my low stock items' or 'do I have any pending orders'."
        )

    except Exception as exc:
        logger.error("Commerce handler failed: %s", exc)
        return "Sorry, I had trouble accessing your seller account right now."


async def _handle_audiobook(transcript: str, user_id: str) -> str:
    """
    Handle Audible audiobook queries: resume, library listing, or current-book info.

    Sub-intent detection:
      - "resume", "play", "continue", "left off" -> resume last book
      - "library", "have", "list"                -> list library
      - default                                  -> describe current book
    """
    try:
        from providers.reading.audible import build_audible_provider
        provider = build_audible_provider()
        lower = transcript.lower()

        if any(kw in lower for kw in ("resume", "continue", "left off", "play")):
            return await provider.resume(user_id)

        if any(kw in lower for kw in ("library", "have", "list", "all my")):
            books = await provider.get_library(user_id, limit=20)
            return provider.format_library_for_speech(books)

        # Default: describe the current book.
        book = await provider.get_last_listened(user_id)
        if book is None:
            return "I did not find any audiobooks in your Audible library."
        return provider.format_book_for_speech(book)

    except FileNotFoundError as exc:
        return str(exc)
    except Exception as exc:
        logger.error("Audiobook handler failed for '%s': %s", user_id, exc)
        return "Sorry, I had trouble accessing your Audible library right now."


async def _handle_library(transcript: str, user_id: str) -> str:
    """
    Handle Libby/OverDrive queries: loans (borrowed books) or holds queue.

    Sub-intent detection:
      - "loan", "borrowed", "due", "borrow" -> get_loans
      - default (hold, wait, queue)          -> get_holds
    """
    try:
        from providers.reading.libby import build_libby_provider
        provider = build_libby_provider()
        lower = transcript.lower()

        if any(kw in lower for kw in (
                "loan", "borrowed", "borrow", "due", "checked out")):
            loans = await provider.get_loans(user_id)
            return provider.format_loans_for_speech(loans)

        # Default: holds queue.
        holds = await provider.get_holds(user_id)
        return provider.format_holds_for_speech(holds)

    except FileNotFoundError as exc:
        return str(exc)
    except PermissionError as exc:
        return str(exc)
    except Exception as exc:
        logger.error("Library handler failed for '%s': %s", user_id, exc)
        return "Sorry, I had trouble accessing your Libby account right now."


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
    # Cooking goes first: while a session is live, "next" means the next step
    # and nothing else. The handler returns "" when nobody is cooking, which
    # hands the transcript straight back to the LLM — so these phrases cost
    # nothing the rest of the time.
    Intent(
        name="cooking",
        phrases=[
            "next step",
            "previous step",
            "go back a step",
            "last step",
            "repeat that",
            "say that again",
            "read that again",
            "what's the step",
            "what is the step",
            "how much",
            "how many",
            "set a timer",
            "start a timer",
            "how long left",
            "how long is left",
            "how much time",
            "how long on the timer",
        ],
        keywords=[],
        handler=_handle_cooking,
    ),
    # Intercom before casting: "call the living room" and "cast to the living
    # room" both name a room, and only one of them is a call.
    Intent(
        name="intercom",
        phrases=[
            "call the",
            "video call the",
            "intercom the",
            "intercom",
            "ring the",
            "talk to the",
        ],
        keywords=[],
        handler=_handle_intercom,
    ),
    Intent(
        name="cast",
        phrases=[
            "cast ",
            "stop casting",
            "stop the cast",
            "put it on the",
            "show it on the",
            "stream it to",
        ],
        keywords=[],
        handler=_handle_cast,
    ),
    Intent(
        name="kova_chores",
        phrases=[
            "have kova",
            "tell kova",
            "ask kova",
            "send kova",
            "get kova",
            "kova vacuum",
            "kova mop",
            "kova clean",
            "kova fetch",
            "kova tidy",
            "vacuum the",
            "mop the",
            "tidy up the",
        ],
        keywords=[
            "kova",
        ],
        handler=_handle_kova_chore,
    ),
    Intent(
        name="commerce",
        phrases=[
            "what are my low stock items",
            "what's running low",
            "low stock alert",
            "check my inventory",
            "my amazon inventory",
            "my walmart inventory",
            "what's out of stock",
            "do i have any pending orders",
            "my pending orders",
            "check my orders",
            "how many orders do i have",
            "orders to ship",
            "what needs to be shipped",
        ],
        keywords=[
            "inventory",
            "low stock",
            "out of stock",
            "restock",
            "sku",
            "listing",
            "fba",
            "fulfillment",
            "seller",
            "marketplace",
            "pending orders",
            "unshipped",
        ],
        handler=_handle_commerce,
    ),
    Intent(
        name="smart_home",
        phrases=[
            "turn on the",
            "turn off the",
            "turn on all",
            "turn off all",
            "turn the lights",
            "turn the living room",
            "turn the kitchen",
            "turn the bedroom",
            "turn the office",
            "dim the",
            "brighten the",
            "set the lights to",
            "set the thermostat to",
            "lights to",
            "light to",
            "lock the",
            "unlock the",
            "open the garage",
            "close the garage",
            "open the blinds",
            "close the blinds",
            "toggle the",
            "activate scene",
            "run script",
        ],
        keywords=[
            "lights",
            "light",
            "lamp",
            "fan",
            "thermostat",
            "lock",
            "unlock",
            "garage",
            "blinds",
            "shades",
            "switch",
            "dim",
            "brighten",
            "scene",
            "script",
            "turn on",
            "turn off",
        ],
        handler=_handle_smart_home,
    ),
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
        name="audiobook",
        phrases=[
            "resume my audiobook",
            "play my audiobook",
            "continue my audiobook",
            "continue listening",
            "play where i left off",
            "pick up where i left off",
            "what am i listening to",
            "my current audiobook",
            "what audiobooks do i have",
            "my audible library",
            "list my audiobooks",
            "what book am i on",
        ],
        keywords=[
            "audiobook",
            "audible",
            "narrator",
            "resume listening",
            "listening to",
        ],
        handler=_handle_audiobook,
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
    Intent(
        name="deep_research",
        phrases=[
            "research in depth",
            "deep dive",
            "comprehensive report",
            "in-depth research",
            "research this thoroughly",
        ],
        keywords=[
            "research",
            "investigate",
            "deep dive",
            "report",
        ],
        handler=None,  # Let conversation loop handle LLM turn to use deep_research tool
    ),
    Intent(
        name="document_qa",
        phrases=[
            "according to the manual",
            "what does the manual say",
            "what does the guide say",
            "how do i maintain",
            "specs for",
            "technical details for",
            "operating instructions",
        ],
        keywords=[
            "manual",
            "guide",
            "instructions",
            "specs",
            "specifications",
            "maintenance",
        ],
        handler=None,  # Let conversation loop handle LLM turn
    ),
    Intent(
        name="weather",
        phrases=[
            "what's the weather",
            "what is the weather",
            "how's the weather",
            "weather today",
            "weather tomorrow",
            "weather this weekend",
            "weather this week",
            "weather forecast",
            "what will it be like",
            "will it rain",
            "will it snow",
            "how cold",
            "how hot",
            "do i need an umbrella",
            "should i bring a jacket",
        ],
        keywords=[
            "weather",
            "forecast",
            "temperature",
            "rain",
            "snow",
            "sunny",
            "cloudy",
            "humid",
            "wind",
            "storm",
            "umbrella",
            "jacket",
        ],
        handler=_handle_weather,
    ),
    Intent(
        name="news",
        phrases=[
            "what's in the news",
            "what is in the news",
            "latest news",
            "top headlines",
            "what happened today",
            "what's going on in the world",
            "any news",
            "tell me the news",
            "morning briefing",
            "news update",
            "news about",
            "what happened with",
        ],
        keywords=[
            "news",
            "headlines",
            "briefing",
            "stories",
            "report",
            "happening",
            "update",
        ],
        handler=_handle_news,
    ),
    Intent(
        name="stocks",
        phrases=[
            "what's tesla at",
            "what is apple at",
            "stock price",
            "stock quote",
            "how is the market",
            "how are stocks",
            "check the stock",
            "look up the stock",
            "what's the market doing",
        ],
        keywords=[
            "stock",
            "stocks",
            "share",
            "shares",
            "market",
            "ticker",
            "trading",
            "price",
            "nasdaq",
            "dow",
            "s&p",
        ],
        handler=_handle_stocks,
    ),
    Intent(
        name="sports",
        phrases=[
            "how did the",
            "did the cubs",
            "did the bears",
            "did the bulls",
            "did the sox",
            "did the lakers",
            "did the patriots",
            "what was the score",
            "did they win",
            "how did they do",
            "last night's game",
            "sports score",
            "game result",
        ],
        keywords=[
            "game",
            "score",
            "win",
            "won",
            "lost",
            "loss",
            "beat",
            "defeated",
            "match",
            "inning",
            "quarter",
            "period",
            "touchdown",
            "home run",
            "playoffs",
        ],
        handler=_handle_sports,
    ),
    Intent(
        name="library",
        phrases=[
            "my library holds",
            "check my holds",
            "what's on hold",
            "how long is my hold",
            "my library loans",
            "check my loans",
            "what do i have borrowed",
            "what's checked out",
            "when is my book due",
            "what's due at the library",
            "libby holds",
            "libby loans",
        ],
        keywords=[
            "holds",
            "loans",
            "libby",
            "overdrive",
            "library card",
            "borrowed",
            "checked out",
            "due",
            "wait list",
            "waitlist",
        ],
        handler=_handle_library,
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
        self, transcript: str, user_id: str,
        origin: Optional[RequestOrigin] = None,
    ) -> Tuple[str, str]:
        """
        Score a transcript against all intents and dispatch to the winner.

        Args:
            transcript: Raw transcription string from the STT provider.
            user_id: Used by Google provider handlers for OAuth token lookup.
                Always resolved by this server — never accepted from a device.
            origin: Where the request came from. A River Vortex unit gets the
                restricted permission set described in evaluate_device_request;
                omitting this keeps the default full-trust user origin.

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
            "Intent routing: transcript='%s...', winner='%s', score=%.2f, "
            "threshold=%.2f, origin=%s.",
            transcript[:60],
            best_intent.name,
            best_score,
            self._threshold,
            (origin or current_origin()).kind,
        )

        if best_intent.handler is None:
            return "conversation", ""

        with origin_scope(origin or current_origin()):
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
        # Default: conversation fallback
        best_intent: Intent = INTENT_REGISTRY[-1]

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
