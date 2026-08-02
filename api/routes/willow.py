# api/routes/willow.py
#
# Willow-compatible WebSocket for hardware voice devices (ESP32-S3 Box).
#
# AUTHENTICATION
# Every device has its own token, minted by an admin claiming it:
#
#     POST /api/willow/units/claim  {"name": "Kitchen Box"}  → {unit_id, unit_token}
#
# Tokens are hashed at rest in `fleet_units` and compared with
# hmac.compare_digest, exactly as the Vortex socket does. There is no shared
# device token: one secret across every device means any device can
# impersonate any other, and a single leak re-keys the whole house.
#
# Accepted forms, checked in this order:
#   1. ?unit_id=<ID>&token=<TOKEN> query parameters (simplest for headless kit)
#   2. First text frame: {"type": "auth", "unit_id": "...", "token": "..."}
#
# The Sec-WebSocket-Protocol form is gone: it can only carry one opaque value,
# which is precisely the shared-secret shape being removed.
#
# IDENTITY
# The device never says who is using it. `user_id` is resolved from the unit's
# owner — the admin who claimed it — and a self-asserted one in the frame is
# ignored. A device states which unit it is; the server states the rest.
#
# MIGRATION
# Devices previously configured with WILLOW_DEVICE_TOKEN will be refused until
# they are claimed and reconfigured with their own unit id and token. That is
# deliberate: the shared token is the thing being retired.
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from core.conversation_loop import ConversationLoop
from core.vortex_security import verify_unit_token
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)
router = APIRouter(tags=["willow"])

PROGRAM = "willow"

# A device that opens a socket and then says nothing must not hold it open.
AUTH_TIMEOUT_SECONDS = 5.0


async def _verify(unit_id: str, token: object) -> bool:
    """Constant-time check of a unit token against its hashed stored form."""
    if not unit_id or not isinstance(token, str):
        return False
    from api.routes.fleet import _ensure_schema

    store = SQLiteStore()
    await _ensure_schema(store)
    row = await store.execute_read_one_async(
        "SELECT unit_token FROM fleet_units WHERE program=? AND unit_id=?",
        (PROGRAM, unit_id),
    )
    # verify_unit_token hashes both sides, so an unknown unit id costs the
    # same as a wrong token.
    return verify_unit_token(token, (row or {}).get("unit_token"))


async def _authenticate(websocket: WebSocket) -> Tuple[bool, str]:
    """
    Return (authenticated, unit_id).

    Query parameters first, then a single auth frame within
    AUTH_TIMEOUT_SECONDS. Nothing else is accepted.
    """
    unit_id = (websocket.query_params.get("unit_id") or "").strip()
    token = websocket.query_params.get("token")
    if unit_id and token and await _verify(unit_id, token):
        return True, unit_id

    try:
        raw = await asyncio.wait_for(websocket.receive_text(),
                                     timeout=AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("Willow auth timeout from %s", websocket.client)
        return False, ""
    except Exception:
        return False, ""

    try:
        payload = json.loads(raw)
    except Exception:
        return False, ""

    if payload.get("type") != "auth":
        return False, ""
    frame_unit = str(payload.get("unit_id") or "").strip()
    if await _verify(frame_unit, payload.get("token")):
        return True, frame_unit
    return False, ""


async def _resolve_owner(unit_id: str) -> Optional[str]:
    """
    The user this unit acts for. Never taken from the device.

    A unit with no owner is refused rather than defaulted: acting as some
    fallback account would be guessing at whose memory and settings to use.
    """
    from api.routes.fleet import unit_owner

    owner = await unit_owner(SQLiteStore(), PROGRAM, unit_id)
    return owner or None


@router.websocket("/api/willow/ws")
async def willow_websocket(websocket: WebSocket) -> None:
    # Refuse an unknown unit before the handshake completes where we can.
    hinted = (websocket.query_params.get("unit_id") or "").strip()
    if hinted:
        store = SQLiteStore()
        from api.routes.fleet import _ensure_schema

        await _ensure_schema(store)
        known = await store.execute_read_one_async(
            "SELECT unit_id FROM fleet_units WHERE program=? AND unit_id=?",
            (PROGRAM, hinted),
        )
        if not known:
            logger.warning("Willow connection refused: unknown unit %s", hinted)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await websocket.accept()
    logger.info("Willow handshake from %s", websocket.client)

    ok, unit_id = await _authenticate(websocket)
    if not ok:
        logger.warning("Willow auth failed for %s", websocket.client)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = await _resolve_owner(unit_id)
    if not user_id:
        logger.warning(
            "Willow unit %s has no owner; claim it from an admin account "
            "before it can be used.", unit_id)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    logger.info("Willow unit %s authenticated for user %s from %s",
                unit_id, user_id, websocket.client)
    await websocket.send_json({"type": "auth_ok", "unit_id": unit_id})

    loop = ConversationLoop(user_id=user_id)
    await loop.initialize()

    async def on_event(evt: dict) -> None:
        if evt["type"] == "transcript":
            await websocket.send_json({"text": evt["text"], "type": "transcript"})
        elif evt["type"] == "response_complete":
            await websocket.send_json({"text": evt["text"], "type": "response"})
        elif evt["type"] == "audio":
            # Forward the codec too. Piper/Kokoro emit wav and ElevenLabs
            # emits mp3; without this the device has to guess how to decode.
            await websocket.send_json({
                "audio": evt["data"],
                "type": "audio",
                "format": evt.get("format", "wav"),
            })

    try:
        while True:
            msg = await websocket.receive()

            if "bytes" in msg:
                # Streamed audio chunks — pipe to STT here in future versions.
                pass

            elif "text" in msg:
                try:
                    data = json.loads(msg["text"])
                except Exception:
                    continue
                if data.get("type") == "cmd_start":
                    pass
                elif data.get("type") == "audio_data":
                    audio_bytes = base64.b64decode(data["data"])
                    await loop.run_once(audio_bytes, on_event=on_event)  # type: ignore

    except WebSocketDisconnect:
        logger.info("Willow unit %s disconnected (user=%s)", unit_id, user_id)
    except Exception as exc:
        logger.error("Willow WS error on unit %s: %s", unit_id, exc)
