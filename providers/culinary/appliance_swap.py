"""
providers/culinary/appliance_swap.py — cooking it in something else

"I want to do this in the Dutch oven instead" is not a substitution you can
make by editing words. A pressure cooker needs liquid a skillet does not, an
air fryer wants a single layer and a shake halfway, and the times are not
related to the original by any factor. Nothing deterministic gets you from
one to the other, which is what makes this the job a model is actually for --
unlike timing a step, which is parsing, or scaling a recipe, which is
arithmetic.

Two rules shape everything here.

**The saved recipe is never touched.** A swap belongs to the session you are
cooking, not to the recipe you keep. You tried the Dutch oven once; that
should not rewrite the thing you will cook in a skillet next month. The
rewrite is stored against the prep session entry and dies with it.

**A rewrite is checked against the machine.** Not verified -- nothing here
can tell you whether fifteen minutes at high pressure is right for your cut of
beef. What it can tell you is when an instruction is impossible: an air fryer
that does not reach 250°C, a slow cooker asked to work in forty minutes. Those
are facts about the appliance, they need no model, and a rewrite that breaks
one is wrong however confidently it is written. Where the appliance is one
whose timing is a safety question rather than a texture question, the note
says to use a thermometer, because a timer is not the test and the program
should not imply it is.

**A failure is reported, not absorbed.** Everywhere else in this module the
model is optional and the keyword answer stands in. Here there is no fallback
worth having: a "swap" that quietly returns the skillet instructions is worse
than an error, because the cook has been told the oven will work and the
recipe in front of them says otherwise.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from providers.culinary.appliance_limits import check_method, describe_for_prompt

logger = logging.getLogger(__name__)

#: How the appliances read in a prompt. The scheduler's keys are terse on
#: purpose; a model does better with the words on the box.
APPLIANCE_NAMES: Dict[str, str] = {
    "oven": "conventional oven",
    "stove": "stovetop (hob)",
    "microwave": "microwave oven",
    "air_fryer": "air fryer",
    "instant_pot": "electric pressure cooker (Instant Pot)",
    "slow_cooker": "slow cooker",
    "dutch_oven": "Dutch oven",
    "sous_vide": "sous vide immersion circulator",
    "stand_mixer": "stand mixer",
    "wok": "wok",
    "grill": "outdoor grill",
}

#: A rewrite longer than this is the model retelling the recipe rather than
#: converting it, and a step list nobody will read is not an improvement.
_MAX_STEPS = 24
_MAX_STEP_CHARS = 600

_PROMPT = """Rewrite this recipe's method so it is cooked in a {target} instead of {origin}.

Recipe: {title}

Current ingredients:
{ingredients}

Current method:
{steps}

What has to change and what must not:
- Keep the dish the same. This is the same recipe cooked differently, not a new one.
- Adjust times and temperatures to what the {target} actually needs. Do not
  reuse the original timings unless they genuinely still apply.
- Change quantities ONLY where the appliance forces it — a pressure cooker
  needs enough liquid to come to pressure, an air fryer needs less oil. Say so
  in "note" when you do.
- Keep every step something a person can follow standing in a kitchen.
- If this dish genuinely cannot be made in a {target}, say so in "note" and
  return the original steps unchanged.

Return ONLY this JSON object, no prose and no markdown:
{{"steps": ["...", "..."], "ingredients": ["...", "..."], "note": "one sentence on what changed"}}
"""


class SwapFailed(Exception):
    """The rewrite could not be produced.

    Raised rather than returning the original, because a swap that silently
    hands back the skillet method tells the cook the appliance will work and
    then gives them instructions for a different one.
    """


def _clean_lines(value: Any, limit: int) -> List[str]:
    out: List[str] = []
    for item in value if isinstance(value, list) else []:
        text = str(item).strip()
        if text and len(text) <= _MAX_STEP_CHARS:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _extract_object(raw: str) -> Optional[dict]:
    """The JSON object out of a reply that may be fenced or prefaced."""
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


def _ingredient_line(ing: Any) -> str:
    if isinstance(ing, dict):
        parts = [str(ing.get("qty") or "").strip(),
                 str(ing.get("unit") or "").strip(),
                 str(ing.get("name") or "").strip()]
        return " ".join(p for p in parts if p)
    return str(ing).strip()


async def rewrite_for_appliance(
    *,
    title: str,
    steps: List[str],
    ingredients: List[Any],
    origin_station: str,
    target_station: str,
    profile: Optional[dict] = None,
    call_model=None,
) -> Dict[str, Any]:
    """Convert a method to a different appliance. Raises SwapFailed if it cannot.

    `call_model` is injectable so the failure paths can be tested without a
    model and without the HTTP client installed.
    """
    if not steps:
        raise SwapFailed("That recipe has no method to convert.")

    target = APPLIANCE_NAMES.get(target_station)
    if not target:
        raise SwapFailed(f"Unknown appliance: {target_station}")

    # The specific machine where the household has recorded one. "A 1700W
    # Cosori Pro Gen 2, maximum 230C" gets a rewrite with real numbers on it;
    # "an air fryer" gets a generic one that is harder to check afterwards.
    described = describe_for_prompt(target_station, profile)

    prompt = _PROMPT.format(
        title=title,
        target=described,
        origin=APPLIANCE_NAMES.get(origin_station, "the original method"),
        ingredients="\n".join(f"- {_ingredient_line(i)}" for i in ingredients),
        steps="\n".join(f"{n}. {s}" for n, s in enumerate(steps, 1)),
    )

    try:
        if call_model is None:
            from providers.culinary.llm import _call_ollama
            call_model = _call_ollama
        reply = await call_model(prompt)
    except Exception as exc:
        logger.warning("Appliance swap: model call failed: %s", exc)
        raise SwapFailed(
            "Could not reach the local model to work this out. "
            "The recipe is unchanged.") from exc

    parsed = _extract_object(reply)
    if not parsed:
        raise SwapFailed(
            "The model did not answer in a form this could read. "
            "The recipe is unchanged.")

    new_steps = _clean_lines(parsed.get("steps"), _MAX_STEPS)
    if not new_steps:
        raise SwapFailed(
            "The model returned no usable method. The recipe is unchanged.")

    # Ingredients are optional: plenty of swaps change nothing but the method,
    # and an empty list there means "as before" rather than "none".
    new_ingredients = _clean_lines(parsed.get("ingredients"), 64)
    note = str(parsed.get("note") or "").strip()[:400]

    # The one check that needs no model. An instruction the machine cannot
    # carry out is refused rather than shown with a warning attached, because
    # a method with a wrong number in it is not improved by a caveat beside
    # it -- the cook is going to follow the step.
    verdict = check_method(target_station, new_steps)
    if not verdict.ok:
        raise SwapFailed(
            "That rewrite asks for something the appliance cannot do: "
            + " ".join(verdict.impossible)
            + " The recipe is unchanged.")

    return {
        "station": target_station,
        "steps": new_steps,
        "ingredients": new_ingredients or [_ingredient_line(i) for i in ingredients],
        "ingredients_changed": bool(new_ingredients),
        "note": note or f"Rewritten for the {target}.",
        # Shown alongside rather than blocking: plenty of real recipes sit at
        # the edges, and a program that argues with all of them stops being read.
        "unusual": verdict.unusual,
        "safety": verdict.safety,
    }
