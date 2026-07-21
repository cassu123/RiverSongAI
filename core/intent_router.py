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

import logging
import re
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
