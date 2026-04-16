# =============================================================================
# api/routes/conversation.py
#
# WebSocket endpoint for the River Song AI conversation loop.
#
# Clients connect to ws://host/ws/conversation and exchange JSON messages.
# One ConversationLoop instance is created per connection, maintaining
# independent conversation history per client.
#
# Message protocol
# ----------------
# Client -> Server:
#   {"type": "start"}           Begin one listen -> respond turn
#   {"type": "reset_history"}   Clear conversation history (keep providers)
#   {"type": "ping"}            Connectivity check
#
# Server -> Client:
#   {"type": "connected"}                        Sent once on successful connect
#   {"type": "listening"}                        Mic open, waiting for speech
#   {"type": "transcribing"}                     Running Whisper
#   {"type": "transcript",       "text": "..."}  What the user said
#   {"type": "thinking"}                         Sent to LLM, waiting for tokens
#   {"type": "response_chunk",   "text": "..."}  Streaming token (fires many times)
#   {"type": "response_complete","text": "..."}  Full assembled response
#   {"type": "speaking"}                         TTS playback started
#   {"type": "idle"}                             Ready for next command
#   {"type": "error",         "message": "..."}  Step failed; idle follows
#   {"type": "pong"}                             Response to ping
# =============================================================================

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from core.conversation_loop import ConversationLoop


logger = logging.getLogger(__name__)
router = APIRouter(tags=["conversation"])


@router.websocket("/ws/conversation")
async def conversation_websocket(websocket: WebSocket) -> None:
    """
    WebSocket handler for the River Song conversation loop.

    One ConversationLoop is instantiated per connection. Turns are
    sequential -- if the client sends 'start' while a turn is running,
    the message is queued by the receive loop and processed after the
    current turn completes. No concurrent turns occur on a single socket.

    The connection is closed gracefully on WebSocketDisconnect or on a
    fatal initialization error (code 1011 = internal server error).
    """
    await websocket.accept()
    logger.info("WebSocket connection from %s.", websocket.client)

    loop = ConversationLoop()

    # Notify the client that the socket is open and providers are loading
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

    # Main receive loop -- runs until the client disconnects or an
    # unrecoverable server error occurs
    try:
        while True:
            raw = await websocket.receive_text()

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "Received non-JSON message (first 200 chars): %s", raw[:200]
                )
                await _send(websocket, {
                    "type": "error",
                    "message": "Invalid message format -- expected JSON.",
                })
                continue

            msg_type = message.get("type", "")
            logger.debug("Received message type='%s'.", msg_type)

            if msg_type == "start":
                # Run a full conversation turn.
                # on_event is a lambda that returns a coroutine; run_once awaits it.
                await loop.run_once(
                    on_event=lambda evt: _send(websocket, evt)
                )

            elif msg_type == "reset_history":
                loop.reset_history()
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
    """
    Send a JSON payload over the WebSocket, absorbing send errors.

    Errors during send (client disconnected mid-message, network drop)
    are logged at DEBUG level and not re-raised. The main receive loop
    will detect the disconnection on its next receive_text() call.

    Args:
        websocket: The active WebSocket connection.
        payload:   Dict to serialize as JSON and send.
    """
    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_json(payload)
    except Exception as exc:
        logger.debug("Failed to send WebSocket message (%s): %s", payload.get("type"), exc)
