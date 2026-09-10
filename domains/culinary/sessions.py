"""
core/cooking_sessions.py

The state behind "we are on step 3".

`cook_now` scales a recipe, returns the steps and forgets them. A cooking
session is what makes that a thing you can walk away from: household-scoped so
the kitchen Vortex, a phone and the browser all show the same step, and
persisted so a Pi rebooting mid-recipe does not lose your place.

This module holds the logic; `api/routes/culinary_sessions.py` is the HTTP
surface and `core/intent_router` routes the voice commands. Both go through
here so "next" over the microphone and "Next" tapped on a wall panel do
exactly the same thing.

THE STEP SHAPE
--------------
Each step carries its index, the total, the instruction, the ingredients for
*that step only*, and any timer the step implies.

The canonical field is **`instruction`**. `text` is emitted alongside it as a
tolerated alias because the device reads one of the two, and a mismatch here
leaves River silent on every step of a recipe — which on a screenless unit is
the entire feature.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Words that are never a useful ingredient match on their own. Without this,
# "water" and "oil" attach themselves to most steps in most recipes and the
# per-step ingredient list stops meaning anything.
_INGREDIENT_STOPWORDS = frozenset({
    "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with",
    "fresh", "chopped", "diced", "sliced", "minced", "ground", "large",
    "small", "medium", "extra", "virgin", "plain", "whole", "raw", "dried",
})

# "for 10 minutes", "bake 25 mins", "simmer for 1 hour", "rest 90 seconds"
_DURATION_PATTERN = re.compile(
    r"(?:for\s+)?(\d+(?:\.\d+)?)\s*"
    r"(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs)\b",
    re.IGNORECASE,
)

_UNIT_SECONDS = {
    "second": 1, "seconds": 1, "sec": 1, "secs": 1,
    "minute": 60, "minutes": 60, "min": 60, "mins": 60,
    "hour": 3600, "hours": 3600, "hr": 3600, "hrs": 3600,
}

# The verb a step leads with makes a better timer label than "Timer".
_TIMER_VERBS = ("bake", "roast", "simmer", "boil", "fry", "sauté", "saute",
                "grill", "steam", "rest", "chill", "marinate", "proof",
                "knead", "cool", "reduce", "braise", "broil", "toast")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; treat them as the UTC they were."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def safe_json(raw: Optional[str], fallback: Any) -> Any:
    try:
        return json.loads(raw or "")
    except (ValueError, TypeError):
        return fallback


# ---------------------------------------------------------------------------
# Step materialisation
# ---------------------------------------------------------------------------

def normalise_steps(raw_steps: Any) -> List[str]:
    """
    Flatten however a recipe stored its steps into a list of instruction text.

    Ingested recipes hold plain strings; equipment translation and some
    parsers hand back dicts. Both arrive here.
    """
    out: List[str] = []
    for step in raw_steps or []:
        if isinstance(step, str):
            text = step.strip()
        elif isinstance(step, dict):
            text = str(step.get("instruction") or step.get("text")
                       or step.get("step") or "").strip()
        else:
            text = str(step).strip()
        if text:
            out.append(text)
    return out


def ingredients_for_step(instruction: str,
                         ingredients: List[Dict[str, Any]]
                         ) -> List[Dict[str, Any]]:
    """
    Pick out the ingredients a step actually mentions.

    A name matches when any of its significant words appears in the
    instruction. This is a heuristic and it is meant to be: recipes do not
    record which ingredient belongs to which step, and being told "300g flour,
    2 eggs" while you are holding the bowl is worth more than being told
    nothing because the mapping could not be proven.

    Over-matching is the safer failure. An extra ingredient on the step card
    is noise; a missing one sends someone back to the top of the recipe.
    """
    haystack = f" {instruction.lower()} "
    matched: List[Dict[str, Any]] = []
    for ingredient in ingredients:
        name = str(ingredient.get("name") or "").lower()
        words = [w for w in re.findall(r"[a-z]+", name)
                 if len(w) > 2 and w not in _INGREDIENT_STOPWORDS]
        if not words:
            continue
        # Match on the singular stem too, so "eggs" in the list finds "egg" in
        # the step and vice versa.
        if any(re.search(rf"\b{re.escape(w)}s?\b", haystack) for w in words):
            matched.append(ingredient)
    return matched


def implied_timer(instruction: str) -> Optional[Dict[str, Any]]:
    """
    Extract the timer a step implies, if it names a duration.

    Returns {label, duration_seconds}, or None. Only a suggestion — nothing is
    started until someone asks for it, because a recipe saying "bake for 25
    minutes" is not the same as a person having put the tray in.
    """
    match = _DURATION_PATTERN.search(instruction or "")
    if not match:
        return None

    try:
        amount = float(match.group(1))
    except ValueError:
        return None
    seconds = int(amount * _UNIT_SECONDS.get(match.group(2).lower(), 60))
    if seconds <= 0 or seconds > 24 * 3600:
        return None

    lowered = (instruction or "").lower()
    label = next((verb.capitalize() for verb in _TIMER_VERBS if verb in lowered),
                 "Timer")
    return {"label": label, "duration_seconds": seconds}


def build_step(index: int, steps: List[str],
               ingredients: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Build the step object every client renders from.

    `instruction` is canonical; `text` mirrors it for the device's tolerated
    alias. Emitting both costs a few bytes and removes an entire class of
    silent failure.
    """
    total = len(steps)
    index = max(0, min(index, total - 1)) if total else 0
    instruction = steps[index] if total else ""
    return {
        "index": index,
        "number": index + 1,
        "total": total,
        "instruction": instruction,
        "text": instruction,
        "ingredients": ingredients_for_step(instruction, ingredients),
        "suggested_timer": implied_timer(instruction),
        "is_first": index == 0,
        "is_last": total == 0 or index >= total - 1,
    }


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def timer_out(timer: Any) -> Dict[str, Any]:
    """
    Serialise a timer, computing what is left from the stored deadline.

    `remaining_seconds` is derived on every read rather than stored. A stored
    countdown needs something running to decrement it, so it loses exactly the
    time a reboot took — which is when you most want it to be right.
    """
    ends_at = _as_utc(timer.ends_at)
    remaining = int((ends_at - _now()).total_seconds())
    expired = remaining <= 0
    return {
        "id": timer.id,
        "label": timer.label,
        "step_index": timer.step_index,
        "duration_seconds": timer.duration_seconds,
        "ends_at": ends_at.isoformat(),
        "remaining_seconds": max(0, remaining),
        "status": "fired" if (expired and timer.status == "running") else timer.status,
    }


def session_out(session: Any, timers: Optional[List[Any]] = None) -> Dict[str, Any]:
    """The full session payload: where we are, and everything needed to render it."""
    steps = normalise_steps(safe_json(session.steps_json, []))
    ingredients = safe_json(session.ingredients_json, [])
    return {
        "id": session.id,
        "recipe_id": session.recipe_id,
        "recipe_title": session.recipe_title,
        "servings": session.servings_target,
        "scale_factor": round(session.scale_factor or 1.0, 3),
        "equipment": session.equipment,
        "is_active": bool(session.is_active),
        "step": build_step(session.current_step, steps, ingredients),
        "steps_total": len(steps),
        "ingredients": ingredients,
        "timers": [timer_out(t) for t in (timers or [])],
        "started_at": session.created_at.isoformat() if session.created_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
    }


# ---------------------------------------------------------------------------
# Step movement
# ---------------------------------------------------------------------------

def resolve_step_index(action: str, current: int, total: int,
                       requested: Optional[int] = None) -> Tuple[int, Optional[str]]:
    """
    Work out which step an action lands on.

    Returns (index, complaint). `complaint` is a spoken-safe message when the
    move could not happen — already at the first step, past the last one — so
    a voice caller says something useful instead of silently not moving.
    """
    if total <= 0:
        return 0, "This recipe doesn't have any steps."

    action = (action or "").lower()
    if action == "next":
        if current >= total - 1:
            return current, "That was the last step."
        return current + 1, None
    if action in ("back", "previous", "prev"):
        if current <= 0:
            return 0, "We're on the first step."
        return current - 1, None
    if action == "goto":
        if requested is None:
            return current, "Which step?"
        index = int(requested)
        if index < 0 or index >= total:
            return current, f"There are only {total} steps."
        return index, None
    if action == "repeat":
        return current, None
    return current, f"I don't know how to '{action}' a step."


def start_deadline(seconds: int) -> datetime:
    """The wall-clock instant a timer of `seconds` ends."""
    return _now() + timedelta(seconds=max(1, int(seconds)))


def expired_timers(timers: List[Any]) -> List[Any]:
    """Running timers whose deadline has passed."""
    now = _now()
    return [t for t in timers
            if t.status == "running" and _as_utc(t.ends_at) <= now]


# ---------------------------------------------------------------------------
# Speech
# ---------------------------------------------------------------------------

def speak_step(step: Dict[str, Any], *, with_ingredients: bool = False) -> str:
    """
    Read a step aloud.

    On a screenless unit this is the whole feature, so it leads with the step
    number — someone who lost track needs that before they need the words.
    """
    if not step.get("instruction"):
        return "There's nothing on this step."

    parts = [f"Step {step['number']} of {step['total']}.", step["instruction"]]
    if with_ingredients and step.get("ingredients"):
        listed = ", ".join(describe_ingredient(i) for i in step["ingredients"])
        parts.append(f"You'll need {listed}.")
    return " ".join(parts)


def describe_ingredient(ingredient: Dict[str, Any]) -> str:
    """"300 g plain flour" from {qty, unit, name}, with the gaps closed up."""
    return " ".join(
        str(part).strip()
        for part in (ingredient.get("qty"), ingredient.get("unit"),
                     ingredient.get("name"))
        if str(part or "").strip()
    )


def speak_remaining(timers: List[Dict[str, Any]]) -> str:
    """Answer "how long left" across whatever timers are running."""
    running = [t for t in timers if t["status"] == "running"
               and t["remaining_seconds"] > 0]
    if not running:
        return "You don't have any timers running."

    parts = []
    for timer in sorted(running, key=lambda t: t["remaining_seconds"]):
        parts.append(f"{timer['label']}: {humanise(timer['remaining_seconds'])}")
    if len(parts) == 1:
        return f"{parts[0]} left."
    return "; ".join(parts) + "."


def humanise(seconds: int) -> str:
    """Render a duration the way a person would say it."""
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes, remainder = divmod(seconds, 60)
    if minutes < 60:
        if remainder and minutes < 5:
            return (f"{minutes} minute{'s' if minutes != 1 else ''} "
                    f"{remainder} second{'s' if remainder != 1 else ''}")
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours, minutes = divmod(minutes, 60)
    if minutes:
        return (f"{hours} hour{'s' if hours != 1 else ''} "
                f"{minutes} minute{'s' if minutes != 1 else ''}")
    return f"{hours} hour{'s' if hours != 1 else ''}"


def find_ingredient(query: str, ingredients: List[Dict[str, Any]]
                    ) -> Optional[Dict[str, Any]]:
    """
    Resolve "how much flour" to the scaled ingredient line.

    Prefers the longest matching name so "brown sugar" beats "sugar" when both
    are in the recipe.
    """
    query = re.sub(r"[^a-z ]", "", (query or "").lower()).strip()
    if not query:
        return None

    best: Optional[Dict[str, Any]] = None
    best_length = 0
    for ingredient in ingredients:
        name = str(ingredient.get("name") or "").lower()
        if not name:
            continue
        if name in query or query in name:
            if len(name) > best_length:
                best, best_length = ingredient, len(name)
    return best


def speak_ingredient(ingredient: Dict[str, Any]) -> str:
    quantity = " ".join(
        str(part) for part in (ingredient.get("qty"), ingredient.get("unit"))
        if part
    ).strip()
    name = ingredient.get("name", "that")
    if not quantity:
        return f"The recipe doesn't give a quantity for {name}."
    return f"{quantity} of {name}."
