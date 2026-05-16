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

import asyncio
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
from core.wake_word_service import WakeWordService
from config.settings import get_settings
from core.limiter import limiter
from providers.web.search import build_search_provider


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

    # Require a valid one-time ticket OR (legacy) a valid JWT token
    ticket_id: str = websocket.query_params.get("ticket", "")
    token: str     = websocket.query_params.get("token", "")
    
    settings = get_settings()
    user_id: str | None = None
    is_kiosk = False

    # 1. Try one-time ticket exchange (New Pattern)
    if ticket_id:
        ticket = websocket.app.state.ws_tickets.pop(ticket_id, None)
        if ticket:
            now = datetime.now(tz=timezone.utc).timestamp()
            if now <= ticket["expires_at"]:
                user_id  = ticket["user_id"]
                is_kiosk = ticket["is_kiosk"]
                logger.info("WebSocket connection via ticket from %s (user_id=%s, kiosk=%s).", 
                            websocket.client, user_id, is_kiosk)
            else:
                logger.warning("WebSocket ticket expired: %s", ticket_id)
        else:
            logger.warning("WebSocket ticket invalid or reused: %s", ticket_id)

    # 2. Legacy: Try JWT token directly in query string (Audit H-4)
    if not user_id and token:
        if settings.legacy_ws_token_accept:
            payload = await decode_token(token)
            if payload:
                user_id = payload["sub"]
                logger.warning("WebSocket connection via LEGACY token query param from %s (user_id=%s).", 
                               websocket.client, user_id)
            elif token == settings.kiosk_token:
                user_id = settings.default_user_id
                is_kiosk = True
                logger.warning("WebSocket connection via LEGACY kiosk_token query param from %s.", websocket.client)
        else:
            logger.warning("WebSocket connection attempted via legacy token but LEGACY_WS_TOKEN_ACCEPT is False.")

    if not user_id:
        await websocket.send_json({"type": "error", "message": "Authentication required."})
        await websocket.close(code=4001)
        return

    # Register active connection for proactive briefings
    if user_id not in websocket.app.state.active_connections:
        websocket.app.state.active_connections[user_id] = []
    websocket.app.state.active_connections[user_id].append(websocket)

    memory_manager: MemoryManager | None = getattr(websocket.app.state, "memory_manager", None)

    # Load per-user LLM + voice settings from DB
    llm_provider = None
    llm_model    = None
    voice_id     = None
    fb_provider  = None
    fb_model     = None
    if memory_manager and user_id != "default":
        try:
            store = memory_manager._store
            user_settings = await store.get_llm_settings(user_id)
            llm_provider = user_settings.provider
            llm_model    = user_settings.model
            voice_id     = user_settings.voice_id or None
            
            if user_settings.cloud_fallback_enabled:
                fb_provider = user_settings.cloud_fallback_provider
                fb_model    = user_settings.cloud_fallback_model
                
            logger.info(
                "Using user settings: provider=%s model=%s voice=%s fallback=%s",
                llm_provider, llm_model, voice_id, fb_provider,
            )
        except Exception as exc:
            logger.warning("Could not load user settings: %s", exc)

    loop = ConversationLoop(
        user_id=user_id,
        memory_manager=memory_manager,
        llm_provider_override=llm_provider,
        llm_model_override=llm_model,
        voice_id_override=voice_id,
        fallback_provider=fb_provider,
        fallback_model=fb_model,
        is_kiosk=is_kiosk,
    )

    await _send(websocket, {"type": "connected"})

    try:
        await loop.initialize()
        
        # Fire-and-forget startup briefing — does not block the connection
        async def _startup_briefing():
            try:
                await loop.run_startup_briefing(on_event=lambda evt: _send(websocket, evt))
            except Exception as exc:
                logger.debug("Startup briefing skipped: %s", exc)
        
        asyncio.create_task(_startup_briefing())

    except Exception as exc:
        logger.error("ConversationLoop initialization failed: %s", exc)
        await _send(websocket, {
            "type": "error",
            "message": f"Backend initialization failed: {exc}",
        })
        await websocket.close(code=1011)
        return

    await _send(websocket, {"type": "idle"})

    # Wake word detection for Ambient Mode
    def on_wake():
        asyncio.create_task(_send(websocket, {"type": "wake_word_detected"}))
    
    wake_service = WakeWordService(on_wake_word=on_wake)
    ambient_mode = False

    # Track whether we're waiting for the audio_data that follows a "start"
    waiting_for_audio: bool = False

    try:
        while True:
            raw = await websocket.receive_text()
            # ... existing JSON parse ...
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = message.get("type", "")

            if msg_type == "ambient_mode":
                ambient_mode = bool(message.get("enabled", False))
                logger.info("Ambient mode %s (user_id=%s)", "enabled" if ambient_mode else "disabled", user_id)
                continue

            elif msg_type == "ambient_audio":
                if not ambient_mode:
                    continue
                
                raw_data = message.get("data", "")
                if raw_data:
                    try:
                        chunk = base64.b64decode(raw_data)
                        wake_service.process_chunk(chunk)
                    except Exception as exc:
                        logger.warning("Wake word chunk processing failed: %s", exc)
                continue

            elif msg_type == "settings":
                # Live session settings
                web_search = message.get("web_search")
                if web_search is not None:
                    loop._web_search_enabled = bool(web_search)
                    logger.info("WebSocket: web_search=%s", loop._web_search_enabled)
                continue

            elif msg_type == "start":
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
                if get_settings().llm_streaming_enabled:
                    await _send(websocket, {"type": "stream_done"})

            elif msg_type == "text_input":
                text = message.get("text", "").strip()
                if not text:
                    await _send(websocket, {"type": "idle"})
                    continue
                await loop.run_text(
                    text=text,
                    on_event=lambda evt: _send(websocket, evt),
                )
                if get_settings().llm_streaming_enabled:
                    await _send(websocket, {"type": "stream_done"})

            elif msg_type == "reset_history":
                flush = bool(message.get("flush_memory", False))
                await loop.reset_history(flush_memory=flush)
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
            
    finally:
        # Unregister active connection
        if user_id in websocket.app.state.active_connections:
            try:
                websocket.app.state.active_connections[user_id].remove(websocket)
                if not websocket.app.state.active_connections[user_id]:
                    del websocket.app.state.active_connections[user_id]
            except: pass


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
    web_search: bool = False
    system_prompt: str | None = None
    thinking_mode: bool = False
    forget_memory: bool = False


@router.post("/api/conversation/chat")
@limiter.limit(get_settings().rate_limit_chat)
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
    payload = await decode_token(token) if token else None
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required.")

    user_id: str = payload["sub"]
    memory_manager: MemoryManager | None = getattr(request.app.state, "memory_manager", None)

    # We use ConversationLoop to get full tool support and consistent behavior
    loop = ConversationLoop(
        user_id=user_id,
        memory_manager=memory_manager,
        llm_provider_override=body.provider,
        llm_model_override=body.model_id,
        is_kiosk=False,
    )
    loop._suppress_memory = body.forget_memory
    # Re-inject history into the loop
    for m in body.history[-20:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            loop._history.append({"role": role, "content": content})

    await loop.initialize()

    async def _stream():
        queue = asyncio.Queue()

        async def on_event(evt: dict):
            await queue.put(evt)

        # Run in a task so we can yield from the queue
        task = asyncio.create_task(loop.run_text(body.message, on_event))
        
        try:
            while True:
                # Wait for event or task completion
                done, _ = await asyncio.wait(
                    [asyncio.create_task(queue.get()), task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                # Check if task is done
                if task.done() and queue.empty():
                    break
                
                # Process queue items
                while not queue.empty():
                    evt = queue.get_nowait()
                    if evt["type"] in ("response_chunk", "token"):
                        text = evt.get("text") or evt.get("content", "")
                        yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"
                    elif evt["type"] in ("tool_use", "tool_result"):
                        yield f"data: {json.dumps(evt)}\n\n"
                    elif evt["type"] == "error":
                        yield f"data: {json.dumps({'type': 'error', 'content': evt['message']})}\n\n"
            
            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error("Chat HTTP stream error: %s", exc, exc_info=True)
            
            # Classify error
            code = "internal_error"
            msg = "An unexpected error occurred during streaming."
            
            err_str = str(exc).lower()
            if "rate limit" in err_str or "429" in err_str:
                code = "rate_limited"
                msg = "The AI provider is currently rate-limited. Please try again in a moment."
            elif "timeout" in err_str:
                code = "timeout"
                msg = "The request timed out. The model may be overloaded."
            elif "authentication" in err_str or "api key" in err_str:
                code = "model_unavailable"
                msg = "The selected AI model is currently unavailable (auth failure)."
            
            yield f"data: {json.dumps({'type': 'error', 'code': code, 'content': msg})}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# HTTP: Extract facts from a completed chat session
# ---------------------------------------------------------------------------

class _ExtractFactsRequest(BaseModel):
    messages: list[dict]  # [{"role": "user"|"assistant", "content": "..."}]


@router.post("/api/conversation/extract-facts", status_code=202)
@limiter.limit(get_settings().rate_limit_extract_facts)
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
    payload = await decode_token(token) if token else None
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
        "Use ONLY these canonical snake_case keys:\n"
        "- Identity: full_name, first_name, last_name, age, gender, location, nationality\n"
        "- Work: job_title, employer, industry, role, career_goals\n"
        "- Family: spouse_name, child_name, pet_name, relative_name, friend_name\n"
        "- Health: health_condition, medication, diet, fitness_habit\n"
        "- Interests: hobby, interest, favorite_food, favorite_music, favorite_tv_show, favorite_book\n"
        "- Style: preference, dislike, communication_style, tone_preference\n"
        "- Context: current_project, problem, plan, upcoming_event, mood\n\n"
        "Capture broadly but categorize into these keys. Output ONLY a raw JSON array.\n"
        "Each item: {\"key\": \"canonical_key\", \"value\": \"concise plain text value\"}\n"
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
# HTTP: Enhance prompt
# ---------------------------------------------------------------------------

class _EnhanceRequest(BaseModel):
    prompt: str


@router.post("/api/conversation/enhance-prompt")
async def enhance_prompt_http(
    body: _EnhanceRequest,
    request: Request,
) -> dict:
    """
    Rewrites a short user prompt into a clearer, more detailed version.
    Uses the default LLM. Returns {"enhanced": "<improved prompt>"}.
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    payload = await decode_token(token) if token else None
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not body.prompt or not body.prompt.strip():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Prompt is empty.")
    meta_prompt = (
        "Rewrite the following user prompt to be clearer, more specific, and better "
        "structured for an AI assistant. Return only the improved prompt — no explanation, "
        "no preamble, no quotes.\n\nOriginal prompt:\n"
        + body.prompt.strip()
    )
    messages = [
        {"role": "system", "content": "You are a prompt engineering assistant."},
        {"role": "user", "content": meta_prompt},
    ]
    try:
        llm = _build_llm_provider()
        full = ""
        async for chunk in llm.stream_response(messages):
            full += chunk
        enhanced = full.strip()
        if not enhanced:
            enhanced = body.prompt.strip()
        return {"enhanced": enhanced}
    except Exception as exc:
        logger.error("Enhance prompt error: %s", exc)
        return {"enhanced": body.prompt.strip()}


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
    payload = await decode_token(token) if token else None
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
