"""
providers/culinary/step_analysis.py — reading a recipe step properly

cook_plan.analyse_step works out what a step costs by looking for words in it.
That got a plan off the ground, and every failure since has been fixed by
adding another word: "per side" doubles, "then" adds, "every" does not count,
"plate" is a noun unless followed by "the". Each of those is correct and none
of them generalise. The next recipe phrases something a way nobody listed and
it is wrong again, silently, in a number the cook has no way to check.

So the keyword pass is the floor and this is the ceiling: a model reads the
instruction and says what it actually involves. The division matters --

  * the model produces **facts about a step**: how long, which appliance,
    whether it holds the cook, whether it happens before the heat;
  * the scheduler stays deterministic and consumes those facts.

Nothing about the timeline, the contention or the ordering is asked of a
model. Those are arithmetic, they are tested, and they should not vary
between two runs of the same plan.

Three properties this has to have, in order:

  1. **It is never required.** Every field falls back to the keyword answer,
     per field, not per step. A model that returns half a row improves half a
     row. A model that is not running changes nothing at all.
  2. **It is paid once.** Analysis is cached on the recipe and keyed by a hash
     of the steps, so editing a recipe re-analyses it and cooking the same
     meal twice does not.
  3. **It cannot make the plan worse.** Values are clamped to plausible
     ranges and unknown stations are dropped. A model that says a step takes
     nine hours is more likely wrong than the recipe is unusual.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any, Dict, List, Optional

from providers.culinary.cook_plan import (
    IMPLICIT_STATIONS,
    StepFacts,
    analyse_steps,
)

logger = logging.getLogger(__name__)

#: Stations the scheduler knows how to reserve. Anything else is dropped
#: rather than trusted -- an unrecognised station would silently become a
#: resource of capacity one that nothing else ever contends for.
_KNOWN_STATIONS = set(IMPLICIT_STATIONS) | {
    "air_fryer", "instant_pot", "dutch_oven", "sous_vide",
    "slow_cooker", "stand_mixer", "wok", "grill",
}

_PHASES = {"prep", "cook", "finish"}

#: A single step longer than this is a model error, not a recipe. The longest
#: legitimate one is an overnight prove, and those are written as hours in a
#: step of their own -- which this still allows.
_MAX_STEP_MINUTES = 24 * 60

_PROMPT = """You are reading one recipe at a time and working out what each step costs a cook.

For every step, return:
  "i"       the step's index, as given
  "active"  minutes the cook's hands are busy. Include time spent standing at
            the pan. "3-5 minutes per side" is 10, not 5.
  "passive" minutes the food cooks or rests without the cook. Baking,
            simmering, marinating, resting, chilling, proving.
  "station" one of: counter, stove, oven, microwave, air_fryer, instant_pot,
            dutch_oven, sous_vide, slow_cooker, stand_mixer, wok, grill.
            Use "counter" for anything needing no heat or appliance.
  "phase"   "prep" before any heat (chopping, measuring, dredging, marinating),
            "cook" applying heat, "finish" plating and garnishing.

Rules that matter:
- A step can be both: "sear for 2 minutes then bake 40" is active 2, passive 40.
- Time given as a range takes the upper bound.
- "stirring every 5 minutes" is how often, not how long. It adds no time.
- A step with no stated time still costs something. Estimate it honestly.
- Judge by what the step does, not by words it happens to contain: "place the
  flour on a plate" is prep, not plating up.

Return ONLY a JSON array, one object per step, no prose and no markdown.

STEPS:
{steps}
"""


def steps_fingerprint(steps: List[str]) -> str:
    """Identity of a step list, for caching.

    Hashing the steps rather than stamping a time means an edited recipe is
    re-analysed and an untouched one never is, without anything having to
    remember to invalidate.
    """
    joined = "␟".join(str(s).strip() for s in steps)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:32]


def _coerce_int(value: Any, default: int, limit: int = _MAX_STEP_MINUTES) -> Optional[int]:
    """A non-negative, plausible number of minutes, or None to fall back."""
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    if number < 0 or number > limit:
        return None
    return number


def _merge(base: StepFacts, row: Dict[str, Any]) -> StepFacts:
    """Overlay one model row onto the keyword answer, field by field.

    Per field rather than per step on purpose: a row that gets the station
    right and the minutes nonsense should contribute the station. Replacing
    the whole StepFacts would make one bad number discard three good ones.
    """
    active = _coerce_int(row.get("active"), base.active_min)
    passive = _coerce_int(row.get("passive"), base.passive_min)
    station = str(row.get("station") or "").strip().lower()
    phase = str(row.get("phase") or "").strip().lower()

    # A step that is somehow zero on both counts is not free, it is unanswered.
    if active == 0 and passive == 0:
        active, passive = None, None

    return StepFacts(
        index=base.index,
        text=base.text,
        station=station if station in _KNOWN_STATIONS else base.station,
        phase=phase if phase in _PHASES else base.phase,
        active_min=base.active_min if active is None else active,
        passive_min=base.passive_min if passive is None else passive,
    )


def _extract_json_array(raw: str) -> Optional[list]:
    """The array out of a reply that may be wrapped in prose or a code fence."""
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(.+?)```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


async def _default_caller(prompt: str) -> str:
    """The real model. Imported here so this module can be used, and tested,
    on a machine with no HTTP client installed -- the fallback path must not
    depend on the thing it is falling back from."""
    from providers.culinary.llm import _call_ollama
    return await _call_ollama(prompt)


async def analyse_steps_smart(steps: List[str], call_model=None) -> List[StepFacts]:
    """Keyword facts, refined by a model where the model is coherent.

    Returns the keyword answer unchanged on any failure: no model, a timeout,
    prose instead of JSON, a row for a step that does not exist. The caller
    gets a usable list either way and never has to check which one it got.

    `call_model` is injectable so the failure modes -- which are the whole
    point of this layer -- can be exercised without a model and without the
    transport being installed.
    """
    base = analyse_steps(steps)
    if not base:
        return base

    try:
        caller = call_model or _default_caller
        numbered = "\n".join(f"{f.index}. {f.text}" for f in base)
        reply = await caller(_PROMPT.format(steps=numbered))
    except Exception as exc:
        logger.info("Step analysis: model unavailable, keeping keyword pass (%s)", exc)
        return base

    rows = _extract_json_array(reply)
    if not rows:
        logger.info("Step analysis: no JSON array in reply, keeping keyword pass")
        return base

    by_index: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        index = _coerce_int(row.get("i"), -1, limit=len(base))
        if index is not None and 0 <= index < len(base):
            by_index[index] = row

    refined = [_merge(f, by_index[f.index]) if f.index in by_index else f
               for f in base]
    logger.info("Step analysis: model refined %d of %d steps",
                len(by_index), len(base))
    return refined
