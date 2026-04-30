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
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.websockets import WebSocketState

from core.auth import decode_token
from core.conversation_loop import ConversationLoop, _build_llm_provider, _build_stt_provider
from core.memory_manager import MemoryManager
from config.settings import get_settings


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

    # Require a valid JWT token — reject unauthenticated connections
    token: str = websocket.query_params.get("token", "")
    payload = decode_token(token) if token else None
    if not payload:
        await websocket.send_json({"type": "error", "message": "Authentication required."})
        await websocket.close(code=4001)
        return

    user_id: str = payload["sub"]
    logger.info("WebSocket connection from %s (user_id=%s).", websocket.client, user_id)

    memory_manager: MemoryManager | None = getattr(websocket.app.state, "memory_manager", None)

    # Load per-user LLM + voice settings from DB
    llm_provider = None
    llm_model    = None
    voice_id     = None
    if memory_manager and user_id != "default":
        try:
            store = memory_manager._store
            user_settings = await store.get_llm_settings(user_id)
            llm_provider = user_settings.provider
            llm_model    = user_settings.model
            voice_id     = user_settings.voice_id or None
            logger.info(
                "Using user settings: provider=%s model=%s voice=%s",
                llm_provider, llm_model, voice_id,
            )
        except Exception as exc:
            logger.warning("Could not load user settings: %s", exc)

    loop = ConversationLoop(
        user_id=user_id,
        memory_manager=memory_manager,
        llm_provider_override=llm_provider,
        llm_model_override=llm_model,
        voice_id_override=voice_id,
    )

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


# ---------------------------------------------------------------------------
# HTTP: Chat (SSE streaming) — used by ChatPage
# ---------------------------------------------------------------------------

class _ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    provider: str | None = None
    model_id: str | None = None


@router.post("/api/conversation/chat")
async def chat_http(
    body: _ChatRequest,
    request: Request,
) -> StreamingResponse:
    """
    Stateless HTTP chat endpoint for ChatPage.
    Streams the LLM response as SSE (data: <chunk>\n\n).
    History is passed in by the client; no server-side session state.
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    payload = decode_token(token) if token else None
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required.")

    user_id: str = payload["sub"]
    memory_manager: MemoryManager | None = getattr(request.app.state, "memory_manager", None)

    # Build system prompt with memory context
    settings = get_settings()
    system_prompt = settings.river_song_system_prompt
    if memory_manager:
        try:
            system_prompt += await memory_manager.build_context_block(user_id)
        except Exception:
            pass

    messages = [{"role": "system", "content": system_prompt}]
    for m in body.history[-20:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    llm = _build_llm_provider(
        provider_override=body.provider,
        model_override=body.model_id,
    )

    async def _stream():
        try:
            async for chunk in llm.stream_response(messages):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error("Chat HTTP stream error: %s", exc)
            yield f"data: [ERROR] {exc}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# HTTP: Extract facts from a completed chat session
# ---------------------------------------------------------------------------

class _ExtractFactsRequest(BaseModel):
    messages: list[dict]  # [{"role": "user"|"assistant", "content": "..."}]


@router.post("/api/conversation/extract-facts", status_code=202)
async def extract_facts_http(
    body: _ExtractFactsRequest,
    request: Request,
) -> dict:
    """
    Called fire-and-forget when a chat session ends.
    Uses the LLM to pull facts the user stated about themselves,
    then saves them to the memory store.
    """
    import asyncio, json as _json

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    payload = decode_token(token) if token else None
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required.")

    user_id: str = payload["sub"]
    memory_manager: MemoryManager | None = getattr(request.app.state, "memory_manager", None)
    if not memory_manager:
        return {"status": "no memory manager"}

    if len(body.messages) < 2:
        return {"status": "too short"}

    conversation_text = "\n".join(
        f"{m['role'].upper()}: {m.get('content', '')}"
        for m in body.messages
        if m.get("role") in ("user", "assistant")
    )

    extraction_prompt = (
        "You are building a memory profile for an AI assistant. "
        "Extract ANYTHING from the USER's messages that would help the AI know them better in future conversations.\n\n"
        "Capture broadly — do not filter:\n"
        "- Identity: name, age, gender, location, nationality\n"
        "- Work: job, employer, industry, role, career goals\n"
        "- Family & relationships: spouse, kids, pets, friends mentioned\n"
        "- Health: conditions, medications, fitness habits\n"
        "- Interests & hobbies: sports, games, music, food, TV, books\n"
        "- Opinions & preferences: things they like/dislike, how they prefer to communicate\n"
        "- Current situations: projects, problems, plans, events coming up\n"
        "- Emotions & mood if relevant: stressed, excited, tired\n\n"
        "Output ONLY a raw JSON array — no markdown, no code fences, no explanation.\n"
        "Each item: {\"key\": \"snake_case_key\", \"value\": \"concise plain text value\"}\n"
        "Example output: [{\"key\": \"job_title\", \"value\": \"aircraft mechanic\"}, "
        "{\"key\": \"employer\", \"value\": \"US Air Force\"}, "
        "{\"key\": \"communication_preference\", \"value\": \"prefers direct answers\"}]\n"
        "If the user shared nothing about themselves at all, output: []\n\n"
        f"CONVERSATION:\n{conversation_text}\n\n"
        "JSON array:"
    )

    import re as _re

    def _clean(text: str) -> str:
        text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
        text = _re.sub(r"```(?:json)?\s*", "", text).strip()
        return text

    def _parse_json_array(text: str):
        start = text.find("[")
        end   = text.rfind("]") + 1
        if start == -1 or end == 0:
            return None
        return _json.loads(text[start:end])

    async def _extract_facts():
        try:
            llm = _build_llm_provider()
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a precise fact extractor. Output only valid JSON."},
                {"role": "user",   "content": extraction_prompt},
            ]):
                full += chunk
            full = _clean(full)
            logger.info("Fact extraction output (user=%s): %s", user_id, full[:300])
            items = _parse_json_array(full)
            if not items:
                return
            saved = 0
            for f in items:
                key   = str(f.get("key",   "")).strip()
                value = str(f.get("value", "")).strip()
                if key and value:
                    await memory_manager.upsert_fact(user_id, key, value, source="inferred")
                    saved += 1
            logger.info("Facts saved (user=%s): %d", user_id, saved)
        except Exception as exc:
            logger.warning("Fact extraction failed (user=%s): %s", user_id, exc)

    async def _extract_preferences():
        pref_prompt = (
            "Identify communication and interaction preferences from the USER's messages.\n"
            "Look for: preferred response length, tone (formal/casual), topics they enjoy or avoid, "
            "how they like to be addressed, patience level, expertise areas they have.\n"
            "Output ONLY a raw JSON array — no markdown, no code fences.\n"
            "Each item: {\"category\": \"snake_case_category\", \"value\": \"description\", \"confidence\": \"low|medium|high\"}\n"
            "Example: [{\"category\": \"tone\", \"value\": \"casual and friendly\", \"confidence\": \"medium\"}]\n"
            "If no preferences are evident, output: []\n\n"
            f"CONVERSATION:\n{conversation_text}\n\nJSON array:"
        )
        try:
            llm = _build_llm_provider()
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a preference extractor. Output only valid JSON."},
                {"role": "user",   "content": pref_prompt},
            ]):
                full += chunk
            full = _clean(full)
            items = _parse_json_array(full)
            if not items:
                return
            saved = 0
            for p in items:
                cat   = str(p.get("category", "")).strip()
                value = str(p.get("value",    "")).strip()
                conf  = str(p.get("confidence", "low")).strip()
                if cat and value:
                    await memory_manager.upsert_preference(user_id, cat, value, confidence=conf)
                    saved += 1
            logger.info("Preferences saved (user=%s): %d", user_id, saved)
        except Exception as exc:
            logger.warning("Preference extraction failed (user=%s): %s", user_id, exc)

    async def _generate_summary():
        summary_prompt = (
            "Write a 2-3 sentence summary of this conversation for future reference.\n"
            "Focus on what was discussed, any decisions made, and key information shared.\n"
            "Be concise and factual. Plain text only — no lists, no markdown.\n\n"
            f"CONVERSATION:\n{conversation_text}\n\nSummary:"
        )
        try:
            llm = _build_llm_provider()
            full = ""
            async for chunk in llm.stream_response([
                {"role": "system", "content": "You are a concise summarizer."},
                {"role": "user",   "content": summary_prompt},
            ]):
                full += chunk
            full = _clean(full).strip()
            if full:
                await memory_manager.record_summary(user_id, full)
                logger.info("Summary saved (user=%s): %s", user_id, full[:100])
        except Exception as exc:
            logger.warning("Summary generation failed (user=%s): %s", user_id, exc)

    async def _run():
        await asyncio.gather(
            _extract_facts(),
            _extract_preferences(),
            _generate_summary(),
        )

    asyncio.create_task(_run())
    return {"status": "processing"}


# ---------------------------------------------------------------------------
# HTTP: Transcribe — mic-to-text for ChatPage
# ---------------------------------------------------------------------------

class _TranscribeRequest(BaseModel):
    audio: str  # base64 WAV


@router.post("/api/conversation/transcribe")
async def transcribe_http(
    body: _TranscribeRequest,
    request: Request,
) -> dict:
    """Transcribe a base64 WAV blob and return the text."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    payload = decode_token(token) if token else None
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        audio_bytes = base64.b64decode(body.audio)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid base64 audio.")

    stt = _build_stt_provider()
    try:
        text = await stt.transcribe(audio_bytes)
    except Exception as exc:
        logger.error("Transcription error: %s", exc)
        return {"text": ""}

    return {"text": text.strip()}
