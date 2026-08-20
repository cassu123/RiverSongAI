"""
api/routes/home.py

Home Assistant proxy endpoints for the Home Node page.

GET  /api/home/status          -- HA configured + reachable check
GET  /api/home/devices         -- filtered state list (lights, switches, scenes, etc.)
POST /api/home/action          -- call a HA service (toggle, turn_on, turn_off, etc.)
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from config.settings import get_settings
from core.auth import decode_token
from core.home_triggers import parse_hhmm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/home", tags=["home"])

VISIBLE_DOMAINS = {
    "light",
    "switch",
    "fan",
    "cover",
    "lock",
    "climate",
    "scene",
    "script",
    "input_boolean",
    "media_player",
    "sensor",
    "binary_sensor"
}

async def _require_admin(authorization: Optional[str]) -> str:
    """Caller must be an admin. Used where an action reaches other people.

    The trigger bus is process-wide and the evaluator loads every enabled
    routine in the database, not just the caller's, so a synthetic event is
    not a private thing — it lands on whoever those rules belong to.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only.")
    return payload["sub"]


async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.")
    return payload["sub"]

def _get_client():
    from providers.smart_home.home_assistant import HomeAssistantClient
    s = get_settings()
    return HomeAssistantClient(
        base_url=s.home_assistant_url, token=s.home_assistant_token)

def _is_configured() -> bool:
    s = get_settings()
    return bool(s.home_assistant_token and s.home_assistant_token.strip())

@router.get("/status")
async def get_status(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return {"configured": False, "reachable": False}
    try:
        client = _get_client()
        reachable = await client.ping()
        await client.close()
        return {"configured": True, "reachable": reachable}
    except Exception as e:
        logger.warning("HA ping failed: %s", e)
        return {"configured": True, "reachable": False}

def _shape_device(state: dict) -> dict:
    """Reduce one raw HA state object to the shape clients render from."""
    domain = state["entity_id"].split(".")[0]
    attrs = state.get("attributes", {})
    device_info = {
        "entity_id": state["entity_id"],
        "domain": domain,
        "state": state["state"],
        "name": attrs.get("friendly_name", state["entity_id"]),
        "brightness": attrs.get("brightness"),
        "temperature": attrs.get("temperature"),
        "current_temp": attrs.get("current_temperature"),
    }
    if domain in ("sensor", "binary_sensor"):
        device_info["unit"] = attrs.get("unit_of_measurement")
        device_info["device_class"] = attrs.get("device_class")
    if domain == "media_player":
        device_info["media_title"] = attrs.get("media_title")
        device_info["app_name"] = attrs.get("app_name")
        device_info["volume_level"] = attrs.get("volume_level")
    return device_info


async def _entity_meta() -> dict:
    """entity_id -> {area, hidden} from the synced ha_entities table.

    Home Assistant is the single source of truth for which room a device is
    in, but the raw state objects it returns over REST carry no area at all --
    areas live in the entity/device/area registries, which is what the sync
    job pulls into ha_entities. Without this join the Home page can only group
    by domain, which is how it ended up listing every light in the house
    together regardless of which room they are in.

    Returns an empty map on any failure, so the page degrades to ungrouped
    devices rather than an error.
    """
    try:
        from main import get_app
        app = get_app()
        if not app:
            return {}
        store = app.state.memory_manager._store
        rows = await store.execute_read_async(
            "SELECT entity_id, area, hidden FROM ha_entities")
        return {
            r["entity_id"]: {"area": r["area"], "hidden": bool(r["hidden"])}
            for r in rows
        }
    except Exception as e:
        logger.warning("ha_entities lookup failed, areas unavailable: %s", e)
        return {}


async def collect_devices(include_hidden: bool = False) -> list:
    """
    Fetch and shape the household's controllable entities.

    Shared by GET /api/home/devices and the River Vortex replica, so a unit's
    device grid and the web UI render from byte-identical data and neither
    needs Home Assistant credentials of its own (Vortex invariant 3).

    Each device carries the `area` it belongs to, and entities the owner
    hid via PATCH /api/home/entities/{id} are dropped unless asked for.
    """
    if not _is_configured():
        return []
    try:
        client = _get_client()
        all_states = await client.get_all_states()
        await client.close()
        meta = await _entity_meta()
        out = []
        for s in all_states:
            if s["entity_id"].split(".")[0] not in VISIBLE_DOMAINS:
                continue
            m = meta.get(s["entity_id"], {})
            if m.get("hidden") and not include_hidden:
                continue
            d = _shape_device(s)
            d["area"] = m.get("area")
            out.append(d)
        return out
    except Exception as e:
        logger.error("HA collect_devices failed: %s", e)
        return []


async def collect_raw_states() -> list:
    """Raw HA states, for callers that need domains outside VISIBLE_DOMAINS."""
    if not _is_configured():
        return []
    try:
        client = _get_client()
        states = await client.get_all_states()
        await client.close()
        return states
    except Exception as e:
        logger.error("HA collect_raw_states failed: %s", e)
        return []


@router.get("/devices")
async def get_devices(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    return await collect_devices()


class ActionBody(BaseModel):
    # `action` is passed straight through as the Home Assistant service name,
    # so anything the entity's domain exposes works: turn_on/turn_off/toggle,
    # lock/unlock, open_cover/close_cover/stop_cover, media_play/media_pause/
    # media_next_track, volume_set, set_temperature.
    entity_id: str
    action: str
    brightness_pct: int | None = None
    temperature: float | None = None
    volume_level: float | None = None   # media_player.volume_set, 0.0-1.0


@router.post("/action")
async def call_action(body: ActionBody,
                      authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return {"ok": False, "detail": "Home Assistant not configured."}
    try:
        client = _get_client()
        domain = body.entity_id.split(".")[0]
        service = body.action
        kwargs: dict = {"entity_id": body.entity_id}
        if body.brightness_pct is not None:
            kwargs["brightness_pct"] = body.brightness_pct
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if body.volume_level is not None:
            kwargs["volume_level"] = max(0.0, min(1.0, body.volume_level))
        if domain == "scene":
            service = "turn_on"
        await client.call_service(domain, service, **kwargs)
        await client.close()
        return {"ok": True}
    except Exception as e:
        logger.error("HA action failed: %s", e)
        return {"ok": False, "detail": str(e)}

@router.post("/sync")
async def sync_home(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    if not _is_configured():
        return {"ok": False, "detail": "Home Assistant not configured."}
    from providers.smart_home.sync import sync_ha_entities
    count = await sync_ha_entities()
    return {"ok": True, "count": count}

class EntityPatch(BaseModel):
    aliases: Optional[list[str]] = None
    hidden: Optional[bool] = None

@router.patch("/entities/{entity_id}")
async def patch_entity(
    entity_id: str,
    body: EntityPatch,
    authorization: Optional[str] = Header(default=None)
):
    await _require_user(authorization)
    from main import get_app
    app = get_app()
    if not app:
        return {"ok": False, "detail": "No app context."}
    store = app.state.memory_manager._store
    
    # We allow updating aliases and hidden flag
    import json
    updates = []
    params = []
    if body.aliases is not None:
        updates.append("aliases = ?")
        params.append(json.dumps(body.aliases))
    if body.hidden is not None:
        updates.append("hidden = ?")
        params.append(1 if body.hidden else 0)
        
    if not updates:
        return {"ok": True}
        
    params.append(entity_id)
    set_clause = ", ".join(updates)
    await store.execute_write_async(f"UPDATE ha_entities SET {set_clause} WHERE entity_id = ?", tuple(params))
    return {"ok": True}

@router.get("/rooms")
async def get_rooms(authorization: Optional[str] = Header(default=None)):
    await _require_user(authorization)
    from main import get_app
    app = get_app()
    if not app or not hasattr(app.state, "context_engine"):
        return {}
    
    ctx = app.state.context_engine
    return ctx.get_rooms()

from fastapi.responses import StreamingResponse
import asyncio
from core.home_events import get_home_bus

@router.get("/stream")
async def stream_home_events(request: Request):
    """Authenticated by the session cookie, never by a token in the URL.

    EventSource cannot set headers, and the previous answer was ?token=,
    which puts a bearer token into server logs, proxy logs and browser
    history. The stream is same-origin, so the access_token cookie login
    already sets travels with it. useWebSocket.js reached the same
    conclusion for the socket: "Never fall back to ?token= — it leaks."
    """
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=401,
            detail="No session cookie. Sign in again to receive live updates.")
    payload = await decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    if not _is_configured():
        raise HTTPException(status_code=400, detail="HA not configured")

    async def event_generator():
        # Bounded so a stalled client cannot grow the queue without limit.
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)

        async def _on_event(entity_id: str, new_state: dict, old_state: dict):
            try:
                # Send the same shape GET /devices returns, not Home
                # Assistant's raw state object. The raw object nests the
                # state string under a "state" key alongside attributes, so
                # clients merging it straight onto a device replaced the
                # state string with a dict -- every live event turned the
                # card's state into an object and isOn() went false.
                # `area` is deliberately absent: the client already has it
                # and a spread merge keeps its copy.
                payload = {"entity_id": entity_id, "state": new_state.get("state")}
                try:
                    payload["device"] = _shape_device(new_state)
                except Exception:
                    pass
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                logger.warning(
                    "Home event stream queue full; dropping event for %s",
                    entity_id)
            
        bus = get_home_bus()
        bus.subscribe(_on_event)
        
        try:
            yield "data: {\"type\": \"connected\"}\n\n"
            while True:
                event = await queue.get()
                import json
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            bus.unsubscribe(_on_event)

    return StreamingResponse(event_generator(), media_type="text/event-stream")



# ---------------------------------------------------------------------------
# Device triggers — the safety pack and anything authored on top of it.
#
# These live here rather than under /api/routines because they are what the
# Home page shows and edits; a routine with trigger="device" is the same row
# either way.
# ---------------------------------------------------------------------------

def _rule_view(r: dict) -> dict:
    """A trigger routine as the Home settings section renders it."""
    cfg = r.get("trigger_config") or {}
    return {
        "id": r["id"],
        "name": r["name"],
        "enabled": bool(r.get("enabled")),
        "builtin": bool(r.get("builtin")),
        "severity": r.get("severity") or "info",
        "watches": {
            "entity_id": cfg.get("entity_id"),
            "area": cfg.get("area"),
            "device_class": cfg.get("device_class"),
            "domain": cfg.get("domain"),
            "to_state": cfg.get("to_state"),
        },
        "for_seconds": cfg.get("for_seconds") or 0,
        "time_window": cfg.get("time_window"),
        "last_run": r.get("last_run"),
    }


@router.get("/triggers")
async def list_triggers(request: Request,
                        authorization: Optional[str] = Header(default=None)):
    """Every device-triggered rule for this user, builtin ones included."""
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    rows = await store.list_routines(user_id)
    return [_rule_view(r) for r in rows if r.get("trigger") == "device"]


class TriggerPatch(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[str] = None
    for_seconds: Optional[float] = None
    time_window: Optional[dict] = None


@router.patch("/triggers/{rule_id}")
async def patch_trigger(rule_id: str, body: TriggerPatch, request: Request,
                        authorization: Optional[str] = Header(default=None)):
    """Mute a rule, or retune its hold time / quiet window.

    The selectors themselves are not editable here: a builtin's whole point is
    that it watches a device_class rather than a device someone has to pick.
    """
    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store
    current = next((r for r in await store.list_routines(user_id)
                    if r["id"] == rule_id), None)
    if not current:
        raise HTTPException(status_code=404, detail="Rule not found.")

    fields: dict = {}
    if body.enabled is not None:
        fields["enabled"] = body.enabled
    if body.severity is not None:
        if body.severity not in ("info", "warning", "critical"):
            raise HTTPException(status_code=400, detail="Unknown severity.")
        fields["severity"] = body.severity

    cfg = dict(current.get("trigger_config") or {})
    if body.for_seconds is not None:
        cfg["for_seconds"] = max(0.0, float(body.for_seconds))
    if body.time_window is not None:
        # An unparseable edge makes in_time_window() return True, which turns
        # a night-only rule into an all-day one with nothing said. Refuse it.
        if body.time_window:
            for edge in ("start", "end"):
                if parse_hhmm(str(body.time_window.get(edge, ""))) is None:
                    raise HTTPException(
                        status_code=400,
                        detail=f"time_window.{edge} must be HH:MM.")
        cfg["time_window"] = body.time_window or None
    if body.for_seconds is not None or body.time_window is not None:
        fields["trigger_config"] = cfg

    if not fields:
        return _rule_view(current)
    updated = await store.update_routine(rule_id, user_id, fields)
    return _rule_view(updated or current)


class TriggerTest(BaseModel):
    entity_id: str
    state: str
    device_class: Optional[str] = None
    area: Optional[str] = None
    friendly_name: Optional[str] = None
    # False: report what would happen and change nothing. True: put the event
    # on the bus for real, so delivery — push, TTS, quiet hours — is exercised.
    deliver: bool = False


@router.post("/triggers/test")
async def test_trigger(body: TriggerTest, request: Request,
                       authorization: Optional[str] = Header(default=None)):
    """Answer "would this fire, and why" without staging the real condition.

    Checking the leak alarm should not require wetting a floor. The synthetic
    event has the same shape Home Assistant sends, so a dry run exercises the
    real selectors and the real clock, and `deliver` exercises the real
    delivery path on top.
    """
    import zoneinfo
    from datetime import datetime
    from core.home_triggers import explain

    user_id = await _require_user(authorization)
    store = request.app.state.memory_manager._store

    attrs: dict = {"friendly_name": body.friendly_name or body.entity_id}
    if body.device_class:
        attrs["device_class"] = body.device_class
    new_state = {"entity_id": body.entity_id, "state": body.state,
                 "attributes": attrs}

    area = body.area
    if area is None:
        try:
            row = await store.execute_read_one_async(
                "SELECT area FROM ha_entities WHERE entity_id = ?",
                (body.entity_id,))
            area = row["area"] if row else None
        except Exception:
            area = None

    try:
        settings = await store.get_llm_settings(user_id)
        tz_name = (settings.get("timezone") if isinstance(settings, dict)
                   else getattr(settings, "timezone", None)) or "UTC"
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")
    now_local = datetime.now(tz)

    results = []
    for r in await store.list_routines(user_id):
        if r.get("trigger") != "device":
            continue
        verdict = explain(r.get("trigger_config") or {}, body.entity_id,
                          new_state, area, now_local)
        if not r.get("enabled"):
            verdict = {"would_fire": False, "reason": "rule is muted"}
        results.append({"id": r["id"], "name": r["name"], **verdict})

    delivered = False
    if body.deliver:
        # Emitting reaches every user's rules and their push targets, so a
        # non-admin must not be able to send the household a critical "Smoke
        # detected". Dry runs above stay open to anyone — they fire nothing.
        await _require_admin(authorization)
        # The real path: onto the bus, through the evaluator, out via the
        # DeliveryRouter. Quiet hours and cooldowns apply exactly as they
        # would at three in the morning.
        from core.home_events import get_home_bus
        old_state = {"entity_id": body.entity_id, "state": "__test_previous__",
                     "attributes": attrs}
        await get_home_bus().emit(body.entity_id, new_state, old_state)
        delivered = True

    return {
        "entity_id": body.entity_id,
        "state": body.state,
        "area": area,
        "local_time": now_local.strftime("%H:%M"),
        "delivered": delivered,
        "rules": results,
        "would_fire": [r["name"] for r in results if r.get("would_fire")],
    }
