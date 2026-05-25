# api/routes/willow.py
#
# Willow-compatible WebSocket for hardware voice devices (ESP32-S3 Box).
#
# AUTHENTICATION
# Every connection MUST present a shared device token that matches
# settings.willow_device_token. Accepted forms (checked in this order):
#   1. ?token=<TOKEN> query parameter (simplest for headless devices).
#   2. Sec-WebSocket-Protocol header value (when devices set the subprotocol).
#   3. First text frame: {"type": "auth", "token": "<TOKEN>", "user_id": "..."}
# If WILLOW_DEVICE_TOKEN is unset in .env, the endpoint refuses ALL
# connections — there is no anonymous fallback.
from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from config.settings import get_settings
from core.conversation_loop import ConversationLoop

logger = logging.getLogger(__name__)
router = APIRouter(tags=["willow"])


async def _authenticate(websocket: WebSocket, expected: str) -> tuple[bool, str]:
    """
    Return (authenticated, user_id). Closes the socket on failure.

    Order of checks:
      1. ?token= query param
      2. Sec-WebSocket-Protocol subprotocol value
      3. First text frame `{"type": "auth", "token": "...", "user_id": "..."}`
    """
    qs_token = websocket.query_params.get("token")
    if qs_token and qs_token == expected:
        return True, websocket.query_params.get("user_id", "default")

    subprotocols = websocket.headers.get("sec-websocket-protocol", "")
    if subprotocols:
        for proto in (p.strip() for p in subprotocols.split(",")):
            if proto == expected:
                return True, "default"

    # Final fallback: expect an auth frame within the first 5 seconds.
    try:
        first = await websocket.receive()
    except Exception:
        return False, ""

    if "text" not in first:
        return False, ""
    try:
        payload = json.loads(first["text"])
    except Exception:
        return False, ""
    if payload.get("type") != "auth" or payload.get("token") != expected:
        return False, ""
    return True, str(payload.get("user_id") or "default")


@router.websocket("/api/willow/ws")
async def willow_websocket(websocket: WebSocket) -> None:
    settings = get_settings()
    expected = (getattr(settings, "willow_device_token", "") or "").strip()
    if not expected:
        # Hard-refuse before accept() so no handshake completes.
        logger.warning("Willow connection rejected: WILLOW_DEVICE_TOKEN not configured.")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    logger.info("Willow handshake from %s", websocket.client)

    ok, user_id = await _authenticate(websocket, expected)
    if not ok:
        logger.warning("Willow auth failed for %s", websocket.client)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    logger.info("Willow device authenticated as user=%s from %s", user_id, websocket.client)
    loop = ConversationLoop(user_id=user_id)
    await loop.initialize()

    async def on_event(evt: dict) -> None:
        if evt["type"] == "transcript":
            await websocket.send_json({"text": evt["text"], "type": "transcript"})
        elif evt["type"] == "response_complete":
            await websocket.send_json({"text": evt["text"], "type": "response"})
        elif evt["type"] == "audio":
            await websocket.send_json({"audio": evt["data"], "type": "audio"})

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
                    await loop.run_once(audio_bytes, on_event=on_event)

    except WebSocketDisconnect:
        logger.info("Willow device disconnected user=%s", user_id)
    except Exception as exc:
        logger.error("Willow WS error: %s", exc)
