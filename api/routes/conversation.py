# =============================================================================
# api/routes/conversation.py
#
# WebSocket endpoint for the River Song AI conversation loop.
#
# Clients connect to ws://host/ws/conversation?user_id=<id> and exchange
# JSON messages. One ConversationLoop instance is created per connection,
# maintaining independent conversation history per client.
#
# Audio architecture:
#   The browser captures mic audio via the Web Audio API, encodes it as a
#   WAV file, and sends it as base64 JSON. The server transcribes with
#   Whisper, generates a response, synthesizes with Piper, and sends the
#   WAV bytes back as base64 JSON for the browser to play.
#   sounddevice is never used on the server.
#
# Message protocol
# ----------------
# Client -> Server:
#   {"type": "start"}                        Signal that browser is about to record
#   {"type": "audio_data", "data": "<b64>"}  Base64-encoded WAV from browser mic
#   {"type": "reset_history"}                Clear conversation history
#   {"type": "ping"}                         Connectivity check
#
# Server -> Client:
#   {"type": "connected"}                        Sent once on successful connect
#   {"type": "listening"}                        Sent in response to "start"
#   {"type": "transcribing"}                     Running Whisper on received audio
#   {"type": "transcript",       "text": "..."}  What the user said
#   {"type": "thinking"}                         Sent to LLM, waiting for tokens
#   {"type": "response_chunk",   "text": "..."}  Streaming token (fires many times)
#   {"type": "response_complete","text": "..."}  Full assembled response
#   {"type": "speaking"}                         TTS synthesis complete
#   {"type": "audio",            "data": "<b64>"}Base64 WAV for browser playback
#   {"type": "idle"}                             Ready for next command
#   {"type": "error",         "message": "..."}  Step failed; idle follows
#   {"type": "pong"}                             Response to ping
# =============================================================================

from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from core.conversation_loop import ConversationLoop
from core.memory_manager import MemoryManager


logger = logging.getLogger(__name__)
router = APIRouter(tags=["conversation"])


@router.websocket("/ws/conversation")
async def conversation_websocket(websocket: WebSocket) -> None:
    """
    WebSocket handler for the River Song conversation loop.

    One ConversationLoop is instantiated per connection. Each turn is
    two messages: the client sends "start" (browser begins recording),
    the server responds with "listening", then the client sends "audio_data"
    (browser finished recording), and the server processes it end-to-end.

    Query params:
        user_id: Identifies the caller. Used to load per-user auth files
                 (Audible, Libby). Defaults to "default" when omitted.
    """
    await websocket.accept()

    user_id: str = websocket.query_params.get("user_id", "default")
    logger.info("WebSocket connection from %s (user_id=%s).", websocket.client, user_id)

    memory_manager: MemoryManager | None = getattr(websocket.app.state, "memory_manager", None)
    loop = ConversationLoop(user_id=user_id, memory_manager=memory_manager)

    await _send(websocket, {"type": "connected"})

    try:
        await loop.initialize()
    except Exception as exc:
        logger.error("ConversationLoop initialization failed: %s", exc)
        await _send(websocket, {
            "type": "error",
            "message": f"Backend initialization failed: {exc}",
        })
        await websocket.close(code=1011)
        return

    await _send(websocket, {"type": "idle"})

    # Track whether we're waiting for the audio_data that follows a "start"
    waiting_for_audio: bool = False

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Received non-JSON message: %s", raw[:200])
                await _send(websocket, {
                    "type": "error",
                    "message": "Invalid message format -- expected JSON.",
                })
                continue

            msg_type = message.get("type", "")
            logger.debug("Received message type='%s'.", msg_type)

            if msg_type == "start":
                # Tell the browser to start recording
                waiting_for_audio = True
                await _send(websocket, {"type": "listening"})

            elif msg_type == "audio_data":
                if not waiting_for_audio:
                    await _send(websocket, {
                        "type": "error",
                        "message": "Received audio_data without a preceding start.",
                    })
                    continue

                waiting_for_audio = False

                raw_data = message.get("data", "")
                if not raw_data:
                    await _send(websocket, {
                        "type": "error",
                        "message": "audio_data message contained no data.",
                    })
                    await _send(websocket, {"type": "idle"})
                    continue

                try:
                    audio_bytes = base64.b64decode(raw_data)
                except Exception:
                    await _send(websocket, {
                        "type": "error",
                        "message": "audio_data could not be base64-decoded.",
                    })
                    await _send(websocket, {"type": "idle"})
                    continue

                await loop.run_once(
                    audio_bytes=audio_bytes,
                    on_event=lambda evt: _send(websocket, evt),
                )

            elif msg_type == "text_input":
                text = message.get("text", "").strip()
                if not text:
                    await _send(websocket, {"type": "idle"})
                    continue
                await loop.run_text(
                    text=text,
                    on_event=lambda evt: _send(websocket, evt),
                )

            elif msg_type == "reset_history":
                await loop.reset_history()
                waiting_for_audio = False
                await _send(websocket, {"type": "idle"})

            elif msg_type == "ping":
                await _send(websocket, {"type": "pong"})

            else:
                logger.warning("Unknown message type: '%s'.", msg_type)
                await _send(websocket, {
                    "type": "error",
                    "message": f"Unknown command: '{msg_type}'.",
                })

    except WebSocketDisconnect:
        logger.info("Client disconnected from %s.", websocket.client)

    except Exception as exc:
        logger.error(
            "Unexpected WebSocket error from %s: %s", websocket.client, exc, exc_info=True
        )
        if websocket.client_state == WebSocketState.CONNECTED:
            await _send(websocket, {
                "type": "error",
                "message": "An unexpected server error occurred.",
            })


async def _send(websocket: WebSocket, payload: dict) -> None:
    """Send a JSON payload, absorbing errors if the client already disconnected."""
    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_json(payload)
    except Exception as exc:
        logger.debug("Failed to send WebSocket message (%s): %s", payload.get("type"), exc)
