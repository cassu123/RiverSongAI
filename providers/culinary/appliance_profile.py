"""
providers/culinary/appliance_profile.py — type the name, get the machine

"I have an Instant Dutch Oven" breaks the assumption underneath everything
else here, which was that an appliance is one station. It is not: it sears,
braises, slow cooks and air fries, and a plan that files it under "dutch_oven"
will never offer the three other things it does. An "Instant indoor smokeless
grill" breaks a different one -- checked against outdoor-grill limits it would
accept 350°C, which it does not reach.

So a profile is built when the appliance is entered, and it answers four
questions the rest of the module cannot answer for itself:

  * **which stations it is** -- more than one, usually, and that is what makes
    it offerable as a swap target for each of them;
  * **what it reaches** -- the ceiling that the impossible-instruction check
    is run against, instead of a generic figure for the class;
  * **what its modes are called** -- so a rewrite says "Sauté" and "Pressure
    Cook, High" rather than inventing names that are not on the dial;
  * **what it needs said** -- a pressure appliance carries the thermometer
    note whatever else it does.

The model is guessing from a product name, and the guess is treated as a
guess. Everything it returns is validated against the physical bounds of the
class it claims to be, and the asymmetry from appliance_limits holds
throughout: a profile may make a check **stricter** freely and may only make
one **looser** up to a hard ceiling. A machine the model half-recognises must
not be able to widen the walls that exist to catch it.

The failure mode is deliberately mild. No profile means the generic class
limits apply and the swap still works -- slightly less specific, exactly as
correct.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from providers.culinary.appliance_limits import HARD_CEILING_C, LIMITS

logger = logging.getLogger(__name__)

#: Stations a profile is allowed to claim. Anything outside this cannot be
#: scheduled or checked, so claiming it would produce an appliance the planner
#: silently ignores.
_CLAIMABLE = set(LIMITS) - {"counter"}

_MAX_MODES = 12

_PROMPT = """Identify this kitchen appliance and describe what it can do.

Make: {make}
Model: {model}

Answer only about this appliance. Many machines do several jobs — an Instant
Dutch Oven sears, slow cooks, pressure cooks and air fries; an indoor grill
also griddles. List every one it genuinely does.

Return ONLY this JSON object, no prose and no markdown:
{{
  "label": "how a person would refer to it",
  "stations": ["which of: {stations}"],
  "max_c": 0,
  "min_c": 0,
  "watts": 0,
  "capacity": "e.g. 5.7 L or 6 qt, empty string if unknown",
  "modes": ["the names printed on the dial or panel"],
  "notes": "one or two sentences on what it is good at and any quirk that changes cooking times",
  "confident": true
}}

If you do not actually recognise this make and model, set "confident" to false
and give only what is certain from the name. A guessed specification is worse
than none: it will be used to decide whether an instruction is safe.
"""


def _extract_object(raw: str) -> Optional[dict]:
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(.+?)```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _positive_int(value: Any, ceiling: int) -> Optional[int]:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return number if 0 < number <= ceiling else None


def _clamp_max_c(stations: List[str], claimed: Optional[int]) -> Optional[int]:
    """A claimed maximum, capped by the hottest class the appliance claims.

    Capped rather than rejected: an Instant Dutch Oven that says 230°C is
    telling the truth and should be used. One that says 500°C is a model
    filling in a blank, and the cap turns a dangerous number into a merely
    unhelpful one.
    """
    if claimed is None:
        return None
    ceilings = [HARD_CEILING_C[s] for s in stations if s in HARD_CEILING_C]
    if not ceilings:
        return claimed
    return min(claimed, max(ceilings))


def validate_profile(raw: dict, make: str = "", model: str = "") -> dict:
    """Turn a model's answer into something safe to store and to check against.

    Pure, and separate from the call, because this is where the safety lives:
    every bound the rest of the module trusts comes through here.
    """
    stations = [s for s in (raw.get("stations") or [])
                if isinstance(s, str) and s in _CLAIMABLE]
    # Order and uniqueness, so the primary station is stable across saves.
    stations = list(dict.fromkeys(stations))

    modes = [str(m).strip()[:40] for m in (raw.get("modes") or [])
             if str(m).strip()][:_MAX_MODES]

    max_c = _clamp_max_c(stations, _positive_int(raw.get("max_c"), 600))
    min_c = _positive_int(raw.get("min_c"), 300)
    if max_c and min_c and min_c >= max_c:
        min_c = None                    # a range that is not one tells us nothing

    # An unconfident answer keeps its stations -- those are checkable against
    # the name -- and loses its numbers, which are the part that would widen a
    # bound on the strength of a guess.
    confident = bool(raw.get("confident", True))
    if not confident:
        max_c = min_c = None

    return {
        "label": str(raw.get("label") or f"{make} {model}").strip()[:80],
        "make": make,
        "model": model,
        "stations": stations,
        "max_c": max_c,
        "min_c": min_c,
        "watts": _positive_int(raw.get("watts"), 5000),
        "capacity": str(raw.get("capacity") or "").strip()[:40],
        "modes": modes,
        "notes": str(raw.get("notes") or "").strip()[:400],
        "confident": confident,
    }


async def build_profile(make: str, model: str, call_model=None) -> Optional[dict]:
    """Ask what this appliance is, and validate the answer before believing it.

    Returns None when there is no usable answer. That is a mild failure by
    design: without a profile the generic class limits apply and the swap
    still works, slightly less specific and exactly as correct.
    """
    make, model = (make or "").strip(), (model or "").strip()
    if not make and not model:
        return None

    prompt = _PROMPT.format(
        make=make or "(unknown)", model=model or "(unknown)",
        stations=", ".join(sorted(_CLAIMABLE)),
    )

    try:
        if call_model is None:
            from providers.culinary.llm import _call_ollama
            call_model = _call_ollama
        reply = await call_model(prompt)
    except Exception as exc:
        logger.info("Appliance profile: model unavailable (%s)", exc)
        return None

    parsed = _extract_object(reply)
    if not parsed:
        logger.info("Appliance profile: no JSON object in reply")
        return None

    profile = validate_profile(parsed, make=make, model=model)
    if not profile["stations"]:
        # Nothing the planner can do with an appliance it cannot place.
        logger.info("Appliance profile: no recognisable stations for %s %s",
                    make, model)
        return None
    return profile


def profile_summary(profile: Optional[dict]) -> str:
    """A line a person can check at a glance.

    Worth showing precisely because the profile is a guess: the cook is the
    only one who can look at "reaches 230°C, Sauté / Pressure Cook / Air Fry"
    and know whether that is their machine.
    """
    if not profile:
        return ""
    bits: List[str] = []
    if profile.get("stations"):
        bits.append(", ".join(
            LIMITS[s].label for s in profile["stations"] if s in LIMITS))
    if profile.get("max_c"):
        bits.append(f"up to {profile['max_c']}°C")
    if profile.get("capacity"):
        bits.append(profile["capacity"])
    if profile.get("watts"):
        bits.append(f"{profile['watts']}W")
    if profile.get("modes"):
        bits.append("modes: " + ", ".join(profile["modes"][:6]))
    return " · ".join(bits)
