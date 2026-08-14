"""
providers/culinary/appliance_limits.py — what an appliance can and cannot do

The appliance swap asks a model to rewrite a method, and the fair question is
how anyone knows the answer is right. "Pressure cook on high for 15 minutes"
is either correct or it is undercooked chicken, and a plausible sentence looks
identical either way.

Nothing here makes a model's number *verified*. What it does is narrow the
range in which a wrong answer can hide, in the one way that needs no model and
no judgement: **physical limits**. An air fryer does not reach 300°C. A slow
cooker on low is not a twenty-minute appliance. Pressure cookers do not run
for six hours. These are facts about the machine, they are the same in every
kitchen, and a rewrite that violates one is wrong no matter how confidently it
is phrased.

That leaves the harder half honestly unsolved, and it should be said plainly
rather than dressed up: a pressure time inside the plausible range can still
be wrong for the cut of meat in front of you, and no amount of bounds
checking catches it. For anything where undercooking is a safety question
rather than a texture question, the instrument is a thermometer and the
program should say so instead of implying the timer settled it.

So this module does three things and claims nothing more:

  * rejects rewrites that are physically impossible for the appliance;
  * flags ones that are unusual enough to be worth a second look;
  * carries the safety note for appliances where time is not the test.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ApplianceLimits:
    """What is physically possible, and what is merely unusual.

    The two are kept apart on purpose. Impossible is a refusal -- the machine
    cannot do it and the instruction is wrong. Unusual is a note, because
    plenty of real recipes sit at the edges and a program that argues with
    every one of them stops being read.
    """
    label: str
    #: Temperatures the dial can actually reach, in Celsius. None where the
    #: appliance has no temperature to speak of.
    min_c: Optional[int] = None
    max_c: Optional[int] = None
    #: Times the appliance is ever run for, in minutes. Outside this is a
    #: misunderstanding of what the machine is, not an unusual recipe.
    min_minutes: int = 1
    max_minutes: int = 24 * 60
    #: The band where nothing needs saying. Outside it, worth a glance.
    typical_minutes: Tuple[int, int] = (1, 24 * 60)
    #: Said whenever this appliance is used, because time is not the test.
    safety_note: str = ""


#: Deliberately generous. These are the walls, not a recommendation -- the
#: point is to catch a rewrite that has misunderstood the appliance, not to
#: second-guess a cook who knows their kitchen.
LIMITS: Dict[str, ApplianceLimits] = {
    "oven": ApplianceLimits(
        label="oven", min_c=50, max_c=290,
        min_minutes=1, max_minutes=24 * 60, typical_minutes=(5, 480),
    ),
    "stove": ApplianceLimits(
        label="stovetop", min_minutes=1, max_minutes=12 * 60,
        typical_minutes=(1, 300),
    ),
    "microwave": ApplianceLimits(
        label="microwave", min_minutes=1, max_minutes=60,
        typical_minutes=(1, 20),
    ),
    "air_fryer": ApplianceLimits(
        # Domestic air fryers top out around 230C; a rewrite asking for 250
        # has confused it with an oven.
        label="air fryer", min_c=40, max_c=230,
        min_minutes=1, max_minutes=120, typical_minutes=(3, 45),
    ),
    "instant_pot": ApplianceLimits(
        label="pressure cooker", min_minutes=0, max_minutes=240,
        typical_minutes=(1, 90),
        safety_note=(
            "Pressure times are for the cut and the size, not the dish — check "
            "meat with a thermometer rather than trusting the timer."),
    ),
    "slow_cooker": ApplianceLimits(
        # The whole point of the appliance is hours. A forty-minute slow-cook
        # instruction is a rewrite that has not understood what it is for.
        label="slow cooker", min_minutes=60, max_minutes=16 * 60,
        typical_minutes=(120, 12 * 60),
        safety_note=(
            "Slow cookers hold a low temperature for a long time — start from "
            "chilled, not frozen, and check meat with a thermometer."),
    ),
    "dutch_oven": ApplianceLimits(
        label="Dutch oven", min_c=50, max_c=290,
        min_minutes=1, max_minutes=12 * 60, typical_minutes=(10, 300),
    ),
    "sous_vide": ApplianceLimits(
        # A circulator that will not go past 100C, and the low end is the
        # whole technique.
        label="sous vide", min_c=40, max_c=99,
        min_minutes=10, max_minutes=72 * 60, typical_minutes=(30, 24 * 60),
        safety_note=(
            "Sous vide holds food in the temperature range bacteria like. The "
            "bath temperature and the time have to match the pasteurisation "
            "table for that thickness — do not shorten it by eye."),
    ),
    "stand_mixer": ApplianceLimits(
        label="stand mixer", min_minutes=1, max_minutes=60,
        typical_minutes=(1, 20),
    ),
    "wok": ApplianceLimits(
        label="wok", min_minutes=1, max_minutes=90, typical_minutes=(1, 30),
    ),
    "grill": ApplianceLimits(
        label="grill", min_c=50, max_c=350,
        min_minutes=1, max_minutes=12 * 60, typical_minutes=(2, 240),
        safety_note=(
            "Grill heat varies down the bar and with the wind — check meat "
            "with a thermometer rather than by the clock."),
    ),
}

#: An indoor electric grill is not an outdoor one -- lower ceiling, no wind,
#: and the plate temperature is what the dial says. Given its own entry
#: because an "Instant indoor smokeless grill" checked against outdoor-grill
#: limits would accept 350C, which it does not do.
LIMITS["indoor_grill"] = ApplianceLimits(
    label="indoor grill", min_c=50, max_c=260,
    min_minutes=1, max_minutes=180, typical_minutes=(2, 40),
    safety_note=(
        "Grill plates run hotter at the centre — check meat with a "
        "thermometer rather than by the clock."),
)

#: The furthest any machine of this class plausibly goes. A profile may
#: narrow a class limit as much as it likes; it may only widen one up to
#: here.
#:
#: The asymmetry is the point. A household saying "mine only reaches 200C"
#: makes the check stricter and can only help. A profile saying "mine reaches
#: 400C" makes the check looser, and if that number came from a model
#: guessing about a product it half-recognised, the loosening is exactly the
#: failure this was built to catch. Narrowing is trusted; widening is capped.
HARD_CEILING_C: Dict[str, int] = {
    "oven": 320, "air_fryer": 250, "dutch_oven": 320, "grill": 400,
    "indoor_grill": 290, "sous_vide": 99, "microwave": 100, "stove": 400,
}


def effective_limits(station: str,
                     profile: Optional[dict] = None) -> Optional[ApplianceLimits]:
    """Class limits, adjusted by what the household knows about its machine.

    Returns None for a station with no limits defined, which callers treat as
    "nothing to check" rather than "everything is fine".
    """
    base = LIMITS.get(station)
    if not base or not profile:
        return base

    max_c = base.max_c
    # A figure recorded for this station beats one recorded for the appliance.
    # A multicooker that air fries at 205C and bakes at 175C has two different
    # true answers, and the appliance-wide number is only the larger of them --
    # using it for the cooler station would permit an instruction that machine
    # cannot carry out.
    per_station = profile.get("station_max_c")
    claimed = (per_station or {}).get(station) if isinstance(per_station, dict) else None
    if claimed is None:
        claimed = profile.get("max_c")
    if isinstance(claimed, (int, float)) and claimed > 0:
        ceiling = HARD_CEILING_C.get(station, base.max_c or int(claimed))
        max_c = min(int(claimed), ceiling)

    min_c = base.min_c
    claimed_min = profile.get("min_c")
    if isinstance(claimed_min, (int, float)) and claimed_min > 0:
        # Only ever tightened upward from below, never dropped past the class
        # floor, so a bad number cannot make an impossible step look fine.
        min_c = max(int(claimed_min), base.min_c) if base.min_c else int(claimed_min)

    return ApplianceLimits(
        label=(profile.get("label") or base.label),
        min_c=min_c, max_c=max_c,
        min_minutes=base.min_minutes, max_minutes=base.max_minutes,
        typical_minutes=base.typical_minutes,
        safety_note=base.safety_note or str(profile.get("safety") or ""),
    )


#: Anchored on the left, because an unanchored two-to-three digit match reads
#: the *tail* of a longer number: "1200C" matched as "200C", which is inside
#: every oven's range, so the one number obviously wrong enough to catch was
#: the one that sailed through. Four digits are allowed for the same reason --
#: an absurd temperature should be rejected as too hot, not quietly trimmed
#: into a plausible one.
_TEMP = re.compile(r"(?<![\d.])(\d{2,4})\s*°?\s*([CF])\b", re.IGNORECASE)
_MINUTES = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:to|-|–)?\s*(\d+(?:\.\d+)?)?\s*"
    r"(minute|min|hour|hr)s?\b", re.IGNORECASE)


def _to_celsius(value: int, unit: str) -> int:
    return value if unit.upper() == "C" else round((value - 32) * 5 / 9)


@dataclass
class Check:
    """The verdict on one rewrite."""
    #: Impossible for this appliance. The rewrite should not be offered.
    impossible: List[str] = field(default_factory=list)
    #: Possible but unusual. Shown alongside, not blocking.
    unusual: List[str] = field(default_factory=list)
    #: Carried whenever the appliance is one where time is not the test.
    safety: str = ""

    @property
    def ok(self) -> bool:
        return not self.impossible


def check_method(station: str, steps: List[str],
                 profile: Optional[dict] = None) -> Check:
    """Read the numbers in a rewritten method against what the machine can do.

    Only what the text actually states is checked. A step that names no
    temperature is not assumed to be at any particular one, because inventing
    a number in order to reject it would fail perfectly good instructions.
    """
    limits = effective_limits(station, profile)
    result = Check()
    if not limits:
        return result
    result.safety = limits.safety_note

    for step in steps:
        text = str(step)

        for raw, unit in _TEMP.findall(text):
            celsius = _to_celsius(int(raw), unit)
            if limits.max_c is not None and celsius > limits.max_c:
                result.impossible.append(
                    f"{raw}°{unit.upper()} is above what a {limits.label} reaches "
                    f"(about {limits.max_c}°C).")
            elif limits.min_c is not None and celsius < limits.min_c:
                result.impossible.append(
                    f"{raw}°{unit.upper()} is below the range of a {limits.label}.")

        for lo, hi, unit in _MINUTES.findall(text):
            factor = 60 if unit.lower().startswith("h") else 1
            minutes = float(hi or lo) * factor
            if minutes > limits.max_minutes:
                result.impossible.append(
                    f"{_humanise(minutes)} is longer than a {limits.label} is "
                    f"ever run for.")
            elif minutes < limits.min_minutes:
                result.impossible.append(
                    f"{_humanise(minutes)} is shorter than a {limits.label} "
                    f"does anything in.")
            elif not (limits.typical_minutes[0] <= minutes <= limits.typical_minutes[1]):
                result.unusual.append(
                    f"{_humanise(minutes)} is outside the usual range for a "
                    f"{limits.label} — worth a check.")

    # One of each. A method that says 250C four times has one problem.
    result.impossible = list(dict.fromkeys(result.impossible))
    result.unusual = list(dict.fromkeys(result.unusual))
    return result


def _humanise(minutes: float) -> str:
    if minutes >= 90:
        hours = minutes / 60
        return f"{hours:.0f} hours" if hours == int(hours) else f"{hours:.1f} hours"
    return f"{minutes:.0f} minutes"


def describe_for_prompt(station: str, profile: Optional[dict] = None) -> str:
    """What to tell the model about this specific machine.

    A prompt that says "an air fryer" gets a generic answer. One that says
    "a 1700W Cosori Pro Gen 2, maximum 230°C, 5.5L basket" gets a rewrite with
    the right temperature and a realistic batch size, and -- more usefully --
    one that can be checked against the same numbers afterwards.
    """
    limits = LIMITS.get(station)
    if not limits:
        return station

    parts = [limits.label]
    if profile:
        named = " ".join(str(profile.get(k) or "").strip()
                         for k in ("make", "model")).strip()
        if named:
            parts.append(f"specifically a {named}")
        if profile.get("watts"):
            parts.append(f"{profile['watts']}W")
        if profile.get("capacity"):
            parts.append(f"{profile['capacity']} capacity")
        if profile.get("max_c"):
            parts.append(f"maximum {profile['max_c']}°C")
        elif limits.max_c:
            parts.append(f"maximum about {limits.max_c}°C")
        if profile.get("notes"):
            parts.append(str(profile["notes"])[:200])
    elif limits.max_c:
        parts.append(f"maximum about {limits.max_c}°C")

    return ", ".join(parts)
