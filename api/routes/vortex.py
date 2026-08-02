"""
api/routes/vortex.py

The River Vortex device-facing API — the server half of the contract the Pi
units are already built against.

Vortex units are thin clients. They render and they listen; nothing on them
recognises intent, holds a Home Assistant credential, or decides whether an
action is permitted. Every one of those decisions is taken here.

Surface built by this module (fleet.py owns /register, /heartbeat, /telemetry,
/alerts and the /commands poll under the same prefix):

  Pairing — a fresh unit has no token:
    POST   /api/vortex/pair/request     unit posts a code + metadata  (open)
    GET    /api/vortex/pair/status      unit polls for its token      (open)
    POST   /api/vortex/pair/approve     a logged-in user adopts it    (JWT)
    GET    /api/vortex/pair/pending     what is waiting for approval  (JWT)

  Live channel:
    WS     /api/vortex/ws               one authenticated socket per unit

  Local copy:
    GET    /api/vortex/replica          devices, rooms, weather, wake word

  Screens:
    GET    /api/vortex/v1/surfaces      cards for the calling unit
    POST   /api/vortex/v1/surfaces      publish a card                (JWT)
    DELETE /api/vortex/v1/surfaces/{id} withdraw a card               (JWT)
    POST   /api/vortex/v1/surface-action  a tapped button             (unit)

  Actions:
    POST   /api/vortex/devices/toggle   device grid tap               (unit)
    POST   /api/vortex/devices/control  brightness, temperature, etc. (unit)
    POST   /api/vortex/confirm          second factor from the screen (unit)

  Voice:
    POST   /api/vortex/tts              synthesize in River's voice   (unit)

  Cameras:
    GET    /api/vortex/camera/{id}/snapshot   proxied HA snapshot     (unit)
    POST   /api/vortex/camera/frames    frames for identification     (unit)
    POST   /api/vortex/camera/snapshot  a motion snapshot from a unit (unit)

Unit-authenticated routes take `X-Unit-Token` and are checked with
`hmac.compare_digest` against a hashed-at-rest token. None of them accept a
`user_id`: the owner is resolved from the pairing record every time.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Header, HTTPException, Query, Request, Response, WebSocket,
    WebSocketDisconnect, status,
)
from pydantic import BaseModel, Field

# Reused rather than reimplemented: fleet.py owns the fleet_units schema and
# the token check, and a second copy of either would be a second place for the
# constant-time comparison to drift out of.
from api.routes.fleet import _ensure_schema, _now, _verify_unit
from core.auth import decode_token
from core.vortex_hub import PRESENCE_STATES, get_vortex_hub
from core.vortex_replica import get_replica_service
from core.vortex_security import (
    hash_unit_token,
    mint_unit_token,
    pairing_limiter,
    verify_unit_token,
)
from core.vortex_surfaces import SurfaceError, get_surface_publisher
from core.vortex_units import PROGRAM, ensure_schema as ensure_unit_schema
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vortex", tags=["vortex"])

# A pairing code is only useful while someone is stood in front of the unit
# reading it off the screen.
PAIRING_TTL_MINUTES = 10

# How long a unit has to send its auth frame before the socket is dropped.
WS_AUTH_TIMEOUT_SECONDS = 5.0

# Audio a unit may send in one *frame*. 16kHz mono s16le is 32KB/s, so this is
# roughly four seconds of speech per frame — generous for a stream.
#
# This is a frame size, not an utterance size. A longer utterance arrives as
# several frames with `final` set on the last; core.vortex_voice buffers them
# and bounds the total separately (MAX_UTTERANCE_BYTES). Treating this cap as
# the limit on a whole utterance is what used to truncate anything past ~4
# seconds.
MAX_AUDIO_CHUNK_BYTES = 128 * 1024

# Snapshot retention. These are cameras in bedrooms: a motion snapshot exists
# to tell you something *just* happened, and after that it is only a liability.
# Twenty-four hours, deliberately short, and stated here rather than left to a
# config file nobody reads.
SNAPSHOT_RETENTION_HOURS = 24


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

async def _require_user(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = await decode_token(authorization.removeprefix("Bearer "))
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return payload["sub"]


async def _require_unit(unit_id: str, token: Optional[str]) -> Dict[str, Any]:
    """
    Authenticate a unit and resolve who it acts for.

    Returns {"unit": <fleet row>, "profile": <profile>, "owner": <user id>}.
    The owner comes from the pairing record written when a logged-in user
    approved this unit — never from the request (invariant 4).
    """
    store = SQLiteStore()
    await _ensure_schema(store)
    await ensure_unit_schema(store)
    unit = await _verify_unit(store, PROGRAM, unit_id, token)

    from core.vortex_units import get_profile

    profile = await get_profile(unit_id) or {}
    return {"unit": unit, "profile": profile,
            "owner": profile.get("owner_user_id") or ""}


def _require_owner(context: Dict[str, Any]) -> str:
    owner = context.get("owner")
    if not owner:
        raise HTTPException(
            status_code=409,
            detail="This unit is not associated with a household yet. "
                   "Re-pair it from the River Song app.",
        )
    return owner


def _client_key(request: Request) -> str:
    return (request.client.host if request.client else "unknown")


# ---------------------------------------------------------------------------
# Task 4 — Pairing
# ---------------------------------------------------------------------------
#
# A factory-reset unit has no credential at all, so pair/request and
# pair/status are necessarily unauthenticated. The code alone must never mint
# a token: approval is what mints it, and approval requires a logged-in user.
# Eight digits is 10^8, which is only safe behind the shared lockout in
# core.vortex_security — both open routes count against it.

class PairRequestBody(BaseModel):
    code: str = Field(min_length=8, max_length=8, pattern=r"^\d{8}$")
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PairApproveBody(BaseModel):
    code: str = Field(min_length=8, max_length=8, pattern=r"^\d{8}$")
    name: str = Field(default="", max_length=120)
    room: str = Field(default="", max_length=80)


def _pair_expiry() -> str:
    return (datetime.now(timezone.utc)
            + timedelta(minutes=PAIRING_TTL_MINUTES)).isoformat()


def _expired(row: Dict[str, Any]) -> bool:
    try:
        return datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc)
    except Exception:
        return True


@router.post("/pair/request")
async def pair_request(body: PairRequestBody, request: Request):
    """
    Register a pending pairing, keyed by a code the unit generated and is
    showing on its screen (or reading aloud, on a screenless unit).

    Storing a request grants nothing. Until a user approves it there is no
    unit and no token.
    """
    locked = await pairing_limiter.check(_client_key(request))
    if locked:
        raise HTTPException(status_code=429, detail="Too many pairing attempts.",
                            headers={"Retry-After": str(int(locked))})

    store = await ensure_unit_schema()
    existing = await store.execute_read_one_async(
        "SELECT code, status FROM vortex_pairing_requests WHERE code=?",
        (body.code,),
    )
    if existing and existing["status"] != "pending":
        # A code that has already been through approval must not be reusable.
        raise HTTPException(status_code=409, detail="That code is no longer available.")

    metadata = {k: v for k, v in body.metadata.items() if k != "user_id"}
    if existing:
        await store.execute_write_async(
            "UPDATE vortex_pairing_requests SET metadata=?, expires_at=? WHERE code=?",
            (json.dumps(metadata), _pair_expiry(), body.code),
        )
    else:
        await store.execute_write_async(
            "INSERT INTO vortex_pairing_requests "
            "(code, metadata, status, created_at, expires_at) "
            "VALUES (?, ?, 'pending', ?, ?)",
            (body.code, json.dumps(metadata), _now(), _pair_expiry()),
        )

    logger.info("Vortex pairing requested with code ending %s from %s.",
                body.code[-2:], _client_key(request))
    return {"status": "pending", "expires_in_seconds": PAIRING_TTL_MINUTES * 60}


@router.get("/pair/status")
async def pair_status(request: Request, code: str = Query(min_length=8, max_length=8)):
    """
    Poll for approval. Returns the unit id and token exactly once.

    The token is cleared from the row on the first successful read: a unit
    that asked and got its credential has it, and a second reader — which by
    definition is not that unit — gets nothing.
    """
    key = _client_key(request)
    locked = await pairing_limiter.check(key)
    if locked:
        raise HTTPException(status_code=429, detail="Too many pairing attempts.",
                            headers={"Retry-After": str(int(locked))})

    store = await ensure_unit_schema()
    row = await store.execute_read_one_async(
        "SELECT * FROM vortex_pairing_requests WHERE code=?", (code,)
    )

    # A poll for an unknown code is an enumeration attempt; a poll for a known
    # pending code is a unit doing its job. Only the former counts as a failure.
    if not row:
        remaining = await pairing_limiter.record_failure(key)
        if remaining:
            raise HTTPException(status_code=429, detail="Too many pairing attempts.",
                                headers={"Retry-After": str(int(remaining))})
        # Deliberately vague and slow-ish: an attacker learns nothing from the
        # difference between "no such code" and "not approved yet".
        await asyncio.sleep(random.uniform(0.05, 0.15))
        return {"status": "pending"}

    if _expired(row) and row["status"] == "pending":
        await store.execute_write_async(
            "DELETE FROM vortex_pairing_requests WHERE code=?", (code,))
        return {"status": "expired"}

    if row["status"] == "pending":
        return {"status": "pending"}

    if row["status"] == "claimed":
        return {"status": "claimed"}

    # status == "approved": hand the token over, once.
    await pairing_limiter.record_success(key)
    await store.execute_write_async(
        "UPDATE vortex_pairing_requests SET status='claimed', unit_token=NULL, "
        "claimed_at=? WHERE code=?",
        (_now(), code),
    )
    logger.info("Vortex unit %s claimed its token via pairing.", row["unit_id"])
    return {
        "status": "approved",
        "unit_id": row["unit_id"],
        "unit_token": row["unit_token"],
    }


@router.get("/pair/pending")
async def pair_pending(authorization: Optional[str] = Header(default=None)):
    """List pairing requests waiting for a decision, for the app's adopt screen."""
    await _require_user(authorization)
    store = await ensure_unit_schema()
    rows = await store.execute_read_async(
        "SELECT code, metadata, created_at, expires_at FROM vortex_pairing_requests "
        "WHERE status='pending' ORDER BY created_at DESC",
        (),
    )
    out = []
    for row in rows:
        if _expired(row):
            continue
        try:
            metadata = json.loads(row["metadata"] or "{}")
        except ValueError:
            metadata = {}
        out.append({"code": row["code"], "metadata": metadata,
                    "created_at": row["created_at"],
                    "expires_at": row["expires_at"]})
    return {"pending": out}


@router.post("/pair/approve")
async def pair_approve(body: PairApproveBody, request: Request,
                       authorization: Optional[str] = Header(default=None)):
    """
    Adopt a unit. Authenticated users only — this is what mints the token.

    The approving user becomes the unit's owner, which is how every later
    unit-authenticated request acquires an identity without the unit ever
    claiming one.
    """
    user_id = await _require_user(authorization)

    key = f"approve:{_client_key(request)}"
    locked = await pairing_limiter.check(key)
    if locked:
        raise HTTPException(status_code=429, detail="Too many pairing attempts.",
                            headers={"Retry-After": str(int(locked))})

    store = await ensure_unit_schema()
    await _ensure_schema(store)
    row = await store.execute_read_one_async(
        "SELECT * FROM vortex_pairing_requests WHERE code=?", (body.code,)
    )
    if not row or row["status"] != "pending" or _expired(row):
        remaining = await pairing_limiter.record_failure(key)
        if remaining:
            raise HTTPException(status_code=429, detail="Too many pairing attempts.",
                                headers={"Retry-After": str(int(remaining))})
        raise HTTPException(status_code=404, detail="No pending unit with that code.")

    await pairing_limiter.record_success(key)

    try:
        metadata = json.loads(row["metadata"] or "{}")
    except ValueError:
        metadata = {}

    unit_id = "vx-" + base64.b32encode(
        int(time.time() * 1000).to_bytes(6, "big")).decode("ascii").strip("=").lower()[:12]
    unit_token = mint_unit_token()
    name = body.name.strip() or str(metadata.get("name") or "Vortex unit")
    room = body.room.strip() or str(metadata.get("room") or "")
    has_display = bool(metadata.get("has_display", True))

    await store.execute_write_async(
        "INSERT INTO fleet_units "
        "(program, unit_id, name, unit_token, metadata, online, registered_at) "
        "VALUES (?, ?, ?, ?, ?, 0, ?)",
        (PROGRAM, unit_id, name, hash_unit_token(unit_token),
         json.dumps(metadata), _now()),
    )

    from core.vortex_units import upsert_profile

    await upsert_profile(
        unit_id,
        owner_user_id=user_id,
        room=room,
        has_display=has_display,
        camera=metadata.get("camera") or {},
    )

    await store.execute_write_async(
        "UPDATE vortex_pairing_requests SET status='approved', unit_id=?, "
        "unit_token=?, approved_by=? WHERE code=?",
        (unit_id, unit_token, user_id, body.code),
    )

    logger.info("Vortex unit %s ('%s', room=%s) approved by user %s.",
                unit_id, name, room or "unset", user_id)
    return {"status": "approved", "unit_id": unit_id, "name": name, "room": room}


# ---------------------------------------------------------------------------
# Task 1 — the live channel
# ---------------------------------------------------------------------------

@router.websocket("/ws")
async def vortex_websocket(websocket: WebSocket) -> None:
    """
    One authenticated bidirectional channel per unit.

    Auth follows willow's shape — refuse before accept() where we can, require
    an auth frame first — but not its credential model: every unit has its own
    token, and the user id is resolved here rather than asserted by the client.

    Polling cannot carry presence. River highlighting a card *while she talks
    about it* needs sub-second latency, and the orb's amplitude stream needs
    thirty frames a second. The `/commands` poll stays for slow,
    offline-tolerant operations.
    """
    store = SQLiteStore()
    try:
        await _ensure_schema(store)
        await ensure_unit_schema(store)
    except Exception as exc:
        logger.error("Vortex WS refused: schema unavailable (%s).", exc)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    # A unit id in the query string lets us refuse an unknown unit before the
    # handshake completes. Units that don't send one still get the auth frame.
    hinted_unit = websocket.query_params.get("unit_id")
    if hinted_unit:
        known = await store.execute_read_one_async(
            "SELECT unit_id FROM fleet_units WHERE program=? AND unit_id=?",
            (PROGRAM, hinted_unit),
        )
        if not known:
            logger.warning("Vortex WS refused: unknown unit %s.", hinted_unit)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await websocket.accept()

    unit_id = await _authenticate_socket(websocket, store)
    if not unit_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    from core.vortex_units import get_profile

    profile = await get_profile(unit_id) or {}
    owner = profile.get("owner_user_id") or ""
    hub = get_vortex_hub()
    await hub.register(unit_id, websocket,
                       room=profile.get("room") or None,
                       has_display=bool(profile.get("has_display", True)))

    await websocket.send_json({
        "type": "auth_ok",
        "unit_id": unit_id,
        "room": profile.get("room") or "",
        "has_display": bool(profile.get("has_display", True)),
    })
    await hub.presence(unit_id, "idle")

    # A unit that just connected has an empty screen and a stale local copy.
    if owner:
        asyncio.create_task(get_replica_service().push_to_unit(unit_id, owner))
        # Surface state is in-memory, so a restart loses the current recipe
        # step while the session itself is still in the database. Rebuild it
        # before replaying, or walking into the kitchen after a restart shows
        # nothing until somebody says "next".
        asyncio.create_task(_restore_and_replay(unit_id, owner))
    else:
        asyncio.create_task(get_surface_publisher().replay(unit_id))

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            text = message.get("text")
            if not text:
                # Binary frames are not part of the contract; audio arrives
                # base64-encoded inside an audio_chunk so one framing covers
                # every message type.
                continue
            try:
                frame = json.loads(text)
            except ValueError:
                continue
            await _handle_unit_frame(unit_id, owner, frame, websocket)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.info("Vortex WS error for %s: %s", unit_id, exc)
    finally:
        await hub.unregister(unit_id, websocket)
        # A unit that drops off WiFi mid-call leaves the other end holding a
        # camera light on. End it rather than leaving a half-open call.
        try:
            from core.vortex_calls import get_call_registry, participant_id
            await get_call_registry().end_all_for(
                participant_id(unit_id=unit_id), reason="peer_gone")
        except Exception as exc:
            logger.debug("Call teardown for %s failed: %s", unit_id, exc)
        # Drop any half-spoken utterance. The rest of that sentence is not
        # arriving, and it must not become the opening of the next one.
        try:
            from core.vortex_voice import clear_utterance
            await clear_utterance(unit_id)
        except Exception as exc:
            logger.debug("Utterance cleanup for %s failed: %s", unit_id, exc)


async def _restore_and_replay(unit_id: str, owner: str) -> None:
    """Rebuild any live cooking card, then replay the unit's full card set."""
    try:
        from api.routes.culinary_sessions import restore_kitchen_surface
        await restore_kitchen_surface(owner)
    except Exception as exc:
        logger.debug("Cooking surface restore skipped for %s: %s", unit_id, exc)
    await get_surface_publisher().replay(unit_id)


async def _authenticate_socket(websocket: WebSocket,
                               store: SQLiteStore) -> Optional[str]:
    """
    Consume the first frame and validate it as `{"type":"auth",...}`.

    Drops the socket if no valid auth frame arrives within five seconds, so a
    connection that opens and says nothing does not hold a slot open.
    """
    try:
        raw = await asyncio.wait_for(websocket.receive_text(),
                                     timeout=WS_AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("Vortex WS auth timeout from %s.", websocket.client)
        return None
    except Exception:
        return None

    try:
        frame = json.loads(raw)
    except ValueError:
        return None

    if frame.get("type") != "auth":
        return None

    unit_id = str(frame.get("unit_id") or "")
    token = frame.get("token")
    if not unit_id or not isinstance(token, str):
        return None

    unit = await store.execute_read_one_async(
        "SELECT unit_token FROM fleet_units WHERE program=? AND unit_id=?",
        (PROGRAM, unit_id),
    )
    if not verify_unit_token(token, (unit or {}).get("unit_token")):
        logger.warning("Vortex WS auth failed for unit %s from %s.",
                       unit_id, websocket.client)
        return None

    await store.execute_write_async(
        "UPDATE fleet_units SET online=1, last_seen=? WHERE program=? AND unit_id=?",
        (_now(), PROGRAM, unit_id),
    )
    return unit_id


async def _handle_unit_frame(unit_id: str, owner: str, frame: Dict[str, Any],
                             websocket: WebSocket) -> None:
    """
    Dispatch one unit → server frame.

    Anything a unit says about itself is a report, not an instruction: state
    and occupancy are recorded as hints, and no frame here can change what the
    unit is permitted to do.
    """
    kind = str(frame.get("type") or "")
    hub = get_vortex_hub()
    conn = hub.connection(unit_id)

    if kind == "state":
        reported = str(frame.get("state") or "")
        if conn is not None and reported in PRESENCE_STATES:
            conn.state = reported
        return

    if kind == "ack":
        logger.debug("Vortex ack from %s: %s", unit_id, frame.get("command_id"))
        return

    if kind == "occupancy":
        await _handle_occupancy(unit_id, owner, frame)
        return

    if kind == "audio_chunk":
        await _handle_audio_chunk(unit_id, owner, frame)
        return

    if kind == "camera_state":
        # The unit tells us what its camera is fitted with and consented to.
        # This only ever narrows what we will ask for.
        from core.vortex_units import upsert_profile
        await upsert_profile(unit_id, camera=frame.get("camera") or {})
        return

    if kind.startswith("call_"):
        await _handle_unit_call_frame(unit_id, kind, frame, websocket)
        return

    if kind == "ping":
        await websocket.send_json({"type": "pong", "t": time.time()})
        return

    logger.debug("Vortex unit %s sent unhandled frame type '%s'.", unit_id, kind)


async def _handle_unit_call_frame(unit_id: str, kind: str,
                                  frame: Dict[str, Any],
                                  websocket: WebSocket) -> None:
    """
    Call signalling from a unit, over the socket it already holds.

    The same registry and the same frames the phone app uses — a unit and a
    phone are two addresses of the same kind, so kitchen-to-bedroom and
    phone-to-kitchen are one code path.
    """
    from core.vortex_calls import get_call_registry, participant_id

    registry = get_call_registry()
    address = participant_id(unit_id=unit_id)
    call_id = str(frame.get("call_id") or "")

    if kind == "call_answer":
        call, error = await registry.answer(call_id, address)
        if call is None:
            await websocket.send_json({"type": "call_error",
                                       "call_id": call_id, "message": error})
        else:
            await _withdraw_call_surface(address, call_id)
        return

    if kind in ("call_end", "call_decline"):
        call = registry.get(call_id)
        if call is not None:
            await registry.end(
                call_id,
                reason="declined" if kind == "call_decline" else "hung_up",
                by=address)
            await _withdraw_call_surface(call.caller, call_id)
            await _withdraw_call_surface(call.callee, call_id)
        return

    if kind in ("call_offer", "call_answer_sdp", "call_ice"):
        ok, error = await registry.relay(call_id, address, frame)
        if not ok:
            await websocket.send_json({"type": "call_error",
                                       "call_id": call_id, "message": error})
        return

    logger.debug("Unit %s sent unhandled call frame '%s'.", unit_id, kind)


async def _handle_occupancy(unit_id: str, owner: str,
                            frame: Dict[str, Any]) -> None:
    """
    Record a unit's occupancy report.

    Occupancy is a routing hint — it decides which room the music follows and
    which screen wakes. It is never an authorisation signal: a room being
    occupied does not make anything permitted that was not already.
    """
    hub = get_vortex_hub()
    conn = hub.connection(unit_id)
    if conn is None:
        return
    conn.occupancy = {
        "occupied": bool(frame.get("occupied")),
        "confidence": float(frame.get("confidence") or 0.0),
        "source": str(frame.get("source") or "unknown"),
        "at": time.time(),
    }
    logger.debug("Occupancy from %s: %s", unit_id, conn.occupancy)


async def _handle_audio_chunk(unit_id: str, owner: str,
                              frame: Dict[str, Any]) -> None:
    """
    Accept post-wake-word audio and run it through the normal voice pipeline.

    Wake-word detection stays on the unit (openWakeWord, locally); a chunk
    arriving here means the unit already confirmed it. Intent recognition,
    identity and permission all happen on this side.
    """
    if not owner:
        logger.warning("Audio from unpaired unit %s ignored.", unit_id)
        return

    encoded = frame.get("data") or frame.get("audio") or ""
    if not isinstance(encoded, str) or not encoded:
        return
    try:
        audio = base64.b64decode(encoded, validate=True)
    except Exception:
        logger.debug("Vortex unit %s sent an undecodable audio chunk.", unit_id)
        return
    if len(audio) > MAX_AUDIO_CHUNK_BYTES:
        logger.warning("Vortex unit %s sent an oversized audio chunk (%d bytes).",
                       unit_id, len(audio))
        return

    from core.vortex_voice import handle_unit_utterance

    asyncio.create_task(handle_unit_utterance(
        unit_id=unit_id, user_id=owner, audio=audio,
        final=bool(frame.get("final", True)),
    ))


# ---------------------------------------------------------------------------
# Task 2 / 1b / 7 — the replica
# ---------------------------------------------------------------------------

@router.get("/replica")
async def get_replica(unit_id: str = Query(...),
                      since: Optional[int] = Query(default=None),
                      x_unit_token: Optional[str] = Header(default=None)):
    """
    The unit's local copy: devices, cameras, notifications, rooms, weather,
    weather alerts, the household's wake word and this unit's own settings.

    With `since`, only the sections that changed after that version come back,
    plus a new stamp. Weather lives here rather than on /api/feeds/weather
    because a unit holds a unit token, not a user JWT — and because the
    ambient screen should keep showing conditions while this server is down.
    """
    context = await _require_unit(unit_id, x_unit_token)
    owner = _require_owner(context)
    return await get_replica_service().snapshot(owner, unit_id=unit_id, since=since)


# ---------------------------------------------------------------------------
# Task 6 — surfaces
# ---------------------------------------------------------------------------

class SurfaceBody(BaseModel):
    """A card descriptor plus its targeting."""
    id: str
    kind: str = "note"
    priority: str = "normal"
    title: str = ""
    body: str = ""
    value: Optional[str] = None
    unit: Optional[str] = None
    items: List[str] = Field(default_factory=list)
    image_url: Optional[str] = None
    icon: Optional[str] = None
    actions: List[Dict[str, Any]] = Field(default_factory=list)
    ttl_seconds: int = 900
    speech: Optional[str] = None
    # Targeting — omit both to reach every unit.
    room: Optional[str] = None
    unit_ids: Optional[List[str]] = None


class SurfaceActionBody(BaseModel):
    surface_id: str
    intent: str
    unit_id: str


@router.get("/v1/surfaces")
async def list_surfaces(unit_id: str = Query(...),
                        x_unit_token: Optional[str] = Header(default=None)):
    """Current cards for the calling unit — what a kiosk reads on restart."""
    await _require_unit(unit_id, x_unit_token)
    return {"surfaces": await get_surface_publisher().list_for_unit(unit_id)}


@router.post("/v1/surfaces")
async def publish_surface(body: SurfaceBody,
                          authorization: Optional[str] = Header(default=None)):
    """
    Show or replace a card.

    Pushing the same `id` replaces the card and never stacks a second one, so
    ids should be stable and meaningful ("garage", "shopping-list").
    """
    user_id = await _require_user(authorization)
    data = body.model_dump(exclude={"room", "unit_ids"})
    data["source"] = f"user:{user_id}"
    try:
        return await get_surface_publisher().publish(
            data, unit_ids=body.unit_ids, room=body.room)
    except SurfaceError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.delete("/v1/surfaces/{surface_id}")
async def withdraw_surface(surface_id: str,
                           room: Optional[str] = Query(default=None),
                           authorization: Optional[str] = Header(default=None)):
    """Withdraw a card, because the fact it states stopped being true."""
    await _require_user(authorization)
    return await get_surface_publisher().withdraw(surface_id, room=room)


@router.post("/v1/surface-action")
async def surface_action(body: SurfaceActionBody,
                         x_unit_token: Optional[str] = Header(default=None)):
    """
    A button was tapped on a card.

    The unit relays the tapped button verbatim and never interprets it. The
    intent is re-run through the intent router with the same checks as a voice
    command, including the hard deny — a confirm card on a wall panel is a
    prompt, not an authorisation.

    Returns 2xx only when the action was accepted. The unit leaves the card up
    on anything else, so a tap that did not land never looks like one that did.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_actions import STATUS_DENIED, STATUS_ERROR, run_surface_action

    result = await run_surface_action(
        surface_id=body.surface_id, intent=body.intent,
        unit_id=body.unit_id, user_id=owner,
    )
    if result["status"] == STATUS_DENIED:
        raise HTTPException(status_code=403, detail=result["message"])
    if result["status"] == STATUS_ERROR:
        raise HTTPException(status_code=502, detail=result["message"])
    return result


# ---------------------------------------------------------------------------
# Task 7 — device control
# ---------------------------------------------------------------------------

class DeviceToggleBody(BaseModel):
    unit_id: str
    entity_id: str


class DeviceControlBody(BaseModel):
    unit_id: str
    entity_id: str
    action: str
    value: Optional[int] = None


@router.post("/devices/toggle")
async def toggle_device(body: DeviceToggleBody,
                        x_unit_token: Optional[str] = Header(default=None)):
    """
    A tap on the unit's device grid.

    Routed through the intent router exactly like a spoken command, so the
    hard deny applies to a tapped light switch as it does to a spoken one —
    and a tapped `lock.front_door` is refused here rather than on the Pi.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_actions import STATUS_DENIED, execute_home_action

    result = await execute_home_action(
        user_id=owner, entity_id=body.entity_id, action="toggle",
        unit_id=body.unit_id,
    )
    if result["status"] == STATUS_DENIED:
        raise HTTPException(status_code=403, detail=result["message"])
    return result


@router.post("/devices/control")
async def control_device(body: DeviceControlBody,
                         x_unit_token: Optional[str] = Header(default=None)):
    """Brightness, temperature, open/close — same checks as /devices/toggle."""
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_actions import STATUS_DENIED, execute_home_action

    result = await execute_home_action(
        user_id=owner, entity_id=body.entity_id, action=body.action,
        value=body.value, unit_id=body.unit_id,
    )
    if result["status"] == STATUS_DENIED:
        raise HTTPException(status_code=403, detail=result["message"])
    return result


class ConfirmBody(BaseModel):
    unit_id: str
    challenge_id: str
    code: str = Field(max_length=32)


@router.post("/confirm")
async def confirm_action(body: ConfirmBody,
                         x_unit_token: Optional[str] = Header(default=None)):
    """
    Redeem a pending confirmation with a factor typed on the touchscreen.

    Second factors are entered on the screen, never spoken: a spoken PIN
    travels the same channel as the voice that triggered the action and is
    audible to the whole room, so it adds no factor at all.
    """
    await _require_unit(body.unit_id, x_unit_token)

    from core.vortex_actions import STATUS_DENIED, resolve_confirmation

    result = await resolve_confirmation(
        challenge_id=body.challenge_id, code=body.code, unit_id=body.unit_id)
    if result["status"] == STATUS_DENIED:
        raise HTTPException(status_code=403, detail=result["message"])
    return result


# ---------------------------------------------------------------------------
# Task 9 — TTS
# ---------------------------------------------------------------------------

class TTSBody(BaseModel):
    unit_id: str
    text: str = Field(min_length=1, max_length=2000)
    # Units that play the returned WAV should leave this on so the orb pulses
    # with the speech; a unit fetching audio to cache can turn it off.
    stream_amplitude: bool = True


@router.post("/tts")
async def synthesize(body: TTSBody,
                     x_unit_token: Optional[str] = Header(default=None)):
    """
    Synthesize text in River's voice and return WAV bytes.

    Without this, `core/voice.py` on the device finds no `synthesize_speech`
    and falls through to offline espeak-ng, which is why every unit in the
    house currently answers in a robotic voice.

    The amplitude stream for the orb is emitted off this same synthesis: the
    envelope is in hand at exactly this moment, and the unit plays an opaque
    blob it cannot measure.
    """
    await _require_unit(body.unit_id, x_unit_token)

    from core.vortex_voice import synthesize_for_unit

    wav = await synthesize_for_unit(body.text)
    if not wav:
        raise HTTPException(status_code=503, detail="No speech synthesis available.")

    if body.stream_amplitude:
        get_vortex_hub().start_amplitude_stream(body.unit_id, wav,
                                                caption=body.text)

    return Response(content=wav, media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# Task 8 — cameras
# ---------------------------------------------------------------------------

class CameraFramesBody(BaseModel):
    unit_id: str
    purpose: str
    # base64 JPEG frames. The unit sends pixels and gets back a decision; it
    # never receives a roster of faces or an embedding database.
    frames: List[str] = Field(default_factory=list, max_length=8)
    challenge_id: Optional[str] = None


class MotionSnapshotBody(BaseModel):
    unit_id: str
    image: str          # base64 JPEG
    camera_name: str = ""
    doorbell: bool = False


@router.get("/camera/{entity_id}/snapshot")
async def camera_snapshot(entity_id: str, unit_id: str = Query(...),
                          x_unit_token: Optional[str] = Header(default=None)):
    """
    Proxy a Home Assistant camera snapshot to a unit.

    Proxied rather than handed over as an HA URL with a token attached: units
    never hold Home Assistant credentials, and that includes signed URLs that
    would outlive this request.
    """
    await _require_unit(unit_id, x_unit_token)
    if not entity_id.startswith("camera."):
        raise HTTPException(status_code=400, detail="Not a camera entity.")

    from api.routes.home import _get_client, _is_configured

    if not _is_configured():
        raise HTTPException(status_code=503, detail="Home Assistant not configured.")

    client = _get_client()
    try:
        http = await client._ensure_client()
        response = await http.get(f"/api/camera_proxy/{entity_id}")
        response.raise_for_status()
        return Response(content=response.content,
                        media_type=response.headers.get("content-type", "image/jpeg"),
                        headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Camera snapshot for %s failed: %s", entity_id, exc)
        raise HTTPException(status_code=502, detail="Camera snapshot unavailable.")
    finally:
        await client.close()


@router.post("/camera/frames")
async def camera_frames(body: CameraFramesBody,
                        x_unit_token: Optional[str] = Header(default=None)):
    """
    Accept camera frames and return a decision about who is in them.

    This server decides who it is; the unit sends pixels (invariant 4). A
    purpose the owner has not enabled is refused by the unit before it ever
    gets here, and a refusal is not something to route around — if this
    server's record says a purpose is off, it does not ask.

    Face recognition combines with the on-screen code from Task 5 for genuine
    two-factor on medium-risk actions. It still does not unlock doors:
    invariant 2 stands regardless of how confidently a face is matched.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_units import CAMERA_PURPOSES, camera_purpose_enabled

    if body.purpose not in CAMERA_PURPOSES:
        raise HTTPException(status_code=400, detail="Unknown camera purpose.")
    if not camera_purpose_enabled(context["profile"], body.purpose):
        # 409, not 403: the unit is not misbehaving, the purpose is simply not
        # consented. Distinct from a hardware failure, and never retried.
        raise HTTPException(
            status_code=409,
            detail=f"Camera purpose '{body.purpose}' is not enabled on this unit.",
        )
    if not body.frames:
        raise HTTPException(status_code=400, detail="No frames supplied.")

    from core.vortex_vision import identify_from_frames

    return await identify_from_frames(
        unit_id=body.unit_id, owner_user_id=owner,
        purpose=body.purpose, frames=body.frames,
        challenge_id=body.challenge_id,
    )


@router.post("/camera/snapshot")
async def motion_snapshot(body: MotionSnapshotBody,
                          x_unit_token: Optional[str] = Header(default=None)):
    """
    Accept a motion snapshot from a unit and put it on the right screens.

    Motion raises a `high` surface with the snapshot as its image; a doorbell
    raises a `critical` one, which is the takeover case the surface renderer
    was built around.

    Snapshots are retained for SNAPSHOT_RETENTION_HOURS and then deleted.
    These are cameras in bedrooms — the shortest retention that still lets
    someone look at what woke them is the right one.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    _require_owner(context)

    from core.vortex_units import camera_purpose_enabled

    if not camera_purpose_enabled(context["profile"], "motion_snapshots"):
        raise HTTPException(
            status_code=409,
            detail="Motion snapshots are not enabled on this unit.",
        )

    from core.vortex_vision import store_snapshot
    from core.vortex_surfaces import publish_doorbell, publish_motion_snapshot

    camera_name = body.camera_name or context["profile"].get("room") or body.unit_id
    try:
        image_url = await store_snapshot(body.unit_id, body.image)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if body.doorbell:
        result = await publish_doorbell(image_url=image_url,
                                        caption="Someone at the door")
    else:
        result = await publish_motion_snapshot(camera_name=camera_name,
                                               image_url=image_url)
    return {"status": "ok", "image_url": image_url, "surface": result}


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str, exp: int = Query(...),
                       sig: str = Query(...)):
    """
    Serve a stored snapshot against its signed, expiring URL.

    No token header: the unit renders this in an image element, which cannot
    attach one. The signature covers the id and the expiry, and the file is
    deleted at the same expiry, so a leaked link outlives nothing.
    """
    from core.vortex_vision import read_snapshot

    try:
        data, media_type = read_snapshot(snapshot_id, exp, sig)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Snapshot no longer available.")
    return Response(content=data, media_type=media_type,
                    headers={"Cache-Control": "private, max-age=60"})


# ---------------------------------------------------------------------------
# Task 3b — media targeting
# ---------------------------------------------------------------------------

class MediaControlBody(BaseModel):
    unit_id: str
    action: str          # pause | resume | skip | previous | stop | volume
    value: Optional[int] = None


@router.post("/media/control")
async def media_control(body: MediaControlBody,
                        x_unit_token: Optional[str] = Header(default=None)):
    """
    Relay a transport command to the unit that is playing.

    Music plays on the unit, not on this server, so pause, resume, skip,
    previous, stop and volume all go back to a unit's own `/api/vortex/v1/
    media/*`. This endpoint exists so a unit that heard "next track" while a
    different unit is playing still reaches the right speaker.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_media import control_playback

    return await control_playback(user_id=owner, requesting_unit=body.unit_id,
                                  action=body.action, value=body.value)


# ---------------------------------------------------------------------------
# Task 3c — casting
# ---------------------------------------------------------------------------

class CastBody(BaseModel):
    unit_id: str
    target: str            # room, entity id, or friendly name
    url: Optional[str] = None
    query: Optional[str] = None   # resolve this instead of passing a url
    content_type: str = "video"
    title: str = ""
    artwork_url: str = ""


class CastStopBody(BaseModel):
    unit_id: str
    target: str


@router.get("/cast/targets")
async def cast_targets(unit_id: str = Query(...),
                       x_unit_token: Optional[str] = Header(default=None)):
    """Everything in the house something can be cast to."""
    context = await _require_unit(unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_cast import list_targets

    return {"targets": await list_targets(owner)}


@router.post("/cast")
async def start_cast(body: CastBody,
                     x_unit_token: Optional[str] = Header(default=None)):
    """
    Cast a stream to a TV, speaker or hub.

    Casting goes to a Home Assistant `media_player` — HA already runs
    pychromecast and already has every target in the house discovered, so this
    resolves a target and calls `media_player.play_media` rather than
    reimplementing the Cast protocol on a Pi.
    """
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_cast import cast, resolve_target

    target = await resolve_target(body.target, owner)
    if target is None:
        raise HTTPException(status_code=404,
                            detail=f"No cast target matching '{body.target}'.")

    url, title, artwork = body.url, body.title, body.artwork_url
    if not url:
        if not body.query:
            raise HTTPException(status_code=400,
                                detail="Supply either a url or a query.")
        from core.vortex_media import resolve_track

        track = await resolve_track(body.query)
        if not track:
            raise HTTPException(
                status_code=404,
                detail=f"Nothing found matching '{body.query}'.")
        url = track["url"]
        title = title or track.get("title", "")
        artwork = artwork or track.get("artwork_url", "")

    result = await cast(user_id=owner, target=target, url=url,
                        content_type=body.content_type, title=title,
                        artwork_url=artwork)
    if result["status"] == "denied":
        raise HTTPException(status_code=403, detail=result["message"])
    if result["status"] == "error":
        raise HTTPException(status_code=502, detail=result["message"])
    return result


@router.post("/cast/stop")
async def stop_cast(body: CastStopBody,
                    x_unit_token: Optional[str] = Header(default=None)):
    context = await _require_unit(body.unit_id, x_unit_token)
    owner = _require_owner(context)

    from core.vortex_cast import resolve_target, stop

    target = await resolve_target(body.target, owner)
    if target is None:
        raise HTTPException(status_code=404,
                            detail=f"No cast target matching '{body.target}'.")

    result = await stop(user_id=owner, target=target)
    if result["status"] == "error":
        raise HTTPException(status_code=502, detail=result["message"])
    return result


# ---------------------------------------------------------------------------
# Task 8b — intercom and video calls
# ---------------------------------------------------------------------------
#
# This server does signalling only. Audio and video go directly between the
# two endpoints — on a home LAN that is a couple of hops over the switch, and
# none of it passes through here.

class CallStartBody(BaseModel):
    # Exactly one of these identifies the caller. A unit supplies unit_id with
    # its token; the phone app authenticates as a user and supplies neither.
    unit_id: Optional[str] = None
    # Who to ring: a room name, a unit id, or "user:<id>" for the phone app.
    to: str
    mode: str = Field(default="audio", pattern="^(audio|video)$")


class CallSignalBody(BaseModel):
    unit_id: Optional[str] = None
    call_id: str
    # "call_offer" | "call_answer_sdp" | "call_ice"
    type: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class CallActionBody(BaseModel):
    unit_id: Optional[str] = None
    call_id: str


async def _caller_address(unit_id: Optional[str], token: Optional[str],
                          authorization: Optional[str]) -> tuple:
    """
    Resolve who is calling, and which household they are in.

    A unit authenticates with its token and is addressed as `unit:<id>`; the
    phone app authenticates as a user and is addressed as `user:<id>`. Both
    resolve their household here — neither gets to claim one.
    """
    from core.vortex_calls import participant_id

    if unit_id:
        context = await _require_unit(unit_id, token)
        owner = _require_owner(context)
        return participant_id(unit_id=unit_id), owner

    user_id = await _require_user(authorization)
    return participant_id(user_id=user_id), user_id


async def _resolve_callee(to: str, owner_user_id: str) -> Optional[str]:
    """
    Turn "the kitchen" or "user:abc" into a participant address.

    Only reaches units in this household and users who own units in it: a call
    is never a route into someone else's house.
    """
    from core.vortex_calls import participant_id, split_participant
    from core.vortex_units import list_profiles, normalise_room

    kind, value = split_participant(to)
    if kind == "user" and value:
        return participant_id(user_id=value)

    profiles = await list_profiles(owner_user_id)
    if kind == "unit" and value:
        return (participant_id(unit_id=value)
                if any(p["unit_id"] == value for p in profiles) else None)

    wanted = normalise_room(to)
    for profile in profiles:
        if profile["unit_id"] == to.strip():
            return participant_id(unit_id=profile["unit_id"])

    in_room = [p for p in profiles
               if normalise_room(p.get("room", "")) == wanted]
    if not in_room:
        return None

    # A room can hold more than one unit — a display on the wall and a
    # screenless speaker on a shelf. Ring one that is actually connected, and
    # prefer the one with a screen so the caller can be seen.
    hub = get_vortex_hub()
    in_room.sort(key=lambda p: (not hub.is_connected(p["unit_id"]),
                                not p.get("has_display", True)))
    return participant_id(unit_id=in_room[0]["unit_id"])


@router.get("/calls/targets")
async def call_targets(unit_id: Optional[str] = Query(default=None),
                       x_unit_token: Optional[str] = Header(default=None),
                       authorization: Optional[str] = Header(default=None)):
    """Rooms and people this caller can reach."""
    _, owner = await _caller_address(unit_id, x_unit_token, authorization)

    from core.vortex_calls import participant_id
    from core.vortex_calls_ws import is_connected
    from core.vortex_units import list_profiles

    hub = get_vortex_hub()
    rooms = [
        {"kind": "unit", "address": participant_id(unit_id=p["unit_id"]),
         "name": p.get("room") or p["unit_id"],
         "has_display": bool(p.get("has_display", True)),
         "video": bool((p.get("camera") or {}).get("purposes", {})
                       .get("video_calls")),
         "online": hub.is_connected(p["unit_id"])}
        for p in await list_profiles(owner)
    ]
    people = [{"kind": "user", "address": participant_id(user_id=owner),
               "name": "My devices", "online": is_connected(owner)}]
    return {"targets": rooms + people}


@router.post("/calls")
async def start_call(body: CallStartBody,
                     x_unit_token: Optional[str] = Header(default=None),
                     authorization: Optional[str] = Header(default=None)):
    """
    Ring another room, or a phone.

    A video call to a unit whose owner has not enabled the `video_calls`
    camera purpose connects as audio, with a note saying why. That is how a
    consent boundary should behave: the call still happens, it just does not
    carry video. Asking the unit anyway would be routing around a refusal.
    """
    caller, owner = await _caller_address(body.unit_id, x_unit_token,
                                          authorization)
    callee = await _resolve_callee(body.to, owner)
    if callee is None:
        raise HTTPException(status_code=404,
                            detail=f"I couldn't find '{body.to}'.")

    from core.vortex_calls import get_call_registry, ice_servers, negotiate_mode

    mode, note = await negotiate_mode(body.mode, caller, callee)
    call, error = await get_call_registry().start(
        caller=caller, callee=callee, owner_user_id=owner, mode=mode,
        ice_servers=ice_servers(),
    )
    if call is None:
        raise HTTPException(status_code=409, detail=error)

    # Ring the callee's screen too, so a wall panel shows who is calling.
    await _ring_surface(callee, caller, call.id, mode)

    payload = call.to_wire(viewer=caller)
    payload["ice_servers"] = ice_servers()
    if note:
        payload["note"] = note
    return payload


async def _ring_surface(callee: str, caller: str, call_id: str,
                        mode: str) -> None:
    """
    Put an incoming call on the callee's screen.

    `critical` — a ringing intercom is exactly the takeover case: it is
    time-limited, someone is waiting, and a card that sits politely below the
    clock is a call nobody answers.
    """
    from core.vortex_calls import split_participant
    from core.vortex_surfaces import get_surface_publisher
    from core.vortex_units import get_profile

    kind, value = split_participant(callee)
    if kind != "unit":
        return

    caller_kind, caller_value = split_participant(caller)
    if caller_kind == "unit":
        profile = await get_profile(caller_value) or {}
        who = profile.get("room") or "another room"
    else:
        who = "a phone"

    try:
        await get_surface_publisher().publish(
            {
                "id": f"call:{call_id}",
                "kind": "confirm",
                "priority": "critical",
                "title": f"Incoming {mode} call",
                "body": f"From {who}.",
                "icon": "📞",
                "ttl_seconds": 60,
                "speech": f"Call from {who}.",
                "source": "intercom",
                "actions": [
                    {"label": "Answer", "intent": f"call.answer.{call_id}",
                     "style": "primary"},
                    {"label": "Decline", "intent": f"call.decline.{call_id}",
                     "style": "secondary"},
                ],
            },
            unit_ids=[value],
        )
    except Exception as exc:
        logger.debug("Could not raise the call surface: %s", exc)


@router.post("/calls/answer")
async def answer_call(body: CallActionBody,
                      x_unit_token: Optional[str] = Header(default=None),
                      authorization: Optional[str] = Header(default=None)):
    address, _ = await _caller_address(body.unit_id, x_unit_token, authorization)

    from core.vortex_calls import get_call_registry

    call, error = await get_call_registry().answer(body.call_id, address)
    if call is None:
        raise HTTPException(status_code=409, detail=error)
    await _withdraw_call_surface(address, body.call_id)
    return call.to_wire(viewer=address)


@router.post("/calls/end")
async def end_call(body: CallActionBody,
                   x_unit_token: Optional[str] = Header(default=None),
                   authorization: Optional[str] = Header(default=None)):
    address, _ = await _caller_address(body.unit_id, x_unit_token, authorization)

    from core.vortex_calls import get_call_registry

    registry = get_call_registry()
    call = registry.get(body.call_id)
    if call is None or not call.involves(address):
        raise HTTPException(status_code=404, detail="No such call.")

    reason = "declined" if call.state == "ringing" else "hung_up"
    await registry.end(body.call_id, reason=reason, by=address)
    await _withdraw_call_surface(call.caller, body.call_id)
    await _withdraw_call_surface(call.callee, body.call_id)
    return {"status": "ok", "call_id": body.call_id, "reason": reason}


@router.post("/calls/signal")
async def signal_call(body: CallSignalBody,
                      x_unit_token: Optional[str] = Header(default=None),
                      authorization: Optional[str] = Header(default=None)):
    """
    Relay one WebRTC frame to the other end.

    The offer, the answer and the ICE candidates are between the two peers.
    This checks that the sender is in the call and forwards the payload
    verbatim — it does not parse or store the session description.
    """
    address, _ = await _caller_address(body.unit_id, x_unit_token, authorization)

    from core.vortex_calls import get_call_registry

    ok, error = await get_call_registry().relay(
        body.call_id, address, {"type": body.type, **body.payload})
    if not ok:
        raise HTTPException(status_code=409, detail=error)
    return {"status": "ok"}


async def _withdraw_call_surface(address: str, call_id: str) -> None:
    from core.vortex_calls import split_participant

    kind, value = split_participant(address)
    if kind != "unit":
        return
    try:
        await get_surface_publisher().withdraw(f"call:{call_id}", [value])
    except Exception:
        pass


@router.websocket("/calls/ws")
async def calls_websocket(websocket: WebSocket) -> None:
    """
    The phone app's signalling channel.

    Units signal over `/api/vortex/ws`, which they already hold. This is the
    equivalent for the app and the browser, so the registry can address a
    phone exactly as it addresses a hub.

    A user may have several open at once — phone, tablet, a browser tab. They
    all ring and the first to answer takes the call, which is what an intercom
    should do.
    """
    token = websocket.query_params.get("token", "")
    payload = await decode_token(token) if token else None
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = str(payload.get("sub") or "")
    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    from core.vortex_calls import get_call_registry, ice_servers, participant_id
    from core.vortex_calls_ws import register, unregister

    await websocket.accept()
    await register(user_id, websocket)

    address = participant_id(user_id=user_id)
    registry = get_call_registry()

    await websocket.send_json({"type": "ready", "address": address,
                               "ice_servers": ice_servers()})

    # Anything that arrived while this device was still connecting.
    for frame in await registry.drain_pending(address):
        await websocket.send_json(frame)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            text = message.get("text")
            if not text:
                continue
            try:
                frame = json.loads(text)
            except ValueError:
                continue
            await _handle_call_frame(address, frame, websocket, registry)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.info("Call WS error for %s: %s", user_id, exc)
    finally:
        last = await unregister(user_id, websocket)
        # Only hang up when the user's last device goes away — closing one of
        # three tabs should not drop the call.
        if last:
            await registry.end_all_for(address, reason="peer_gone")


async def _handle_call_frame(address: str, frame: Dict[str, Any],
                             websocket: WebSocket, registry: Any) -> None:
    """Dispatch one frame from the phone app."""
    kind = str(frame.get("type") or "")
    call_id = str(frame.get("call_id") or "")

    if kind == "call_answer":
        call, error = await registry.answer(call_id, address)
        if call is None:
            await websocket.send_json({"type": "call_error", "call_id": call_id,
                                       "message": error})
        return

    if kind in ("call_end", "call_decline"):
        call = registry.get(call_id)
        if call is not None:
            await registry.end(
                call_id,
                reason="declined" if kind == "call_decline" else "hung_up",
                by=address)
        return

    if kind in ("call_offer", "call_answer_sdp", "call_ice"):
        ok, error = await registry.relay(call_id, address, frame)
        if not ok:
            await websocket.send_json({"type": "call_error", "call_id": call_id,
                                       "message": error})
        return

    if kind == "ping":
        await websocket.send_json({"type": "pong", "t": time.time()})


# ---------------------------------------------------------------------------
# Admin / app surface
# ---------------------------------------------------------------------------

class UnitProfileBody(BaseModel):
    room: Optional[str] = None
    has_display: Optional[bool] = None
    settings: Optional[Dict[str, Any]] = None


@router.get("/profiles")
async def list_unit_profiles(authorization: Optional[str] = Header(default=None)):
    """Every unit this user owns, with room, display and camera capability."""
    user_id = await _require_user(authorization)
    from core.vortex_units import list_profiles

    hub = get_vortex_hub()
    profiles = await list_profiles(user_id)
    for profile in profiles:
        profile["connected"] = hub.is_connected(profile["unit_id"])
    return {"units": profiles}


@router.post("/profiles/{unit_id}/adopt")
async def adopt_unit(unit_id: str, body: UnitProfileBody,
                     authorization: Optional[str] = Header(default=None)):
    """
    Take ownership of a unit that has no household yet.

    Units minted through the admin `/api/vortex/units/claim` path predate
    pairing and have no owner, so every unit-authenticated call from them
    answers 409. This is how such a unit joins a household without being
    factory-reset and re-paired. A unit that already has an owner is not
    re-assignable here.
    """
    user_id = await _require_user(authorization)

    store = SQLiteStore()
    await _ensure_schema(store)
    await ensure_unit_schema(store)
    unit = await store.execute_read_one_async(
        "SELECT unit_id FROM fleet_units WHERE program=? AND unit_id=?",
        (PROGRAM, unit_id),
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found.")

    from core.vortex_units import get_profile, upsert_profile

    existing = await get_profile(unit_id)
    if existing and existing.get("owner_user_id"):
        raise HTTPException(status_code=409,
                            detail="This unit already belongs to a household.")

    profile = await upsert_profile(
        unit_id, owner_user_id=user_id, room=body.room,
        has_display=body.has_display, settings=body.settings,
    )
    logger.info("Vortex unit %s adopted by user %s.", unit_id, user_id)
    return profile


@router.patch("/profiles/{unit_id}")
async def update_unit_profile(unit_id: str, body: UnitProfileBody,
                              authorization: Optional[str] = Header(default=None)):
    """Move a unit to a different room, or record that it has no screen."""
    user_id = await _require_user(authorization)
    from core.vortex_units import get_profile, upsert_profile

    profile = await get_profile(unit_id)
    if not profile or profile.get("owner_user_id") != user_id:
        raise HTTPException(status_code=404, detail="Unit not found.")

    updated = await upsert_profile(
        unit_id, room=body.room, has_display=body.has_display,
        settings=body.settings,
    )

    # The hub caches room and display so pushes do not hit the database; keep
    # it in step or a moved unit keeps receiving the old room's cards.
    conn = get_vortex_hub().connection(unit_id)
    if conn is not None:
        conn.room = updated.get("room") or None
        conn.has_display = bool(updated.get("has_display", True))
    return updated
