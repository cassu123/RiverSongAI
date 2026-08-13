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

**Where the answer actually comes from.** Two Instant Pot pressure cookers,
one with an air fry lid, are the case that decides the design: same brand,
near enough the same name, and one is an air fryer while the other is not. A
model asked "what is an Instant Pot" cannot separate them, because what
separates them is not in the name -- it is the AIR CRISP button on the front
of one of them.

So the panel is the specification, and the stations are derived from it by
the table in appliance_modes with no model in the loop. That leaves the model
a much smaller and much safer job: propose the buttons it thinks are on the
machine, for a person to confirm by looking at it. A wrong guess costs a tap.
A profile carrying ``panel_confirmed`` has been read off the appliance by
somebody, and is the only kind that is not a guess at all.

Temperature is kept **per station** for the same reason. One number cannot
describe a Duo Crisp, which pressure cooks at no temperature you set and air
fries at 205°C, and a single ``max_c`` for the appliance would either
wrongly cap one or wrongly permit the other.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from providers.culinary.appliance_limits import HARD_CEILING_C, LIMITS
from providers.culinary.appliance_modes import (
    MODES,
    mode_labels,
    modes_from_panel,
    stations_for_modes,
)

logger = logging.getLogger(__name__)

#: Stations a profile is allowed to claim. Anything outside this cannot be
#: scheduled or checked, so claiming it would produce an appliance the planner
#: silently ignores.
_CLAIMABLE = set(LIMITS) - {"counter"}

_MAX_MODES = 24

_PROMPT = """Identify this kitchen appliance by the controls on its front panel.

Make: {make}
Model: {model}

The buttons are what matter. Two appliances from the same maker with almost
the same name can differ entirely — an Instant Pot Duo and a Duo Crisp are
both "Instant Pot pressure cookers", but only one has an AIR CRISP button, and
that button is the whole difference between them.

So list the buttons and dial positions you believe are printed on THIS model,
using the wording the manufacturer prints. Someone will check your list
against the machine in front of them, so a plausible extra button is worse
than a missing one.

Return ONLY this JSON object, no prose and no markdown:
{{
  "label": "how a person would refer to it",
  "panel": ["the buttons printed on it, e.g. Pressure Cook, Sauté, Air Crisp"],
  "station_max_c": {{"station": 0}},
  "watts": 0,
  "capacity": "e.g. 5.7 L or 6 qt, empty string if unknown",
  "notes": "any quirk that changes cooking times",
  "variants": ["other models in this line whose panels differ, if any"],
  "confident": true
}}

For "station_max_c", give the highest temperature the appliance can be SET to
for each of these that apply: {stations}. Omit any station where you do not
set a temperature (pressure cooking) or do not know.

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


def _station_temps(raw: Any, stations: List[str]) -> Dict[str, int]:
    """A ceiling per station, each capped by its own class.

    Per station because one number cannot describe a machine that pressure
    cooks at no set temperature and air fries at 205°C. Capping each against
    its own ceiling is what stops a generous oven figure from being borrowed
    by the air fryer sharing the same body.
    """
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, int] = {}
    for station, value in raw.items():
        if station not in stations:
            continue
        claimed = _positive_int(value, 600)
        if claimed is None:
            continue
        out[station] = min(claimed, HARD_CEILING_C.get(station, claimed))
    return out


def validate_profile(raw: dict, make: str = "", model: str = "") -> dict:
    """Turn a model's answer into something safe to store and to check against.

    Pure, and separate from the call, because this is where the safety lives:
    every bound the rest of the module trusts comes through here.

    Stations are **derived** from the panel wherever there is one. That is the
    difference between an appliance described and an appliance identified: the
    buttons are a fact about the machine, and the mapping from buttons to
    stations is a table, so nothing between the panel and the schedule is a
    guess. A caller may still hand over stations directly, which is what a
    profile written by hand does.
    """
    panel = [str(p).strip()[:40] for p in (raw.get("panel") or [])
             if str(p).strip()][:_MAX_MODES]
    modes = modes_from_panel(panel)

    if modes:
        stations = stations_for_modes(modes)
    else:
        stations = [s for s in (raw.get("stations") or [])
                    if isinstance(s, str) and s in _CLAIMABLE]
        # Order and uniqueness, so the primary station is stable across saves.
        stations = list(dict.fromkeys(stations))

    station_max_c = _station_temps(raw.get("station_max_c"), stations)

    max_c = _clamp_max_c(stations, _positive_int(raw.get("max_c"), 600))
    if station_max_c and max_c is None:
        # The appliance-wide figure is the hottest thing it does, so an
        # older check that reads only max_c still gets a true answer.
        max_c = max(station_max_c.values())
    min_c = _positive_int(raw.get("min_c"), 300)
    if max_c and min_c and min_c >= max_c:
        min_c = None                    # a range that is not one tells us nothing

    # An unconfident answer keeps its panel and stations -- those are what a
    # person can check by looking at the machine -- and loses its numbers,
    # which are the part that would widen a bound on the strength of a guess.
    confident = bool(raw.get("confident", True))
    if not confident:
        max_c = min_c = None
        station_max_c = {}

    return {
        "label": str(raw.get("label") or f"{make} {model}").strip()[:80],
        "make": make,
        "model": model,
        "panel": panel,
        "modes": modes,
        "mode_labels": mode_labels(modes),
        "stations": stations,
        "station_max_c": station_max_c,
        "max_c": max_c,
        "min_c": min_c,
        "watts": _positive_int(raw.get("watts"), 5000),
        "capacity": str(raw.get("capacity") or "").strip()[:40],
        "notes": str(raw.get("notes") or "").strip()[:400],
        "variants": [str(v).strip()[:60] for v in (raw.get("variants") or [])
                     if str(v).strip()][:6],
        "confident": confident,
        # True only once somebody has read the panel off the appliance. Until
        # then every station here traces back to a guess about the product.
        "panel_confirmed": bool(raw.get("panel_confirmed", False)),
        # Whether a page about this product was found and read, as opposed to
        # recalled. The difference between the two is the whole reason an
        # Instant Ace Nova is not filed as a pressure cooker.
        "sourced": bool(raw.get("sourced", False)),
        # Nothing in a meal plan is scheduled onto a blender. Said plainly so
        # the appliance can still be recorded without looking broken.
        "schedulable": bool(stations),
    }


def confirm_panel(profile: Optional[dict], panel: List[str]) -> dict:
    """Replace the guessed panel with the one somebody read off the machine.

    The only path in this module that produces a profile which is not a guess.
    Stations are re-derived rather than edited, so ticking AIR CRISP is all it
    takes to make the appliance schedulable as an air fryer -- and unticking
    it is all it takes to stop the planner offering a machine that cannot do
    the job.
    """
    base = dict(profile or {})
    base["panel"] = panel
    base["panel_confirmed"] = True
    # Stations came from the old panel and must not survive it.
    base.pop("stations", None)
    return validate_profile(base,
                            make=base.get("make", ""),
                            model=base.get("model", ""))


_SEARCH_QUERY = "{make} {model} specifications manual cooking functions"

#: Long enough to be a product page rather than an error string. The search
#: chain returns prose on failure, and prose about being unable to search is
#: worse than no context at all -- it would be read as evidence.
_MIN_SEARCH_CHARS = 120

_GROUNDED = """Here are web search results about this appliance:

--- SEARCH RESULTS ---
{results}
--- END SEARCH RESULTS ---

Use these results. They describe the actual product. Where they disagree with
what you remember, believe them. Where they do not mention something, leave it
out rather than filling it in.

"""


async def _search_for(make: str, model: str, search=None) -> str:
    """What the web says about this product, or "" if it cannot be reached.

    The whole reason this call exists: "Instant Ace Nova" is a cooking blender
    and "Instant Pot Duo" is a pressure cooker, and a model working from the
    word "Instant" will confidently make the first one into the second. A
    product page settles it; memory does not.
    """
    try:
        if search is None:
            from providers.web.search import build_search_provider
            search = build_search_provider().search
        results = await search(_SEARCH_QUERY.format(make=make, model=model), 5)
    except Exception as exc:
        logger.info("Appliance profile: search unavailable (%s)", exc)
        return ""

    results = (results or "").strip()
    # The provider chain reports its own failure in prose. Passing that along
    # as context would be handing the model a paragraph about search outages
    # and calling it research.
    if len(results) < _MIN_SEARCH_CHARS or "wasn't able to search" in results:
        return ""
    return results[:6000]


async def build_profile(make: str, model: str, call_model=None,
                        search=None) -> Optional[dict]:
    """Look the appliance up, then have the answer read into a profile.

    Search first and memory second, because the failure this is built around
    is a confident wrong answer about a product the model half-recognises.
    Grounding it in a page about the actual machine is what turns "Instant, so
    pressure cooker" into "Ace Nova, so blender that cooks".

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

    found = await _search_for(make, model, search=search)
    if found:
        prompt = _GROUNDED.format(results=found) + prompt

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

    parsed["sourced"] = bool(found)
    profile = validate_profile(parsed, make=make, model=model)

    # An appliance with no schedulable station keeps its profile. A cooking
    # blender is a real machine with a real capacity and a real set of
    # buttons, and throwing all of that away because a meal plan has nothing
    # to schedule onto it would answer "what is this" with silence. It simply
    # never appears as a station, which is already true of it.
    if not profile["stations"]:
        logger.info("Appliance profile: %s %s has no schedulable station",
                    make, model)
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
    labels = profile.get("mode_labels") or mode_labels(profile.get("modes") or [])
    if labels:
        bits.append("panel: " + ", ".join(labels[:8]))
    return " · ".join(bits)


def suggested_panel(profile: Optional[dict]) -> List[Dict[str, Any]]:
    """Every button the catalogue knows, ticked where this profile claims it.

    The checklist a person confirms against the machine. Offering the whole
    catalogue rather than only what was guessed is what lets somebody *add*
    the air fry button the model missed -- which is exactly the case that
    separates two otherwise identical pressure cookers.
    """
    claimed = set(profile.get("modes") or []) if profile else set()
    return [{"key": m.key, "label": m.label, "station": m.station,
             "on": m.key in claimed}
            for m in MODES]
