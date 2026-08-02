"""
core/vortex_actions.py

Everything a River Vortex unit can ask this server to *do*.

Three entry points, one permission model:

    execute_home_action    a tapped light switch on the device grid
    run_surface_action     a tapped button on a card
    resolve_confirmation   a second factor typed on the touchscreen

All three go through `core.intent_router.evaluate_device_request` with a
unit-kind origin, which means the Vortex hard deny applies to a tapped button
exactly as it does to a spoken command. A confirm card on a wall panel is a
prompt, not an authorisation — the unit relays what was tapped and this server
decides, every time, from scratch.

Return shape is uniform so the device never has to guess:

    {"status": "ok" | "denied" | "pending_confirmation" | "error",
     "message": "...",                 # safe to speak
     "challenge_id": "..."}            # pending_confirmation only
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.intent_router import (
    ORIGIN_VORTEX_UNIT,
    RequestOrigin,
    evaluate_device_request,
    origin_scope,
)

logger = logging.getLogger(__name__)

STATUS_OK = "ok"
STATUS_DENIED = "denied"
STATUS_PENDING = "pending_confirmation"
STATUS_ERROR = "error"


async def origin_for_unit(unit_id: str) -> RequestOrigin:
    """
    Build a request origin from what *this server* knows about a unit.

    Room and display capability come from the stored profile, never from the
    request body — a unit does not get to describe itself into a different
    permission set.
    """
    from core.vortex_units import get_profile

    profile = await get_profile(unit_id) or {}
    return RequestOrigin(
        kind=ORIGIN_VORTEX_UNIT,
        unit_id=unit_id,
        room=profile.get("room") or None,
        has_display=bool(profile.get("has_display", True)),
    )


def _ok(message: str, **extra: Any) -> Dict[str, Any]:
    return {"status": STATUS_OK, "message": message, **extra}


def _denied(message: str, reason: str = "") -> Dict[str, Any]:
    return {"status": STATUS_DENIED, "message": message, "reason": reason}


def _error(message: str) -> Dict[str, Any]:
    return {"status": STATUS_ERROR, "message": message}


# ---------------------------------------------------------------------------
# Device control
# ---------------------------------------------------------------------------

async def execute_home_action(
    *,
    user_id: str,
    entity_id: str,
    action: str,
    value: Optional[int] = None,
    unit_id: Optional[str] = None,
    origin: Optional[RequestOrigin] = None,
    device_name: str = "",
) -> Dict[str, Any]:
    """
    Run one Home Assistant action on behalf of a unit.

    Args:
        user_id: Resolved owner of the unit. Never supplied by the device.
        entity_id: HA entity, e.g. "light.kitchen".
        action: toggle | turn_on | turn_off | set_brightness | set_temperature
            | open | close | dim | brighten | activate.
        value: Brightness percent, temperature, or position, per action.
        unit_id: Relaying unit, for logging and confirmation targeting.
        origin: Overrides the origin derived from unit_id.

    Returns:
        A uniform status dict. Nothing is executed on `denied` or
        `pending_confirmation`.
    """
    if origin is None and unit_id:
        origin = await origin_for_unit(unit_id)

    decision = evaluate_device_request(
        action=action, entity_id=entity_id, device_name=device_name,
        origin=origin,
    )
    if decision.denied:
        return _denied(decision.message, decision.reason)

    if decision.needs_confirmation:
        from core.vortex_security import confirmations

        pending = await confirmations.create(
            user_id=user_id,
            unit_id=unit_id,
            action="home_action",
            description=f"{action.replace('_', ' ')} {device_name or entity_id}",
            payload={"entity_ids": [entity_id], "action": action,
                     "value": value, "device_name": device_name or entity_id},
        )
        return {
            "status": STATUS_PENDING,
            "message": decision.message,
            "challenge_id": pending.challenge_id,
            "description": pending.description,
        }

    return await _run_home_action([entity_id], action, value,
                                  device_name or entity_id, user_id)


async def _run_home_action(entity_ids: List[str], action: str,
                           value: Optional[int], label: str,
                           user_id: str) -> Dict[str, Any]:
    """Execute an already-authorised action and refresh the replica."""
    try:
        from providers.smart_home.home_assistant import build_ha_client

        async with build_ha_client() as client:
            if len(entity_ids) == 1:
                ok = await client.execute_action(entity_ids[0], action, value)
            else:
                ok = await client.execute_action_on_many(entity_ids, action, value)
    except Exception as exc:
        logger.error("Vortex home action failed (%s on %s): %s",
                     action, entity_ids, exc)
        return _error("I couldn't reach Home Assistant just then.")

    if not ok:
        return _error(f"Home Assistant refused to {action.replace('_', ' ')} "
                      f"the {label}.")

    # Device state just moved; get the change onto every screen rather than
    # waiting for the next poll.
    try:
        from core.vortex_replica import get_replica_service

        service = get_replica_service()
        service.invalidate(user_id)
        await service.push_updates(user_id, ["devices"])
    except Exception as exc:
        logger.debug("Replica push after action failed: %s", exc)

    from core.intent_router import _build_confirmation
    return _ok(_build_confirmation(action, label, value))


# ---------------------------------------------------------------------------
# Surface actions
# ---------------------------------------------------------------------------

async def run_surface_action(*, surface_id: str, intent: str, unit_id: str,
                             user_id: str) -> Dict[str, Any]:
    """
    Handle a button tapped on a card.

    The unit relays the tapped button verbatim and never interprets it. The
    intent is re-run here with the same checks as a voice command, including
    the hard deny, because the card that offered the button proves nothing
    about whether the action is still permitted or still makes sense.

    Recognised intent forms:
        confirm:<challenge_id>         a confirm card's primary button
        cancel:<challenge_id>          its secondary button
        surface.dismiss.<surface_id>   take this card down
        <domain>.<service>.<name>      e.g. cover.close.garage
        anything else                  routed as if it had been spoken
    """
    origin = await origin_for_unit(unit_id)
    intent = (intent or "").strip()
    if not intent:
        return _error("That button had no action attached.")

    logger.info("Surface action from unit %s: surface='%s' intent='%s'",
                unit_id, surface_id, intent)

    if intent.startswith("cancel:"):
        from core.vortex_security import confirmations
        await confirmations.consume(intent.split(":", 1)[1])
        await _withdraw(surface_id, unit_id)
        return _ok("Cancelled.")

    if intent.startswith("confirm:"):
        # The confirm card's button on its own is not a second factor. The
        # code typed on the screen is, and it arrives at /api/vortex/confirm.
        return {
            "status": STATUS_PENDING,
            "message": "Enter your code on the screen to continue.",
            "challenge_id": intent.split(":", 1)[1],
        }

    if intent.startswith("surface.dismiss."):
        await _withdraw(intent.split(".", 2)[2] or surface_id, unit_id)
        return _ok("Dismissed.")

    if intent.startswith("call.answer.") or intent.startswith("call.decline."):
        return await _handle_call_button(intent, surface_id, unit_id)

    parsed = _parse_entity_intent(intent)
    if parsed is not None:
        entity_id, action, name = parsed
        result = await execute_home_action(
            user_id=user_id, entity_id=entity_id, action=action,
            unit_id=unit_id, origin=origin, device_name=name,
        )
        if result["status"] == STATUS_OK:
            await _withdraw(surface_id, unit_id)
        return result

    # Free-form intent: route it exactly as if the user had said it.
    try:
        from core.intent_router import get_intent_router

        with origin_scope(origin):
            _, spoken = await get_intent_router().route(intent, user_id, origin)
        return _ok(spoken or "Done.")
    except Exception as exc:
        logger.error("Surface action routing failed for '%s': %s", intent, exc)
        return _error("I couldn't carry that out.")


async def _handle_call_button(intent: str, surface_id: str,
                              unit_id: str) -> Dict[str, Any]:
    """
    Answer or decline from the ringing card on a wall panel.

    Routed through the same registry as a tapped answer in the app or a
    `call_answer` frame over the socket, so however someone picks up, one code
    path decides whether they may.
    """
    from core.vortex_calls import get_call_registry, participant_id

    action, _, call_id = intent.partition("call.")[2].partition(".")
    registry = get_call_registry()
    address = participant_id(unit_id=unit_id)

    if action == "answer":
        call, error = await registry.answer(call_id, address)
        if call is None:
            await _withdraw(surface_id, unit_id)
            return _denied(error, "call_unavailable")
        await _withdraw(surface_id, unit_id)
        return _ok("Connecting.", call_id=call_id)

    call = registry.get(call_id)
    if call is not None:
        await registry.end(call_id, reason="declined", by=address)
    await _withdraw(surface_id, unit_id)
    return _ok("Declined.")


def _parse_entity_intent(intent: str) -> Optional[tuple]:
    """
    Parse `domain.service.name` into (entity_id, action, friendly_name).

    Returns None when the intent is not in that form, so the caller can fall
    back to routing it as natural language.
    """
    parts = intent.split(".")
    if len(parts) < 3:
        return None
    domain, service = parts[0], parts[1]
    name = ".".join(parts[2:])
    if not domain.isidentifier() or not service:
        return None
    entity_id = f"{domain}.{name.replace(' ', '_').replace('.', '_')}"
    action = _SERVICE_TO_ACTION.get(service, service)
    return entity_id, action, name.replace("_", " ")


_SERVICE_TO_ACTION = {
    "on": "turn_on",
    "off": "turn_off",
    "turn_on": "turn_on",
    "turn_off": "turn_off",
    "toggle": "toggle",
    "open": "open",
    "close": "close",
    "activate": "activate",
    "brightness": "set_brightness",
    "temperature": "set_temperature",
}


async def _withdraw(surface_id: str, unit_id: str) -> None:
    from core.vortex_surfaces import get_surface_publisher
    try:
        await get_surface_publisher().withdraw(surface_id, [unit_id])
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("Could not withdraw surface '%s': %s", surface_id, exc)


# ---------------------------------------------------------------------------
# Confirmations
# ---------------------------------------------------------------------------

async def resolve_confirmation(*, challenge_id: str, code: str,
                               unit_id: str) -> Dict[str, Any]:
    """
    Redeem a pending confirmation with a second factor typed on the screen.

    The code must have been entered on the unit's touchscreen. A spoken PIN
    travels the same channel as the voice that triggered the action and is
    audible to the whole room, so it adds no factor at all — this endpoint is
    reachable only over HTTP from the unit, never from a transcript.

    The challenge is consumed on success and on running out of attempts, so a
    given challenge id executes at most one action.
    """
    from core.vortex_security import confirmations, verify_second_factor

    pending = await confirmations.peek(challenge_id)
    if pending is None:
        return _denied("That confirmation has expired. Ask me again.",
                       "unknown_challenge")

    if pending.unit_id and pending.unit_id != unit_id:
        # The confirmation belongs to a different screen. Refusing keeps a
        # second unit from redeeming a prompt the user never saw there.
        logger.warning(
            "Unit %s tried to redeem confirmation %s belonging to unit %s.",
            unit_id, challenge_id, pending.unit_id,
        )
        return _denied("That confirmation belongs to a different screen.",
                       "wrong_unit")

    if not await verify_second_factor(pending.user_id, code):
        still_live = await confirmations.record_attempt(challenge_id)
        message = ("That code didn't match." if still_live
                   else "Too many attempts. Ask me again.")
        return _denied(message, "bad_second_factor")

    await confirmations.consume(challenge_id)
    await _withdraw(f"confirm:{challenge_id}", unit_id)

    payload = pending.payload
    origin = await origin_for_unit(unit_id)

    # Re-check the permission decision at execution time. The hard deny is not
    # something a confirmation can buy past, and the entity may have changed
    # since the challenge was minted.
    for entity_id in payload.get("entity_ids", []):
        decision = evaluate_device_request(
            action=payload.get("action", ""), entity_id=entity_id,
            device_name=payload.get("device_name", ""), origin=origin,
        )
        if decision.denied:
            return _denied(decision.message, decision.reason)

    logger.info("Confirmation %s redeemed on unit %s: %s",
                challenge_id, unit_id, pending.description)

    return await _run_home_action(
        payload.get("entity_ids", []),
        payload.get("action", ""),
        payload.get("value"),
        payload.get("device_name", ""),
        pending.user_id,
    )
