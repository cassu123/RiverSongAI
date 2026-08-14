"""
api/routes/culinary_sessions.py — cooking sessions

`cook_now` scales a recipe, hands back a step list and forgets it. This is the
part that remembers.

Sessions are household-scoped, not per-device: start a recipe in the browser,
walk to the kitchen, and the Vortex is on the same step. They are persisted,
so a Pi rebooting mid-recipe does not lose your place, and timers store a
wall-clock deadline rather than a countdown, so they survive the reboot too.

    POST   /api/culinary/sessions                  start from a recipe id
    GET    /api/culinary/sessions/current          the active session
    GET    /api/culinary/sessions/{id}
    POST   /api/culinary/sessions/{id}/step        {action: next|back|goto|repeat}
    POST   /api/culinary/sessions/{id}/timer       named, bound to a step
    DELETE /api/culinary/sessions/{id}/timer/{tid}
    POST   /api/culinary/sessions/{id}/end

Every change is broadcast over the culinary WebSocket *and* pushed to the
kitchen Vortex, because a step that only reached one of the three screens is
the bug this feature exists to fix.

Mounted on the same `/api/culinary` prefix as culinary.py and reusing its
session, auth and scaling helpers — one household lookup, one set of
conversions, no second copy to drift.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.routes.culinary import (
    _get_household,
    _get_user_id,
    _ws_manager,
    get_db,
)
from api.services.recipe_parser import _format_qty, _parse_qty, _safe_json
from core.errors import bad_request, not_found
from core.cooking_sessions import (
    _as_utc,
    build_step,
    expired_timers,
    find_ingredient,
    normalise_steps,
    resolve_step_index,
    session_out,
    speak_step,
    start_deadline,
    timer_out,
)
from culinary.models import CookingSession, CookingTimer, Recipe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/culinary", tags=["culinary:sessions"])

# A cooking session is a room you are standing in. One at a time per
# household — starting a second ends the first rather than leaving two live
# sessions fighting over the same kitchen screen.
_MAX_TIMER_SECONDS = 24 * 3600


class SessionStart(BaseModel):
    recipe_id: str
    target_servings: int = Field(default=4, ge=1, le=200)
    # Optional equipment translation, e.g. "air_fryer". Applied once at start.
    equipment: Optional[str] = None


class StepAction(BaseModel):
    action: str = Field(pattern="^(next|back|previous|prev|goto|repeat)$")
    index: Optional[int] = None


class TimerCreate(BaseModel):
    seconds: int = Field(ge=1, le=_MAX_TIMER_SECONDS)
    label: str = Field(default="Timer", max_length=60)
    step_index: Optional[int] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Broadcast
# ---------------------------------------------------------------------------

async def broadcast_session(household_id: str, payload: Dict[str, Any],
                            *, event: str = "cooking_session") -> None:
    """
    Push a session change everywhere it needs to land.

    Three destinations, because the whole point is that they agree: the
    culinary WebSocket (browser), the Vortex WebSocket (any unit), and a
    surface card on the kitchen unit so the step is on the ambient screen
    without anyone opening an app.

    Best effort per destination — a disconnected Vortex must not fail the
    browser's request.
    """
    try:
        await _ws_manager.broadcast(household_id, event, payload)
    except Exception as exc:
        logger.debug("Culinary WS broadcast failed: %s", exc)

    try:
        from core.vortex_hub import get_vortex_hub
        await get_vortex_hub().broadcast(event, {"data": payload})
    except Exception as exc:
        logger.debug("Vortex WS broadcast failed: %s", exc)

    try:
        from core.vortex_surfaces import get_surface_publisher, publish_cooking_step

        if payload.get("is_active") and payload.get("step", {}).get("instruction"):
            await publish_cooking_step(step=payload["step"],
                                       recipe_title=payload["recipe_title"])
        else:
            # The session ended: take the card down rather than leaving the
            # last step on the wall for two hours of TTL.
            await get_surface_publisher().withdraw("cooking-step")
    except Exception as exc:
        logger.debug("Vortex surface push failed: %s", exc)


async def announce_timer(household_id: str, session: CookingSession,
                         timer: CookingTimer, *, fired: bool = False) -> None:
    """Announce a timer starting or going off."""
    payload = {"session_id": session.id, "timer": timer_out(timer)}
    try:
        await _ws_manager.broadcast(
            household_id, "cooking_timer_fired" if fired else "cooking_timer",
            payload)
    except Exception as exc:
        logger.debug("Culinary timer broadcast failed: %s", exc)

    if not fired:
        return

    # A timer going off is worth interrupting for — but it is a kitchen timer,
    # not a smoke alarm, so `high` rather than `critical`.
    try:
        from core.vortex_surfaces import get_surface_publisher

        await get_surface_publisher().publish(
            {
                "id": f"timer:{timer.id}",
                "kind": "alert",
                "priority": "high",
                "title": f"{timer.label} is up",
                "body": session.recipe_title,
                "icon": "⏲",
                "ttl_seconds": 600,
                "speech": f"{timer.label} is up.",
                "source": "cooking_timer",
                "actions": [{"label": "Dismiss",
                             "intent": f"surface.dismiss.timer:{timer.id}",
                             "style": "primary"}],
            },
            room="kitchen",
        )
    except Exception as exc:
        logger.debug("Timer surface push failed: %s", exc)


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def active_session(db: Session, household_id: str) -> Optional[CookingSession]:
    return (db.query(CookingSession)
            .filter_by(household_id=household_id, is_active=True)
            .order_by(CookingSession.created_at.desc())
            .first())


def _load(db: Session, household_id: str, session_id: str) -> CookingSession:
    session = db.query(CookingSession).filter_by(
        id=session_id, household_id=household_id).first()
    if not session:
        raise not_found("Cooking session not found")
    return session


async def reap_timers(db: Session, session: CookingSession,
                      household_id: str) -> List[CookingTimer]:
    """
    Mark any timer whose deadline has passed as fired, and announce it.

    Deadline-based timers do not need a scheduler to be *correct* — they are
    true whenever read — but something has to notice they came due in order to
    say so out loud. Every session read does that, and a kitchen with a live
    session is being read constantly.
    """
    due = expired_timers(list(session.timers))
    if not due:
        return []
    for timer in due:
        timer.status = "fired"
        timer.fired_at = _now()
    db.commit()
    for timer in due:
        await announce_timer(household_id, session, timer, fired=True)
    return due


async def emit(db: Session, household_id: str,
               session: CookingSession) -> Dict[str, Any]:
    """Commit, serialise and broadcast. The single exit point for a change."""
    db.commit()
    db.refresh(session)
    payload = session_out(session, list(session.timers))
    await broadcast_session(household_id, payload)
    return payload


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def start_session(body: SessionStart, request: Request,
                        db: Session = Depends(get_db)):
    """
    Start cooking a recipe.

    Scaling and equipment translation are applied here, once, and the result
    is stored on the session. Re-deriving on every read would re-run the
    translation LLM call on every "next", and would let a recipe edited
    mid-cook change the instructions under the person following them.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    recipe = db.query(Recipe).filter_by(
        id=body.recipe_id, household_id=hh.id).first()
    if not recipe:
        raise not_found("Recipe not found")

    original = recipe.servings or 1
    factor = body.target_servings / original

    scaled: List[Dict[str, Any]] = []
    for ingredient in _safe_json(recipe.ingredients_json, []):
        quantity = _parse_qty(str(ingredient.get("qty", ""))) * factor
        scaled.append({
            **ingredient,
            "qty": _format_qty(quantity) if quantity > 0 else ingredient.get("qty", ""),
        })

    steps = normalise_steps(_safe_json(recipe.steps_json, []))
    if body.equipment:
        steps = await _translate_steps(steps, body.equipment)

    # One live session per household. Two would mean two different answers to
    # "what step are we on", which is the exact failure this feature removes.
    previous = active_session(db, hh.id)
    if previous:
        previous.is_active = False
        previous.ended_at = _now()
        logger.info("Ending cooking session %s to start a new one.", previous.id)

    session = CookingSession(
        household_id=hh.id,
        recipe_id=recipe.id,
        recipe_title=recipe.title,
        servings_target=body.target_servings,
        scale_factor=factor,
        equipment=body.equipment,
        steps_json=json.dumps(steps),
        ingredients_json=json.dumps(scaled),
        current_step=0,
        started_by=uid,
    )
    db.add(session)
    logger.info("Cooking session started: '%s' x%d (%d steps) by %s.",
                recipe.title, body.target_servings, len(steps), uid)
    return await emit(db, hh.id, session)


async def _translate_steps(steps: List[str], equipment: str) -> List[str]:
    """
    Rewrite steps for the household's equipment, reusing culinary.py's prompt.

    Falls back to the original steps on any failure. A recipe you can follow
    on the hob beats an error where the instructions should be.
    """
    try:
        from api.services.recipe_parser import _extract_json
        from providers.culinary.llm import (
            _EQUIPMENT_TRANSLATE_PROMPT, _call_ollama,
        )

        raw = await _call_ollama(_EQUIPMENT_TRANSLATE_PROMPT.format(
            equipment=equipment, steps=json.dumps(steps, indent=2)))
        translated = normalise_steps(_extract_json(raw))
        if translated:
            return translated
        logger.warning("Equipment translation returned nothing usable; "
                       "keeping the original steps.")
    except Exception as exc:
        logger.error("Equipment translation failed (%s); keeping the original "
                     "steps.", exc)
    return steps


@router.get("/sessions/current")
async def current_session(request: Request, db: Session = Depends(get_db)):
    """The household's active session, or `{"session": null}` if nobody is cooking."""
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    session = active_session(db, hh.id)
    if not session:
        return {"session": None}

    fired = await reap_timers(db, session, hh.id)
    payload = session_out(session, list(session.timers))
    if fired:
        payload["just_fired"] = [timer_out(t) for t in fired]
    return {"session": payload}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request,
                      db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = _load(db, hh.id, session_id)
    await reap_timers(db, session, hh.id)
    return session_out(session, list(session.timers))


@router.post("/sessions/{session_id}/step")
async def move_step(session_id: str, body: StepAction, request: Request,
                    db: Session = Depends(get_db)):
    """
    Move to another step.

    A move that cannot happen — already at the first step, past the last —
    is not an error. It returns the unchanged session with a `message`, so a
    voice caller says "that was the last step" instead of silently not moving.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = _load(db, hh.id, session_id)
    if not session.is_active:
        raise not_found("That cooking session has ended")

    steps = normalise_steps(_safe_json(session.steps_json, []))
    index, complaint = resolve_step_index(
        body.action, session.current_step, len(steps), body.index)

    await reap_timers(db, session, hh.id)

    if index == session.current_step and body.action != "repeat":
        payload = session_out(session, list(session.timers))
        payload["message"] = complaint
        return payload

    session.current_step = index
    payload = await emit(db, hh.id, session)
    if complaint:
        payload["message"] = complaint
    return payload


@router.post("/sessions/{session_id}/timer", status_code=status.HTTP_201_CREATED)
async def add_timer(session_id: str, body: TimerCreate, request: Request,
                    db: Session = Depends(get_db)):
    """
    Start a named timer bound to a step.

    Stores the wall-clock deadline. A countdown needs something running to
    decrement it and so loses exactly the time a reboot takes; a deadline is
    simply true whenever it is next read.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = _load(db, hh.id, session_id)
    if not session.is_active:
        raise not_found("That cooking session has ended")

    timer = CookingTimer(
        session_id=session.id,
        label=body.label.strip() or "Timer",
        step_index=(body.step_index if body.step_index is not None
                    else session.current_step),
        duration_seconds=body.seconds,
        ends_at=start_deadline(body.seconds),
        status="running",
    )
    db.add(timer)
    db.commit()
    db.refresh(timer)

    logger.info("Cooking timer '%s' (%ds) started on session %s.",
                timer.label, timer.duration_seconds, session.id)
    await announce_timer(hh.id, session, timer)
    db.refresh(session)
    await broadcast_session(hh.id, session_out(session, list(session.timers)))
    return timer_out(timer)


@router.delete("/sessions/{session_id}/timer/{timer_id}")
async def cancel_timer(session_id: str, timer_id: str, request: Request,
                       db: Session = Depends(get_db)):
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = _load(db, hh.id, session_id)

    timer = db.query(CookingTimer).filter_by(
        id=timer_id, session_id=session.id).first()
    if not timer:
        raise not_found("Timer not found")

    timer.status = "cancelled"
    db.commit()

    try:
        from core.vortex_surfaces import get_surface_publisher
        await get_surface_publisher().withdraw(f"timer:{timer.id}")
    except Exception as exc:
        logger.debug("Could not withdraw timer surface: %s", exc)

    db.refresh(session)
    await broadcast_session(hh.id, session_out(session, list(session.timers)))
    return {"status": "cancelled", "timer_id": timer_id}


@router.post("/sessions/{session_id}/end")
async def end_session(session_id: str, request: Request,
                      db: Session = Depends(get_db)):
    """
    Finish cooking.

    Running timers are cancelled with the session and their cards withdrawn —
    a timer for a dish nobody is cooking any more should not go off later, and
    a step left on the kitchen screen is a card that stayed up after it
    stopped mattering.
    """
    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = _load(db, hh.id, session_id)

    session.is_active = False
    session.ended_at = _now()

    from core.vortex_surfaces import get_surface_publisher

    publisher = get_surface_publisher()
    for timer in session.timers:
        if timer.status == "running":
            timer.status = "cancelled"
            try:
                await publisher.withdraw(f"timer:{timer.id}")
            except Exception:
                pass

    logger.info("Cooking session %s ended ('%s').", session.id,
                session.recipe_title)
    return await emit(db, hh.id, session)


# ---------------------------------------------------------------------------
# Voice support
# ---------------------------------------------------------------------------

# Words that never appear in an ingredient name and do appear in the other
# kind of "how much" question.
_SENTENCE_WORDS = frozenset({
    "i", "you", "we", "he", "she", "they", "it", "me", "my", "your", "does",
    "did", "will", "would", "should", "is", "was", "cost", "costs", "owe",
    "paid", "pay", "worth", "left", "longer",
})


def _looks_like_a_sentence(text: str) -> bool:
    """True when a 'how much …' tail reads as a question, not an ingredient."""
    words = [w for w in text.lower().split() if w]
    return any(w in _SENTENCE_WORDS for w in words) or len(words) > 4


async def restore_kitchen_surface(user_id: str) -> bool:
    """
    Put the current recipe step back on the kitchen screen.

    Surface state is in-memory, so a server restart empties it while the
    session itself is still in the database. Called when a unit connects, so
    walking into the kitchen after a restart shows the step you are on rather
    than an empty screen until somebody says "next".
    """
    db = None
    try:
        from api.routes.culinary import _Session
        from core.vortex_surfaces import publish_cooking_step

        db = _Session()
        hh = _get_household(db, user_id)
        session = active_session(db, hh.id)
        if not session:
            return False

        payload = session_out(session, list(session.timers))
        if not payload["step"]["instruction"]:
            return False
        await publish_cooking_step(step=payload["step"],
                                   recipe_title=payload["recipe_title"])
        return True
    except Exception as exc:
        logger.debug("Could not restore the kitchen step card: %s", exc)
        return False
    finally:
        if db is not None:
            db.close()


async def voice_command(user_id: str, command: str,
                        argument: str = "") -> Optional[str]:
    """
    Run a cooking command from a voice transcript.

    Shares every code path with the HTTP endpoints above so "next" over the
    microphone and "Next" tapped on a wall panel do the same thing and
    broadcast the same change.

    Returns a spoken response, or None when there is no active session — which
    the intent router treats as "not a cooking command after all" and lets the
    LLM answer instead.
    """
    db = None
    try:
        from api.routes.culinary import _Session

        db = _Session()
        hh = _get_household(db, user_id)
        session = active_session(db, hh.id)
        if not session:
            return None

        await reap_timers(db, session, hh.id)
        steps = normalise_steps(_safe_json(session.steps_json, []))
        ingredients = _safe_json(session.ingredients_json, [])

        if command == "how_long":
            from core.cooking_sessions import speak_remaining
            return speak_remaining([timer_out(t) for t in session.timers])

        if command == "how_much":
            from core.cooking_sessions import speak_ingredient

            match = find_ingredient(argument, ingredients)
            if match:
                return speak_ingredient(match)
            if not argument:
                return "How much of what?"
            # "How much" is not always about the recipe, even mid-cook —
            # "how much do I owe you" is a question for the LLM. Anything
            # that reads like a sentence rather than an ingredient goes back.
            if _looks_like_a_sentence(argument):
                return None
            return f"I can't find {argument} in this recipe."

        if command == "timer":
            seconds = int(argument or 0)
            if seconds <= 0:
                return "How long should I set it for?"
            step = build_step(session.current_step, steps, ingredients)
            suggested = step.get("suggested_timer") or {}
            timer = CookingTimer(
                session_id=session.id,
                label=suggested.get("label") or "Timer",
                step_index=session.current_step,
                duration_seconds=seconds,
                ends_at=start_deadline(seconds),
                status="running",
            )
            db.add(timer)
            db.commit()
            db.refresh(timer)
            await announce_timer(hh.id, session, timer)
            from core.cooking_sessions import humanise
            return f"{timer.label} set for {humanise(seconds)}."

        # next | back | repeat
        index, complaint = resolve_step_index(
            command, session.current_step, len(steps))
        if index != session.current_step:
            session.current_step = index
            await emit(db, hh.id, session)
        elif complaint:
            return complaint

        step = build_step(index, steps, ingredients)
        if command == "repeat":
            await broadcast_session(
                hh.id, session_out(session, list(session.timers)))
        return speak_step(step, with_ingredients=command != "repeat")

    except Exception as exc:
        logger.error("Cooking voice command '%s' failed: %s", command, exc)
        return "Sorry, I lost track of where we were in the recipe."
    finally:
        if db is not None:
            db.close()


# ---------------------------------------------------------------------------
# Meal cooks — several recipes on one timeline
#
# The single-recipe session above answers "what is the next step". A meal
# answers a different question: given three dishes, one oven and one cook,
# what happens when. Those are separate objects rather than one generalised
# one, because the single-recipe flow is voice-driven and step-at-a-time while
# a meal plan is something you read ahead in.
# ---------------------------------------------------------------------------

class MealCookStart(BaseModel):
    prep_session_id: Optional[str] = None
    label: Optional[str] = None
    #: ISO-8601. Only used to render wall-clock times; the plan is offsets.
    serve_at: Optional[str] = None
    #: recipe_id -> minutes after the first course. Absent means "together".
    courses: Optional[Dict[str, Annotated[int, Field(ge=0)]]] = None


class MealStepDone(BaseModel):
    key: str
    done: bool = True


def _courses_from_query(raw: str) -> Dict[str, int]:
    """Parse "recipeid:30,otherid:60" from the preview query string.

    A GET so the plan stays cacheable and linkable, which means the course
    offsets have to survive as text. Anything unparseable is dropped rather
    than rejected -- a malformed offset should cost you a stagger, not the
    whole plan.
    """
    courses: Dict[str, int] = {}
    for part in (raw or "").split(","):
        rid, _, minutes = part.partition(":")
        if rid.strip() and minutes.strip().lstrip("-").isdigit():
            parsed = int(minutes)
            if parsed >= 0:
                courses[rid.strip()] = parsed
    return courses


def _owned_stations(db: Session, household_id: str) -> Dict[str, int]:
    """How many of each appliance the household has.

    Two air fryers is not exotic and it is the difference between a reported
    conflict and a fine plan, so equipment is counted rather than checked for
    presence.
    """
    from culinary.models import KitchenEquipment

    counts: Dict[str, int] = {}
    for eq in db.query(KitchenEquipment).filter_by(household_id=household_id).all():
        types = _safe_json(eq.capabilities_json, None) or (
            [eq.equipment_type] if eq.equipment_type else [])
        for t in types:
            counts[t] = counts.get(t, 0) + 1
    return counts


def _owned_appliances(db: Session, household_id: str) -> List[Dict[str, Any]]:
    """The machines on the counter, each with the stations it can stand in for.

    Named rather than typed, because a household with two pressure cookers has
    two different appliances: the one with the air fry lid can take a dish the
    other cannot, and "cook it in the pressure cooker" does not say which.

    Appliances with no schedulable station are left out. A cooking blender is
    worth recording and is not somewhere a dish gets sent.
    """
    from culinary.models import KitchenEquipment

    out: List[Dict[str, Any]] = []
    for eq in db.query(KitchenEquipment).filter_by(household_id=household_id).all():
        stations = _safe_json(eq.capabilities_json, None) or (
            [eq.equipment_type] if eq.equipment_type else [])
        stations = [s for s in stations if s and s != "counter"]
        if not stations:
            continue
        profile = _safe_json(eq.profile_json, {}) or {}
        out.append({
            "id": eq.id,
            "label": eq.label or " ".join(
                x for x in (eq.make, eq.model) if x) or "Appliance",
            "stations": stations,
            "panel_confirmed": bool(profile.get("panel_confirmed")),
        })
    return out


def _plan_for_prep_session(db: Session, hh, session,
                           courses: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Build the meal plan for a prep session's staged recipes.

    `courses` maps a recipe id to how many minutes after the first course it
    is wanted. Everything defaults to 0, which is one meal landing together.
    """
    from providers.culinary.cook_plan import RecipeInPlan, analyse_steps, plan_meal

    recipes = []
    #: Mise en place. Most of prep is measuring and portioning, and none of
    #: that appears in the steps -- a recipe says "add the paprika", never
    #: "get the paprika out". Carried per recipe so the prep screen can ask
    #: for bowls rather than only for knife work.
    mise: Dict[str, List[dict]] = {}
    swapped_to: List[dict] = []

    for entry in session.recipes:
        if not entry.recipe:
            continue
        # A swap replaces the method for this session only. The saved recipe
        # is untouched, and clearing the swap brings the original straight
        # back because it was never overwritten.
        swap = _safe_json(entry.appliance_swap_json, None)
        steps = normalise_steps(
            swap.get("steps") if swap else _safe_json(entry.recipe.steps_json, []))
        if not steps:
            continue

        swapped_to.append({
            "recipe_id": entry.recipe_id,
            "station": swap.get("station"),
            # What the picker had selected, so reopening the plan shows the
            # machine that was chosen rather than falling back to its type.
            "pick": (f"{swap['equipment_id']}:{swap['station']}"
                     if swap.get("equipment_id") else swap.get("station")),
            "equipment_label": swap.get("equipment_label", ""),
            "note": swap.get("note", ""),
            "unusual": swap.get("unusual", []),
            "safety": swap.get("safety", ""),
        }) if swap else None

        recipes.append(RecipeInPlan(
            recipe_id=entry.recipe_id,
            title=entry.recipe.title,
            steps=analyse_steps(steps),
            course_offset_min=int((courses or {}).get(entry.recipe_id, 0)),
        ))
        # Scaled quantities when the session has them: portioning out the
        # unscaled amount for a doubled recipe is the mistake this screen
        # exists to prevent.
        # A swap that changed the quantities supplies its own list, as plain
        # strings; otherwise the scaled or original structured ingredients.
        if swap and swap.get("ingredients_changed"):
            ingredients = [{"name": line} for line in swap.get("ingredients", [])]
        else:
            ingredients = _safe_json(
                entry.scaled_ingredients_json,
                None) or _safe_json(entry.recipe.ingredients_json, [])
        mise[entry.recipe_id] = [
            {
                "key": f"{entry.recipe_id}:ing:{i}",
                "name": ing.get("name", ""),
                "qty": ing.get("qty", ""),
                "unit": ing.get("unit", ""),
            }
            for i, ing in enumerate(ingredients)
            if isinstance(ing, dict) and ing.get("name")
        ]

    plan = plan_meal(recipes, owned_stations=_owned_stations(db, hh.id))
    return {
        "total_minutes": plan.serve_offset_min,
        # Where "start by" counts back from. Equal to total_minutes unless the
        # dishes are staggered, in which case the end of the plan is the last
        # course going out and not the moment anyone sits down.
        "first_course_minutes": plan.first_course_min,
        "swaps": swapped_to,
        "stations": plan.stations_used,
        # The machines actually on the counter, by name. Offering "cook it in
        # the pressure cooker" to a household with two of them asks a question
        # they cannot answer -- only one has the air fry lid, and which one is
        # used changes the method.
        "appliances": _owned_appliances(db, hh.id),
        "recipes": [{"id": r.recipe_id, "title": r.title,
                     "course_offset_min": r.course_offset_min,
                     "ingredients": mise.get(r.recipe_id, [])} for r in recipes],
        "steps": [
            {
                # Stable across replans, so ticking a step survives a reload.
                "key": f"{s.recipe_id}:{s.step_index}",
                "recipe_id": s.recipe_id,
                "recipe_title": s.recipe_title,
                "step_index": s.step_index,
                "text": s.text,
                "station": s.station,
                "phase": s.phase,
                "start_min": s.start_min,
                "end_min": s.end_min,
                "active_min": s.active_min,
                "passive_min": s.passive_min,
                "hands_on": s.hands_on,
                # "3-5 minutes each side, until browned" -- the clock is a
                # guide and the eye decides. The cook screen dims the timer
                # and says so, which it could not do while this was computed
                # and then left out of the payload.
                "by_eye": s.by_eye,
            }
            for s in plan.steps
        ],
        "conflicts": [
            {"kind": c.kind, "resource": c.resource,
             "start_min": c.start_min, "detail": c.detail}
            for c in plan.conflicts
        ],
    }


def _timer_out(t) -> Dict[str, Any]:
    """A timer as the browser needs it: an instant, not a number of seconds.

    Sending "180 seconds left" would be stale the moment it arrived and would
    drift on a slow connection. An end time is right whenever it is read.
    """
    return {
        "id": t.id,
        "step_key": t.step_key,
        "label": t.label,
        "ends_at": t.ends_at.isoformat() if t.ends_at else None,
        "paused_seconds": t.paused_seconds,
        "running": t.ends_at is not None and t.stopped_at is None,
        "stopped": t.stopped_at is not None,
    }


def _meal_cook_out(cook, timers=None) -> Dict[str, Any]:
    return {
        "id": cook.id,
        "label": cook.label,
        "prep_session_id": cook.prep_session_id,
        "serve_at": cook.serve_at.isoformat() if cook.serve_at else None,
        "plan": _safe_json(cook.plan_json, {}),
        "done": _safe_json(cook.done_steps_json, []),
        "is_active": cook.is_active,
        "started_at": cook.created_at.isoformat() if cook.created_at else None,
        "timers": [_timer_out(t) for t in (timers or [])],
    }


@router.get("/prep/{session_id}/cook-plan")
async def preview_cook_plan(
    session_id: str, request: Request, db: Session = Depends(get_db),
    courses: str = "",
):
    """What cooking this prep session would look like, without starting it.

    Read-only and re-derived on every call, so it tracks edits to the recipes
    and the staged list. Starting a cook freezes a copy; this is the version
    you are still allowed to change your mind about.
    """
    from culinary.models import PrepSession

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")
    return _plan_for_prep_session(db, hh, session, _courses_from_query(courses))


def _appliance_profile(db: Session, household_id: str, station: str,
                       equipment_id: Optional[str] = None) -> Optional[dict]:
    """What this household knows about its own machine of that kind.

    Make and model, the facts they have recorded, and how it has actually
    behaved. The last of those is the only part of any of this that can
    converge on being right about *your* oven, because it is the only part
    that observes it -- a model can tell you what an air fryer usually needs,
    and only your kitchen can tell you that yours runs hot.

    ``equipment_id`` names which machine when the household owns more than one
    that can do the job. Two Instant Pots where only one has an air fry lid
    are not interchangeable, and picking whichever came back from the database
    first would silently rewrite a method for the wrong appliance.
    """
    from culinary.models import KitchenEquipment

    owned = db.query(KitchenEquipment).filter_by(household_id=household_id).all()
    if equipment_id:
        # Named machine first, and only that one -- falling back to a sibling
        # would answer a specific question with a different appliance.
        owned = [eq for eq in owned if eq.id == equipment_id]

    for eq in owned:
        types = _safe_json(eq.capabilities_json, None) or (
            [eq.equipment_type] if eq.equipment_type else [])
        if station not in types:
            continue

        profile = dict(_safe_json(eq.profile_json, {}) or {})
        profile.setdefault("make", eq.make or "")
        profile.setdefault("model", eq.model or "")

        # Only the recent past, and only what was worth writing down. A long
        # tail of "fine" tells a rewrite nothing it did not assume.
        history = _safe_json(eq.history_json, []) or []
        lessons = [h.get("note", "") for h in history[-6:]
                   if h.get("verdict") in ("longer", "shorter") and h.get("note")]
        if lessons:
            profile["notes"] = ((profile.get("notes", "") + " ") +
                                " ".join(lessons)).strip()
        return profile
    return None


class ApplianceOutcome(BaseModel):
    station: str
    #: spot_on | longer | shorter
    verdict: str
    note: Optional[str] = None
    recipe_title: Optional[str] = None


@router.post("/appliances/outcome")
async def record_appliance_outcome(
    body: ApplianceOutcome, request: Request, db: Session = Depends(get_db),
):
    """Record how an appliance actually behaved, after cooking.

    The answer to "how do we know the rewrite was right" is, in the end, that
    you cooked it and found out. Nothing before this point observes anything;
    this is the only place the system can learn that your air fryer runs hot,
    and it feeds straight back into the next rewrite for that machine.

    Deliberately three answers and an optional sentence. A form that asks for
    more than that after dinner does not get filled in.
    """
    from culinary.models import KitchenEquipment

    if body.verdict not in ("spot_on", "longer", "shorter"):
        raise bad_request("Verdict must be spot_on, longer or shorter.")

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    target = None
    for eq in db.query(KitchenEquipment).filter_by(household_id=hh.id).all():
        types = _safe_json(eq.capabilities_json, None) or (
            [eq.equipment_type] if eq.equipment_type else [])
        if body.station in types:
            target = eq
            break
    if not target:
        raise not_found("No appliance of that kind is recorded for this household.")

    history = _safe_json(target.history_json, []) or []
    history.append({
        "at": _now().isoformat(),
        "recipe": (body.recipe_title or "")[:120],
        "verdict": body.verdict,
        "note": (body.note or "")[:200],
    })
    # Bounded: this is a hint for a prompt, not an archive.
    target.history_json = json.dumps(history[-40:])
    db.commit()

    return {"status": "ok", "recorded": len(history)}


class ApplianceSwap(BaseModel):
    recipe_id: str
    #: A station key, or null to put the original method back.
    station: Optional[str] = None
    #: Which of the household's machines, when more than one can do the job.
    #: Two Instant Pots where one has an air fry lid are different appliances,
    #: and the rewrite has to be for the one actually being used.
    equipment_id: Optional[str] = None


@router.post("/prep/{session_id}/appliance-swap")
async def swap_appliance(
    session_id: str, body: ApplianceSwap, request: Request,
    db: Session = Depends(get_db),
):
    """Cook one of the staged recipes in something else, for this session only.

    This is the one place a model is genuinely required. Timing a step is
    parsing and scaling is arithmetic, but there is no rule that turns a
    skillet method into a Dutch oven one: the times are unrelated, a pressure
    cooker needs liquid the pan did not, and an air fryer wants a single layer
    and a shake halfway.

    A failure is returned as an error rather than absorbed, because there is
    no fallback worth having. Quietly handing back the skillet steps would
    tell the cook the Dutch oven works and then give them the wrong method.

    The saved recipe is never written to. Clearing the swap brings the
    original back because it was never gone.
    """
    from culinary.models import PrepSession, PrepSessionRecipe
    from providers.culinary.appliance_swap import (
        APPLIANCE_NAMES, SwapFailed, rewrite_for_appliance)
    from providers.culinary.cook_plan import analyse_steps

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    session = db.query(PrepSession).filter_by(
        id=session_id, household_id=hh.id).first()
    if not session:
        raise not_found("Prep session not found")

    entry = db.query(PrepSessionRecipe).filter_by(
        session_id=session.id, recipe_id=body.recipe_id).first()
    if not entry or not entry.recipe:
        raise not_found("That recipe is not staged in this session")

    if not body.station:
        entry.appliance_swap_json = None
        db.commit()
        await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
        return {"status": "reverted", "recipe_id": body.recipe_id}

    if body.station not in APPLIANCE_NAMES:
        raise bad_request(f"Unknown appliance: {body.station}")

    steps = normalise_steps(_safe_json(entry.recipe.steps_json, []))
    ingredients = _safe_json(
        entry.scaled_ingredients_json,
        None) or _safe_json(entry.recipe.ingredients_json, [])

    # Whatever the method mostly uses now, so the prompt can say what it is
    # converting from rather than guessing.
    facts = analyse_steps(steps)
    stations = [f.station for f in facts if f.station != "counter"]
    origin = max(set(stations), key=stations.count) if stations else "stove"

    profile = _appliance_profile(db, hh.id, body.station, body.equipment_id)

    try:
        swap = await rewrite_for_appliance(
            title=entry.recipe.title,
            steps=steps,
            ingredients=ingredients,
            origin_station=origin,
            target_station=body.station,
            profile=profile,
        )
    except SwapFailed as exc:
        raise bad_request(str(exc))

    # Which machine, not just which kind. Reopening the plan has to show the
    # appliance that was chosen, and a later replan has to rewrite for the
    # same one.
    swap["equipment_id"] = body.equipment_id or ""
    swap["equipment_label"] = (profile or {}).get("label", "")
    entry.appliance_swap_json = json.dumps(swap)
    db.commit()

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return {"status": "swapped", "recipe_id": body.recipe_id, **swap}


@router.post("/meal-cook", status_code=status.HTTP_201_CREATED)
async def start_meal_cook(
    body: MealCookStart, request: Request, db: Session = Depends(get_db)
):
    """Freeze a plan and start cooking it.

    Like the single-recipe session, starting a second one ends the first: the
    kitchen screen shows one meal, and two live plans would fight over it.
    """
    from culinary.models import MealCook, PrepSession

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)

    if body.prep_session_id:
        session = db.query(PrepSession).filter_by(
            id=body.prep_session_id, household_id=hh.id).first()
    else:
        session = db.query(PrepSession).filter_by(
            household_id=hh.id, is_active=True).first()
    if not session:
        raise not_found("No prep session to cook")

    plan = _plan_for_prep_session(db, hh, session, body.courses)
    if not plan["steps"]:
        raise not_found("Nothing staged has any steps to cook")

    for previous in db.query(MealCook).filter_by(
            household_id=hh.id, is_active=True).all():
        previous.is_active = False
        previous.ended_at = _now()

    serve_at = None
    if body.serve_at:
        try:
            serve_at = datetime.fromisoformat(body.serve_at.replace("Z", "+00:00"))
        except ValueError as e:
            from core.errors import bad_request
            raise bad_request("Could not parse serve_at as a valid ISO datetime") from e

    cook = MealCook(
        household_id=hh.id,
        prep_session_id=session.id,
        label=body.label or session.label,
        serve_at=serve_at,
        plan_json=json.dumps(plan),
        done_steps_json="[]",
        started_by=uid,
    )
    db.add(cook)
    db.commit()
    db.refresh(cook)

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return _meal_cook_out(cook, _live_timers(db, cook.id))


def _live_timers(db: Session, cook_id: str) -> List[Any]:
    """Timers still worth showing: running, paused, or ringing unacknowledged."""
    from culinary.models import MealTimer

    return db.query(MealTimer).filter(
        MealTimer.cook_id == cook_id,
        MealTimer.stopped_at.is_(None),
    ).order_by(MealTimer.created_at.asc()).all()


class TimerStart(BaseModel):
    step_key: str
    seconds: int
    label: Optional[str] = None


class TimerAction(BaseModel):
    #: pause | resume | extend
    action: str
    seconds: int = 60


@router.post("/meal-cook/{cook_id}/timers", status_code=status.HTTP_201_CREATED)
async def start_meal_timer(
    cook_id: str, body: TimerStart, request: Request,
    db: Session = Depends(get_db)
):
    """Start a timer for one step.

    Offered per step rather than started automatically. A step that says
    "3-5 minutes per side, until golden" is judged by looking, and an alarm
    that implies otherwise is worse than no alarm -- so the cook decides which
    steps get one.
    """
    from culinary.models import MealCook, MealTimer

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    cook = db.query(MealCook).filter_by(id=cook_id, household_id=hh.id).first()
    if not cook or not cook.is_active:
        raise not_found("That meal is not being cooked")

    seconds = max(1, min(int(body.seconds), _MAX_TIMER_SECONDS))
    timer = MealTimer(
        cook_id=cook.id,
        step_key=body.step_key,
        label=body.label or "Timer",
        ends_at=_now() + timedelta(seconds=seconds),
    )
    db.add(timer)
    db.commit()
    db.refresh(timer)

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return _timer_out(timer)


@router.patch("/meal-cook/timers/{timer_id}")
async def adjust_meal_timer(
    timer_id: str, body: TimerAction, request: Request,
    db: Session = Depends(get_db)
):
    """Pause, resume, or add time.

    Pausing converts the deadline into the seconds left; resuming converts it
    back. Only one of the two is ever set, so there is no state where both
    disagree about how long is left.
    """
    from culinary.models import MealCook, MealTimer

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    timer = db.query(MealTimer).join(
        MealCook, MealCook.id == MealTimer.cook_id).filter(
        MealTimer.id == timer_id, MealCook.household_id == hh.id).first()
    if not timer:
        raise not_found("Timer not found")

    if body.action == "pause" and timer.ends_at:
        left = int((_as_utc(timer.ends_at) - _now()).total_seconds())
        timer.paused_seconds = max(0, left)
        timer.ends_at = None
    elif body.action == "resume" and timer.paused_seconds is not None:
        timer.ends_at = _now() + timedelta(seconds=timer.paused_seconds)
        timer.paused_seconds = None
    elif body.action == "extend":
        bump = max(1, min(int(body.seconds), _MAX_TIMER_SECONDS))
        if timer.paused_seconds is not None:
            timer.paused_seconds += bump
        else:
            # Extending a timer that has already rung starts from now rather
            # than from a deadline in the past, which is what "one more
            # minute" means when you have just looked in the oven.
            base = max(_as_utc(timer.ends_at) if timer.ends_at else _now(), _now())
            timer.ends_at = base + timedelta(seconds=bump)
    else:
        raise bad_request("Unknown timer action")

    db.commit()
    db.refresh(timer)
    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return _timer_out(timer)


@router.delete("/meal-cook/timers/{timer_id}", status_code=204)
async def stop_meal_timer(
    timer_id: str, request: Request, db: Session = Depends(get_db)
):
    """Acknowledge a timer, whether it has rung or not.

    Marked stopped rather than deleted so an alarm that has been silenced on
    one phone does not start ringing again on the next one to open the page.
    """
    from culinary.models import MealCook, MealTimer

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    timer = db.query(MealTimer).join(
        MealCook, MealCook.id == MealTimer.cook_id).filter(
        MealTimer.id == timer_id, MealCook.household_id == hh.id).first()
    if timer:
        timer.stopped_at = _now()
        db.commit()
        await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})


@router.get("/meal-cook")
async def active_meal_cook(request: Request, db: Session = Depends(get_db)):
    """The household's meal in progress, or `{"cook": null}`."""
    from culinary.models import MealCook

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    cook = db.query(MealCook).filter_by(
        household_id=hh.id, is_active=True).order_by(
        MealCook.created_at.desc()).first()
    return {"cook": _meal_cook_out(cook, _live_timers(db, cook.id)) if cook else None}


@router.post("/meal-cook/{cook_id}/step")
async def mark_meal_step(
    cook_id: str, body: MealStepDone, request: Request,
    db: Session = Depends(get_db)
):
    """Tick a step off, or un-tick it.

    Keyed rather than indexed: steps interleave across recipes, so there is no
    single position to advance. Two people cooking together also do not go in
    the same order, and the broadcast is what keeps their screens agreeing.
    """
    from culinary.models import MealCook

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    cook = db.query(MealCook).filter_by(id=cook_id, household_id=hh.id).first()
    if not cook or not cook.is_active:
        raise not_found("That meal is not being cooked")

    done = set(_safe_json(cook.done_steps_json, []))
    plan = _safe_json(cook.plan_json, {})
    # Mise en place lines are ticked the same way steps are -- measuring the
    # paprika out is a thing you finish, and on a shared list it wants to be
    # visible to whoever is doing the other half of the prep.
    known = {s["key"] for s in plan.get("steps", [])}
    for r in plan.get("recipes", []):
        known.update(i["key"] for i in r.get("ingredients", []))
    if body.key not in known:
        raise not_found("No such step in this plan")

    done.add(body.key) if body.done else done.discard(body.key)
    cook.done_steps_json = json.dumps(sorted(done))
    db.commit()

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return {"done": sorted(done)}


class MealServeTime(BaseModel):
    serve_at: Optional[str] = None


@router.patch("/meal-cook/{cook_id}")
async def set_meal_serve_time(
    cook_id: str, body: MealServeTime, request: Request,
    db: Session = Depends(get_db)
):
    """Move the serve time of a meal already in progress.

    Separate from starting because running late is the normal case, not an
    error. The plan is stored as offsets, so changing this re-labels every row
    at once and never reshuffles the order -- what was true about which dish
    goes in when does not stop being true because dinner slipped half an hour.
    """
    from culinary.models import MealCook

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    cook = db.query(MealCook).filter_by(id=cook_id, household_id=hh.id).first()
    if not cook or not cook.is_active:
        raise not_found("That meal is not being cooked")

    if body.serve_at:
        try:
            cook.serve_at = datetime.fromisoformat(
                body.serve_at.replace("Z", "+00:00"))
        except ValueError as e:
            from core.errors import bad_request
            raise bad_request("Could not parse serve_at as a valid ISO datetime") from e
    else:
        cook.serve_at = None
    db.commit()

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return _meal_cook_out(cook, _live_timers(db, cook.id))


@router.post("/meal-cook/{cook_id}/end")
async def end_meal_cook(
    cook_id: str, request: Request, db: Session = Depends(get_db)
):
    from culinary.models import MealCook

    uid = await _get_user_id(request)
    hh = _get_household(db, uid)
    cook = db.query(MealCook).filter_by(id=cook_id, household_id=hh.id).first()
    if not cook:
        raise not_found("Meal not found")
    cook.is_active = False
    cook.ended_at = _now()
    db.commit()

    await _ws_manager.broadcast(hh.id, "meal_cook_updated", {})
    return {"status": "ok"}
