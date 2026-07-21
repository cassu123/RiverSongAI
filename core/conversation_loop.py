# =============================================================================
# core/conversation_loop.py
#
# Orchestrates the River Song AI conversation loop.
#
# One complete turn (Phase 2 flow):
#   1. Record audio from the microphone  (STT provider)
#   2. Transcribe audio to text          (STT provider)
#   3. Route transcript via IntentRouter
#        a. Google intent matched -> speak response, skip LLM
#        b. No match -> fall through to Ollama
#   4. Stream LLM response               (LLM provider) -- Ollama path only
#   5. Synthesize and play TTS           (TTS provider)
#
# Each step fires an async event callback so the WebSocket route can forward
# state changes to the frontend in real time as they happen.
#
# Provider instances are built from .env configuration via factory functions,
# making the entire pipeline swappable without touching this file.
#
# History management:
#   The loop maintains an ordered list of messages (system + user + assistant)
#   that grows across turns. Call reset_history() to start a fresh conversation
#   without reinitializing providers.
# =============================================================================

from __future__ import annotations

import asyncio
import base64
import logging
import re
from typing import Union, Any, Callable, Coroutine, List, Optional, AsyncGenerator

from config.settings import get_settings
from core.kill_switch import is_kill_switch_active
from core.intent_router import get_intent_router
from core.memory_manager import MemoryManager
from providers.base import LLMProvider, STTProvider, TTSProvider
from providers.memory.graphiti_provider import Episode, get_graphiti_provider


logger = logging.getLogger(__name__)

# Type alias: an async callable that accepts a dict event payload.
# Typically sends JSON over a WebSocket connection.
EventCallback = Callable[[Union[dict, bytes]],
                         Coroutine[Any, Any, None]]  # type: ignore


class FallbackLLMProvider(LLMProvider):
    """
    Wraps two LLM providers. If the primary provider fails during streaming,
    it automatically falls back to the secondary provider for the remainder
    of the request.
    """

    def __init__(self, primary: LLMProvider, secondary: LLMProvider):
        self.primary = primary
        self.secondary = secondary

    async def stream_response(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        try:
            async for chunk in self.primary.stream_response(messages):
                yield chunk
        except Exception as exc:
            logger.warning(
                "Primary LLM failed, falling back to secondary: %s", exc)
            async for chunk in self.secondary.stream_response(messages):
                yield chunk

    async def stream_response_thinking(
            self, messages: List[dict]) -> AsyncGenerator[str, None]:
        try:
            async for chunk in self.primary.stream_response_thinking(messages):
                yield chunk
        except Exception as exc:
            logger.warning(
                "Primary LLM (thinking) failed, falling back to secondary: %s", exc)
            async for chunk in self.secondary.stream_response_thinking(messages):
                yield chunk


# -----------------------------------------------------------------------------
# Provider factories
# -----------------------------------------------------------------------------

def _build_stt_provider(model_size: Optional[str] = None) -> STTProvider:
    """
    Instantiate the STT provider named in STT_PROVIDER.

    Returns:
        STTProvider: Concrete provider instance ready to use.

    Raises:
        ValueError: If the configured provider key is not supported.
        RuntimeError: If the provider fails to initialize (e.g., model load fails).
    """
    key = get_settings().stt_provider
    if key == "whisper_local":
        from providers.stt.whisper_local import WhisperLocalSTT
        return WhisperLocalSTT(model_size=model_size)
    raise ValueError(
        f"Unsupported STT_PROVIDER '{key}'. Supported values: whisper_local"
    )


def _instantiate_llm(key: str, model: Optional[str]) -> LLMProvider:
    """Internal helper to build a single LLM provider."""
    settings = get_settings()
    if key == "ollama":
        from providers.llm.ollama import OllamaLLM
        return OllamaLLM(model=model) if model else OllamaLLM()
    if key == "anthropic":
        if not settings.anthropic_enabled:
            raise ValueError(
                "Anthropic LLM is disabled. Set ANTHROPIC_ENABLED=true in .env.")
        from providers.llm.claude_api import ClaudeAPILLM
        return ClaudeAPILLM(model=model) if model else ClaudeAPILLM()
    if key == "gemini":
        if not settings.gemini_enabled:
            raise ValueError(
                "Gemini LLM is disabled. Set GEMINI_ENABLED=true in .env.")
        from providers.llm.gemini import GeminiLLM
        return GeminiLLM(model=model) if model else GeminiLLM()
    if key == "openai":
        if not settings.openai_enabled:
            raise ValueError(
                "OpenAI LLM is disabled. Set OPENAI_ENABLED=true in .env.")
        from providers.llm.openai_api import OpenAILLM
        return OpenAILLM(model=model) if model else OpenAILLM()
    if key == "mistral_ai":
        if not settings.mistral_ai_enabled:
            raise ValueError(
                "Mistral AI LLM is disabled. Set MISTRAL_AI_ENABLED=true in .env.")
        from providers.llm.mistral_api import MistralAILLM
        return MistralAILLM(model=model) if model else MistralAILLM()
    if key == "bedrock":
        if not settings.bedrock_enabled:
            raise ValueError(
                "Amazon Bedrock is disabled. Set BEDROCK_ENABLED=true in .env.")
        from providers.llm.bedrock import BedrockLLM
        return BedrockLLM(model=model) if model else BedrockLLM()
    if key == "nvidia_nim":
        from api.routes.models_settings import _get_enabled_providers
        if not _get_enabled_providers().get("nvidia_nim", False):
            raise ValueError(
                "NVIDIA NIM is disabled. Set NVIDIA_API_KEY in .env or enable it in Settings.")
        from providers.llm.nvidia_nim import NvidiaNimLLM
        return NvidiaNimLLM(model=model) if model else NvidiaNimLLM()
    raise ValueError(
        f"Unsupported LLM_PROVIDER '{key}'. "
        f"Supported values: ollama | anthropic | gemini | openai | mistral_ai | bedrock | nvidia_nim"
    )


def _build_llm_provider(
    provider_override: Optional[str] = None,
    model_override: Optional[str] = None,
    fallback_provider: Optional[str] = None,
    fallback_model: Optional[str] = None,
    message_text: Optional[str] = None,
    admin_config: Optional[dict] = None,
) -> tuple[LLMProvider, Optional[str]]:
    """
    Instantiate the LLM provider.

    When provider_override is "auto" and model_intent_router_enabled is true,
    the model intent router classifies message_text and picks the best provider.

    Returns:
        (provider_instance, router_label) — router_label is a UI display string
        like "Nemotron · Reasoning" when Auto routing was used, else None.
    """
    settings = get_settings()
    key = provider_override or settings.llm_provider
    router_label: Optional[str] = None

    from api.routes.models_settings import _get_enabled_providers
    enabled_providers = _get_enabled_providers(admin_config)

    # Tracks whether this turn was resolved by the "auto" (River decides)
    # router. When River routes to a cloud/NIM model we always keep a local
    # Ollama safety net so a NIM rate-limit or auth failure never dead-ends
    # the conversation.
    auto_routed = False

    if key == "auto":
        auto_routed = True
        if settings.model_intent_router_enabled and message_text:
            from providers.llm.model_intent_router import route as router_route
            try:
                decision = router_route(message_text, enabled_providers)
                key = decision.provider
                model_override = decision.model_id
                router_label = decision.display_label
                logger.info(
                    "Intent router: '%s' → %s/%s (score=%d)",
                    decision.intent, key, model_override, decision.confidence,
                )
            except Exception as exc:
                logger.error(
                    "Intent router failed, falling back to direct provider resolution: %s", exc)
                key = fallback_provider or settings.llm_provider
                model_override = fallback_model or settings.llm_model
        else:
            # Router disabled or no message text yet — default to local.
            key = "ollama"
            model_override = fallback_model or settings.llm_model

    if key != "auto" and key in enabled_providers and not enabled_providers[key]:
        raise ValueError(
            f"Provider '{key}' is disabled globally by the administrator.")

    primary = _instantiate_llm(key, model_override)

    # Explicit per-user cloud fallback (admin-configured) takes priority.
    if fallback_provider:
        try:
            secondary = _instantiate_llm(fallback_provider, fallback_model)
            return FallbackLLMProvider(primary, secondary), router_label
        except Exception as exc:
            logger.warning(
                "Failed to initialize secondary LLM fallback: %s", exc)

    # River-decided cloud/NIM pick with no explicit fallback: guarantee a
    # local Ollama safety net so NVIDIA NIM (or any cloud) errors degrade
    # gracefully to a local model instead of failing the turn.
    if auto_routed and key != "ollama":
        try:
            local_safety = _instantiate_llm("ollama", _get_local_default_model())
            return FallbackLLMProvider(primary, local_safety), router_label
        except Exception as exc:
            logger.warning(
                "Failed to build local safety-net for auto-routed '%s': %s", key, exc)

    return primary, router_label


def _get_local_default_model() -> Optional[str]:
    """Best-effort local model id for the auto-route safety net."""
    try:
        return get_settings().llm_model or "llama3.2:3b"
    except Exception:
        return "llama3.2:3b"


def _build_tts_provider(
        voice_id_override: Optional[str] = None) -> TTSProvider:
    """
    Instantiate the TTS provider for the active voice.

    Resolution order:
      1. voice_id_override — per-user preference from SQLite (no restart needed)
      2. ACTIVE_VOICE_ID in .env — system-wide fallback
      3. TTS_PROVIDER setting → piper | none
    """
    settings = get_settings()

    # Per-user override (from SQLite) takes priority over system .env default
    active_id = voice_id_override or getattr(
        settings, "active_voice_id", "") or ""
    if active_id:
        try:
            from providers.tts.voice_registry import VoiceRegistry
            entry = VoiceRegistry.get(active_id)
            if entry:
                if entry.engine == "kokoro":
                    from providers.tts.kokoro_provider import KokoroTTS
                    return KokoroTTS(voice_code=entry.voice_code)
                if entry.engine == "piper":
                    from providers.tts.piper import PiperTTS
                    return PiperTTS()
                if entry.engine == "chatterbox":
                    from providers.tts.chatterbox_provider import ChatterboxTTS
                    return ChatterboxTTS()
                if entry.engine == "elevenlabs":
                    from providers.tts.elevenlabs import ElevenLabsTTS
                    return ElevenLabsTTS(voice_code=entry.voice_code)
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).warning(
                "TTS provider initialization failed for '%s': %s — falling back to Piper",
                active_id, exc,
            )
            from providers.tts.piper import PiperTTS
            return PiperTTS()

    # Registry miss → fall back to legacy TTS_PROVIDER key
    key = settings.tts_provider
    if key == "piper":
        from providers.tts.piper import PiperTTS
        return PiperTTS()
    if key == "kokoro":
        from providers.tts.kokoro_provider import KokoroTTS
        return KokoroTTS()
    if key in ("none", "disabled", ""):
        from providers.tts.null_tts import NullTTS
        return NullTTS()
    raise ValueError(
        f"Unsupported TTS_PROVIDER '{key}'. Supported values: piper | kokoro | none"
    )


# -----------------------------------------------------------------------------
# ConversationLoop
# -----------------------------------------------------------------------------

class ConversationLoop:
    """
    Manages a stateful, multi-turn conversation with River Song.

    One instance is created per WebSocket connection, so each client
    gets its own independent conversation history. Providers (Whisper,
    Ollama, Piper) are heavyweight and initialized once; call
    initialize() before the first run_once().

    Event flow per turn:
        listening -> transcribing -> transcript -> routing ->
        [Google path] response_complete -> speaking -> idle
        [Ollama path] thinking -> response_chunk* -> response_complete -> speaking -> idle

    Any step that fails fires an error event and then idle, so the
    frontend always returns to a ready state.
    """

    def __init__(
        self,
        user_id: Optional[str] = None,
        memory_manager: Optional[MemoryManager] = None,
        llm_provider_override: Optional[str] = None,
        llm_model_override: Optional[str] = None,
        voice_id_override: Optional[str] = None,
        fallback_provider: Optional[str] = None,
        fallback_model: Optional[str] = None,
        stt_model_override: Optional[str] = None,
        mode: str = "voice",
        session_id: Optional[str] = None,
        tool_context_extras: Optional[dict] = None,
    ) -> None:
        settings = get_settings()
        self._settings = settings
        self._system_prompt: str = settings.river_song_system_prompt
        self._user_id: str = user_id or settings.default_user_id
        self._session_id: Optional[str] = session_id
        self._memory: Optional[MemoryManager] = memory_manager
        self._llm_provider_override: Optional[str] = llm_provider_override
        self._llm_model_override: Optional[str] = llm_model_override
        self._voice_id_override: Optional[str] = voice_id_override
        self._fallback_provider: Optional[str] = fallback_provider
        self._fallback_model: Optional[str] = fallback_model
        self._stt_model_override: Optional[str] = stt_model_override
        self._mode: str = mode
        self._stt: Optional[STTProvider] = None
        self._llm: Optional[LLMProvider] = None
        self._tts: Optional[TTSProvider] = None
        # Admin global LLM toggles, cached at initialize() so the per-message
        # "auto" router (River decides) can respect them without a DB hit.
        self._admin_config: dict = {}
        self._history: List[dict] = []
        self._initialized: bool = False
        self._turn_transcript: str = ""
        self._flush_memory: bool = False
        self._web_search: Optional[bool] = None
        # "fast" | "thinking" | "pro"
        self._thinking_mode: Optional[str] = "fast"
        self._suppress_memory: bool = False
        self._gen_id: int = 0
        self._generation_task: Optional[asyncio.Task] = None
        # Track fire-and-forget tasks so their exceptions get logged instead
        # of silently dropped, and so they can be awaited at shutdown.
        # (audit LOGIC-002)
        self._background_tasks: "set[asyncio.Task]" = set()
        # Per-conversation cache of (query_text → skills_block). Avoids
        # re-embedding + re-querying Chroma for the same transcript across
        # back-to-back turns (e.g. when the user re-issues the same query).
        self._skills_block_cache: "dict[str, str]" = {}
        self._tool_context_extras: "dict[str, Any]" = tool_context_extras or {}

    def cancel_generation(self) -> None:
        """Immediately abort the current LLM + TTS generation task."""
        task = getattr(self, "_generation_task", None)
        if task is not None and not task.done():
            task.cancel()
            self._generation_task = None

    def _spawn_background(self, coro, label: str) -> "asyncio.Task":
        """
        Schedule ``coro`` as a tracked background task.

        Wraps ``coro`` so unhandled exceptions are logged with traceback
        instead of silently raising "Task exception was never retrieved" at
        garbage-collection time.
        """
        async def _runner():
            try:
                await coro
            except Exception as exc:
                logger.error(
                    "Background task %s failed: %s",
                    label,
                    exc,
                    exc_info=True)
        task = asyncio.create_task(_runner())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def initialize(self) -> None:
        """
        Build and warm up all providers.

        Call once before the first run_once(). This is intentionally
        async so provider errors surface as awaitable exceptions rather
        than blowing up at import time.

        Raises:
            RuntimeError: If any provider fails to initialize.
            ValueError: If a configured provider name is unknown.
        """
        if self._initialized:
            return

        logger.info("Initializing ConversationLoop providers...")
        loop = asyncio.get_running_loop()

        admin_config = {}
        if self._memory and hasattr(self._memory, "_store"):
            try:
                assert self._memory is not None
                admin_config = await self._memory._store.get_admin_config()
            except Exception as e:
                logger.warning(
                    "Failed to fetch admin config for LLM routing: %s", e)
        self._admin_config = admin_config

        try:
            llm_provider_override = self._llm_provider_override
            llm_model_override = self._llm_model_override
            voice_id_override = self._voice_id_override
            fallback_provider = self._fallback_provider
            fallback_model = self._fallback_model
            stt_model_override = self._stt_model_override

            def _build_llm():
                llm, _router_label = _build_llm_provider(
                    provider_override=llm_provider_override,
                    model_override=llm_model_override,
                    fallback_provider=fallback_provider,
                    fallback_model=fallback_model,
                    admin_config=admin_config,
                )
                return llm

            self._llm = await loop.run_in_executor(None, _build_llm)
            
            if self._mode == "voice":
                from core.provider_pool import ProviderPool
                pool = await ProviderPool.get_instance()
                self._stt = await pool.get_stt(model_size=stt_model_override)
                self._tts = await pool.get_tts(voice_id=voice_id_override)
            else:
                self._stt = None
                self._tts = None

        except Exception as exc:
            raise RuntimeError(
                f"ConversationLoop failed to initialize: {exc}"
            ) from exc

        await self._rebuild_system_prompt()

        # Load history if session_id is present
        if self._session_id and self._memory and hasattr(self._memory._store, 'get_chat_messages'):
            try:
                db_msgs = await self._memory._store.get_chat_messages(self._user_id, self._session_id)
                # Take last 20 messages to prevent infinite context growth
                for m in db_msgs[-20:]:
                    role = m.get("role")
                    content = m.get("content")
                    # meta = m.get("meta") # not currently parsed back into loop
                    if role and content:
                        self._history.append({"role": role, "content": content})
                logger.info("ConversationLoop initialized with session %s (%d msgs loaded)", self._session_id, len(db_msgs))
            except Exception as e:
                logger.error("Failed to load history for session %s: %s", self._session_id, e)
        else:
            if not self._session_id and self._memory and hasattr(self._memory._store, 'create_chat_session'):
                try:
                    meta = {}
                    if self._tool_context_extras.get("vehicle_id"):
                        meta["scope"] = f"vehicle:{self._tool_context_extras['vehicle_id']}"
                    self._session_id = await self._memory._store.create_chat_session(self._user_id, "", meta=meta)
                except Exception as e:
                    logger.error("Failed to create chat session: %s", e)

        self._initialized = True
        logger.info("ConversationLoop ready.")

    async def run_startup_briefing(self, on_event: EventCallback) -> None:
        """
        Deliver pending brief if any, with TTS behavior.
        """
        try:
            from datetime import datetime, timezone
            assert self._memory is not None
            store = self._memory._store
            
            # Find undelivered brief for today
            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")
            dedupe = f"brief_{today_str}"
            
            pending = await store._fetch_one(
                "SELECT id, body FROM proactive_log WHERE user_id = ? AND dedupe_key = ? AND delivered = 0",
                (self._user_id, dedupe)
            )
            
            if not pending:
                return
                
            response = pending["body"]
            if not response:
                return

            # Mark as delivered
            await store._execute("UPDATE proactive_log SET delivered = 1 WHERE id = ?", (pending["id"],))

            # Dispatch events
            await on_event({"type": "proactive_briefing_start", "text": response})

            # Synthesize TTS
            await on_event({"type": "speaking"})
            assert self._tts is not None
            audio_bytes = await self._tts.synthesize(response)
            if audio_bytes:
                import base64
                b64 = base64.b64encode(audio_bytes).decode("utf-8")
                # ElevenLabs returns mp3, Piper/Kokoro return wav
                fmt = "mp3" if self._tts.__class__.__name__ == "ElevenLabsTTS" else "wav"
                await on_event({"type": "audio", "data": b64, "format": fmt})

            await on_event({"type": "response_complete", "text": response})
            await on_event({"type": "idle"})

        except Exception as exc:
            logger.debug("Startup briefing skipped: %s", exc)

    # Stable markers used to splice dynamic blocks (RAG, skills) into the
    # system prompt while keeping the operation idempotent across turns.
    # Prior block (from a previous turn) is stripped before the new block
    # is appended so the system message does not grow unboundedly.
    _RAG_BLOCK_MARKER = "\n\nRELEVANT DOCUMENT EXCERPTS:"
    _SKILLS_BLOCK_MARKER = "\n\n[ User skills relevant to this turn ]"

    def _splice_system_block(self, marker: str, body: str) -> None:
        """Replace (or append) a dynamic block in the system prompt.

        Strips any previous block starting at `marker` from the system
        message's content, then appends `marker + body` (if body is
        non-empty). Safe no-op when `_history` is empty or the first
        message is not a system message.
        """
        if not self._history or self._history[0].get("role") != "system":
            return
        current = self._history[0].get("content") or ""
        idx = current.find(marker)
        base = current[:idx] if idx >= 0 else current
        new_content = base + (marker + body if body else "")
        self._history[0] = {"role": "system", "content": new_content}

    async def _inject_skills_block(self, query: str) -> None:
        """Vector-retrieve top-k skills for `query` and splice them into the
        system prompt. Cached per-conversation so back-to-back identical
        transcripts hit the cache instead of re-embedding.
        """
        if not getattr(self._settings, "skills_enabled", False):
            self._splice_system_block(self._SKILLS_BLOCK_MARKER, "")
            return
        try:
            cached = self._skills_block_cache.get(query)
            if cached is not None:
                block = cached
            else:
                from core.skills import get_relevant_skills, render_skills_block
                hits = await get_relevant_skills(query, owner_id=self._user_id)
                block = render_skills_block(hits)
                self._skills_block_cache[query] = block
                # Bound the cache so a long-running conversation can't OOM.
                if len(self._skills_block_cache) > 64:
                    # Drop oldest insertion order — dicts preserve insertion.
                    oldest = next(iter(self._skills_block_cache))
                    self._skills_block_cache.pop(oldest, None)
            # render_skills_block starts with the same header string we use
            # as our splice marker — strip it so we don't double up the
            # header in the system prompt.
            header = self._SKILLS_BLOCK_MARKER.lstrip("\n")
            body = block
            if body.startswith(header):
                body = body[len(header):].lstrip("\n")
            self._splice_system_block(
                self._SKILLS_BLOCK_MARKER,
                "\n" + body if body else "")
        except Exception as exc:
            logger.warning("Skill injection failed: %s", exc)

    async def _rebuild_system_prompt(self, query_text: Optional[str] = None) -> None:
        """Rebuild the system prompt with current memory context, then reset history."""
        memory_block = ""
        if self._memory and not self._flush_memory and not self._suppress_memory:
            try:
                memory_block = await self._memory.build_context_block(self._user_id, query_text=query_text)
            except Exception as exc:
                logger.warning(
                    "Memory context build failed (user=%s): %s",
                    self._user_id,
                    exc)

        # NEW: inject live environment context (Task D)
        context_block = ""
        try:
            from main import get_app
            app = get_app()
            if app:
                engine = getattr(app.state, "context_engine", None)
                if engine:
                    context_block = engine.build_context_block()
        except Exception as exc:
            logger.debug("Context injection skipped: %s", exc)

        mode_block = ""
        if self._thinking_mode in ("thinking", "pro"):
            mode_block += (
                "\n\nREASONING MODE: Think step-by-step before answering. "
                "Briefly outline your reasoning, then give the final answer."
            )
            if self._thinking_mode == "pro":
                mode_block += (
                    " Be especially careful and thorough — verify assumptions, "
                    "consider edge cases, and double-check your reasoning."
                )
        if self._web_search:
            mode_block += (
                "\n\nWEB ACCESS: The web_search tool is available. "
                "Use it when the user asks about current events, recent facts, "
                "or anything outside your training cutoff."
            )

        vehicle_block = ""
        vid = self._tool_context_extras.get("vehicle_id")
        if vid:
            try:
                from api.routes.vehicles import get_vehicles
                from core.tools import _get_db_for_tools
                db, close = _get_db_for_tools({})
                vehicles = get_vehicles(db, self._user_id)
                v = next((x for x in vehicles if str(x.id) == vid), None)
                if v:
                    vehicle_block = f"\n\nVEHICLE CONTEXT:\nYou are actively assisting with the vehicle '{v.nickname or v.model}' ({v.year} {v.make} {v.model}, VIN: {v.vin or 'Unknown'}). When using vehicle tools, this vehicle is implied."
                if close: db.close()
            except Exception as e:
                logger.debug("Vehicle context injection skipped: %s", e)

        full_system = self._system_prompt + memory_block + context_block + mode_block + vehicle_block
        if self._history and self._history[0].get("role") == "system":
            self._history[0]["content"] = full_system
        else:
            self._history = [{"role": "system", "content": full_system}]

        # Clear the flag so memory is only skipped on the next turn
        # (session-scoped)
        self._flush_memory = False

    async def _append_history(self, role: str, content: Any, meta: Dict[str, Any] = None) -> None:
        """Append to in-memory history and persist to DB if enabled."""
        self._history.append({"role": role, "content": content})
        if self._memory and self._session_id and hasattr(self._memory._store, 'add_chat_message'):
            try:
                content_str = str(content) if not isinstance(content, str) else content
                await self._memory._store.add_chat_message(
                    self._session_id,
                    role,
                    content_str,
                    meta or {}
                )
            except Exception as e:
                logger.error("Failed to persist message to DB: %s", e)

    async def _stream_sentences(self, stream: AsyncGenerator[str, None], on_token: Callable[[
                                str], Coroutine[Any, Any, None]]) -> AsyncGenerator[str, None]:
        """Buffer LLM tokens and yield complete sentences for TTS."""
        buffer = ""
        # Match sentence endings: . ! ? or newline
        sentence_end = re.compile(r'(.+?[.!?\n]+)(?:\s+|$)')

        async for chunk in stream:
            await on_token(chunk)
            buffer += chunk

            while True:
                match = sentence_end.search(buffer)
                if not match:
                    break

                sentence = match.group(1).strip()
                if sentence:
                    yield sentence
                buffer = buffer[match.end():]

        # Final remaining text
        if buffer.strip():
            yield buffer.strip()

    async def _process_tts_stream(
            self, sentence_stream: AsyncGenerator[str, None], on_event: EventCallback):
        """Consume sentences and stream audio chunks to the browser."""
        seq_id = 0
        async for sentence in sentence_stream:
            if not sentence.strip():
                continue

            audio_data = b""
            assert self._tts is not None
            async for chunk in self._tts.stream_synthesize(sentence):
                if chunk:
                    audio_data += chunk

            if audio_data:
                await on_event({"type": "speaking"})
                # ElevenLabs returns mp3, Piper/Kokoro return wav
                fmt = "mp3" if self._tts.__class__.__name__ == "ElevenLabsTTS" else "wav"

                # Strip WAV header if present (44 bytes typically for simple
                # RIFF)
                if fmt == "wav" and audio_data.startswith(b"RIFF"):
                    pcm_data = audio_data[44:]
                else:
                    pcm_data = audio_data

                import struct
                header = struct.pack("<HH", self._gen_id, seq_id)
                await on_event(header + pcm_data)

                seq_id += 1

    async def run_once(self, audio_bytes: bytes,
                       on_event: EventCallback) -> None:
        """
        Execute one full conversation turn: transcribe -> respond -> speak.

        Audio bytes come from the browser (WAV file captured by Web Audio API
        and sent over the WebSocket). TTS output is returned as WAV bytes in
        an "audio" event rather than played server-side.

        Events fired via on_event during a successful turn:
          {"type": "transcribing"}
              Whisper is running on the received audio bytes.

          {"type": "transcript", "text": "..."}
              Transcription complete. text is what the user said.

          {"type": "routing"}
              Intent router is evaluating the transcript.

          {"type": "thinking"}
              Transcript scored below the intent threshold; request sent to
              Ollama LLM. Waiting for the first streaming token.

          {"type": "response_chunk", "text": "..."}
              One streaming token from the LLM (fires many times per turn).

          {"type": "response_complete", "text": "..."}
              Full assembled LLM response.

          {"type": "speaking"}
              TTS synthesis complete; audio event follows immediately.

          {"type": "audio", "data": "<base64-wav>"}
              WAV audio for the browser to decode and play.

          {"type": "idle"}
              Turn complete; ready for the next command.

          {"type": "error", "message": "..."}
              A step failed. idle always follows an error event.

        Args:
            audio_bytes: Raw WAV bytes from the browser mic.
            on_event:    Async callable that accepts a dict event payload.

        Raises:
            RuntimeError: If initialize() has not been called.
        """
        if not self._initialized:
            raise RuntimeError(
                "ConversationLoop.initialize() must be called before run_once()."
            )

        if is_kill_switch_active():
            logger.critical(
                "Kill switch active -- aborting conversation turn.")
            await on_event({"type": "error", "message": "System kill switch is active."})
            await on_event({"type": "idle"})
            return


        # -----------------------------------------------------------------
        # Step 1: Transcribe audio bytes received from the browser
        # -----------------------------------------------------------------
        try:
            await on_event({"type": "transcribing"})
            assert self._stt is not None
            transcript = await self._stt.transcribe(audio_bytes)
        except Exception as exc:
            logger.error("Transcription failed: %s", exc)
            await on_event({"type": "error", "message": f"Transcription error: {exc}"})
            await on_event({"type": "idle"})
            return

        # Voice-ID auto-identification block was here. It only fired in kiosk
        # sessions to override an anonymous user with the speaker's identity.
        # Removed alongside the kiosk archive. The VoiceIDProvider and its
        # /api/voice-id/* routes remain for future device-pairing use.

        if not transcript.strip():
            logger.info("Empty transcript -- skipping LLM call.")
            await on_event({"type": "transcript", "text": ""})
            await on_event({"type": "idle"})
            return

        # -----------------------------------------------------------------
        # Step 1.5: Refresh memory context into system prompt for this turn
        # -----------------------------------------------------------------
        if self._memory:
            await self._rebuild_system_prompt(query_text=transcript)

        await on_event({"type": "transcript", "text": transcript})

        # -----------------------------------------------------------------
        # Step 3: Intent routing
        # -----------------------------------------------------------------
        # The intent router checks for Google-service phrases first (calendar,
        # gmail, youtube_music, maps). If a match is found above the confidence
        # threshold, the spoken_response is used directly and we skip the LLM.
        # An empty spoken_response means "no match -- use Ollama."
        # -----------------------------------------------------------------
        try:
            await on_event({"type": "routing"})
            intent_name, spoken_response = await get_intent_router().route(
                transcript, self._user_id
            )
        except Exception as exc:
            logger.error("Intent routing failed: %s", exc)
            spoken_response = ""
            intent_name = "conversation"

        # Inject RAG document context when the document_qa intent was triggered.
        # Uses _splice_system_block so a prior turn's RAG block is replaced
        # rather than appended (prevents the system prompt from growing
        # unboundedly across multi-turn QA sessions).
        rag_body = ""
        if intent_name == "document_qa" and self._settings.semantic_memory_enabled:
            try:
                from providers.rag.rag_provider import RAGProvider
                rag = RAGProvider()
                rag_results = await rag.query_documents(transcript)
                if rag_results:
                    rag_body = "\n" + rag.format_context(rag_results)
            except Exception as exc:
                logger.warning("RAG context lookup failed: %s", exc)
        self._splice_system_block(self._RAG_BLOCK_MARKER, rag_body)

        # Skills injection — flag-gated, cached, idempotent across turns.
        await self._inject_skills_block(transcript)

        if intent_name != "conversation" and spoken_response and intent_name != "document_qa":
            # Google provider handled this turn. Add to history and speak.
            logger.info("Intent '%s' handled. Skipping LLM.", intent_name)
            await self._append_history("user", transcript, {"input_mode": "voice"})
            await self._append_history("assistant", spoken_response, {"model_label": "intent_router"})
            await on_event({"type": "response_complete", "text": spoken_response})
            await self._speak_and_send(spoken_response, on_event)
            await on_event({"type": "idle"})
            return

        # -----------------------------------------------------------------
        # Step 4: Stream LLM + interleaved TTS
        # -----------------------------------------------------------------
        await self._append_history("user", transcript, {"input_mode": "voice"})

        # Let River Decide: re-resolve the engine for this message.
        router_label = await self._maybe_route_auto(transcript)
        if router_label:
            await on_event({"type": "model_route", "label": router_label})

        await on_event({"type": "thinking"})

        self._gen_id += 1

        async def _run_generation():
            full_response = ""
            try:
                # We use the streaming path for all LLM calls in this turn
                async def on_token(t):
                    nonlocal full_response
                    full_response += t
                    await on_event({"type": "token", "content": t})

                # Handle Tool Use first if enabled
                if self._settings.tool_use_enabled:
                    from core.tools import TOOL_SCHEMAS, execute_tool
                    from core.agent_loop import run_agent_loop
                    
                    active_tools = TOOL_SCHEMAS
                    if self._web_search is False:
                        active_tools = [t for t in TOOL_SCHEMAS if t["name"] != "web_search"]
                        
                    tool_system_prompt = (
                        "You have access to tools. If the user asks for an action that matches "
                        "a tool, use the tool. If not, respond normally."
                    )
                    
                    final_buffered = await run_agent_loop(
                        self._llm,
                        self._history,
                        active_tools,
                        execute_tool,
                        on_event,
                        self._append_history,
                        self._user_id,
                        self._session_id,
                        tool_system_prompt
                    )
                    
                    if final_buffered:
                        async def dummy_stream():
                            yield final_buffered
                        llm_stream = dummy_stream()
                    else:
                        stream_fn = getattr(self._llm, "stream_chat", self._llm.stream_response)
                        llm_stream = stream_fn(self._history)
                else:
                    # Run the streaming pipeline
                    stream_fn = getattr(
                        self._llm,
                        "stream_chat",
                        self._llm.stream_response)  # type: ignore
                    llm_stream = stream_fn(self._history)
                
                sentence_stream = self._stream_sentences(llm_stream, on_token)

                # Interleave TTS synthesis with LLM token arrival
                await self._process_tts_stream(sentence_stream, on_event)

                await self._append_history("assistant", full_response, {"model_label": router_label or "default"})
                await on_event({"type": "response_complete", "text": full_response})

                # -----------------------------------------------------------------
                # Step 6: Record conversation summary
                # -----------------------------------------------------------------
                if self._memory:
                    try:
                        summary_text = (
                            f"User said: \"{transcript[:200]}\". "
                            f"River Song responded: \"{full_response[:200]}\"."
                        )
                        await self._memory.record_summary(self._user_id, summary_text)

                        # Phase 15: Habit Inference
                        self._spawn_background(
                            self._infer_habits(transcript, full_response),
                            "infer_habits",
                        )
                    except Exception as exc:
                        logger.warning(
                            "Summary recording failed (user=%s): %s", self._user_id, exc)

                # Graphiti episode — best-effort, no-op when disabled, never raises.
                try:
                    await get_graphiti_provider().add_episode(Episode(
                        group_id=f"user:{self._user_id}",
                        name="conversation_turn",
                        episode_body=(
                            f"User: {transcript}\n\n"
                            f"River Song: {full_response}"
                        ),
                        source="conversation_loop.run_once",
                        metadata={"user_id": self._user_id, "channel": "voice"},
                    ))
                except Exception as ge:
                    logger.debug("Graphiti episode write skipped: %s", ge)

                await on_event({"type": "idle"})

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("Conversation turn failed: %s", exc)
                await on_event({"type": "error", "message": f"LLM/TTS error: {exc}"})
                await on_event({"type": "idle"})

        self._generation_task = asyncio.create_task(_run_generation())
        try:
            await self._generation_task
        except asyncio.CancelledError:
            logger.info("Generation task cancelled.")

    async def _maybe_route_auto(self, text: str) -> Optional[str]:
        """When the user selected 'Let River Decide', re-resolve the LLM for
        THIS message via the model intent router.

        The provider is normally built once at initialize() with no message
        text, which would collapse 'auto' to the local default. Rebuilding per
        message is what makes River actually pick the best engine (local /
        NVIDIA NIM / cloud) for what was just said, always wrapped with a local
        safety net by _build_llm_provider.

        Returns the router's UI label (e.g. "Nemotron · Reasoning") or None.
        """
        if self._llm_provider_override != "auto" or not text.strip():
            return None
        loop = asyncio.get_running_loop()

        def _build():
            return _build_llm_provider(
                provider_override="auto",
                model_override=None,
                fallback_provider=self._fallback_provider,
                fallback_model=self._fallback_model,
                message_text=text,
                admin_config=self._admin_config,
            )
        try:
            llm, label = await loop.run_in_executor(None, _build)
            self._llm = llm
            return label
        except Exception as exc:
            logger.warning(
                "Auto-route rebuild failed, keeping current LLM: %s", exc)
            return None

    async def _infer_habits(self, user_text: str, assistant_text: str):
        """Analyze the turn to infer new user patterns/habits."""
        if not self._memory or not self._settings.habit_inference_enabled:
            return

        prompt = (
            f"Based on the following interaction, identify if the user has any specific "
            f"habits, routines, or recurring preferences. "
            f"If so, state them as a short preference (e.g., 'Prefers weather updates in the morning'). "
            f"If no new patterns are found, respond with 'NONE'.\n\n"
            f"User: {user_text}\n"
            f"River: {assistant_text}\n\n"
            f"Response format: 'Pattern: <description> | Confidence: <high/medium/low>'"
        )

        try:
            # Low-priority background inference
            assert self._llm is not None

            res = await self._llm.chat([{"role": "user", "content": prompt}])
            if "Pattern:" in res:
                parts = res.split("| Confidence:")
                pattern = parts[0].replace("Pattern:", "").strip()
                confidence = parts[1].strip().lower() if len(parts) > 1 else "low"
                
                if pattern and pattern.upper() != "NONE":
                    logger.info(
                        "Inferred new habit for %s: %s (confidence: %s)",
                        self._user_id,
                        pattern,
                        confidence)
                    
                    if confidence == "high":
                        await self._memory.upsert_preference(
                            user_id=self._user_id,
                            category="inferred_habit",
                            value=pattern,
                            confidence="high",
                            source_kind="habit_inference",
                            source_ref=self._session_id
                        )
                    else:
                        await self._memory.save_pending_habit(
                            user_id=self._user_id,
                            pattern=pattern,
                            confidence=confidence,
                            kind="habit",
                            payload=None
                        )
        except Exception as exc:
            logger.debug("Habit inference skipped: %s", exc)

    async def _speak_and_send(self, text: str,
                              on_event: EventCallback) -> None:
        """Synthesize text and send audio bytes to the browser."""
        try:
            await on_event({"type": "speaking"})
            assert self._tts is not None
            wav_bytes = await self._tts.synthesize(text)
            if wav_bytes:
                # ElevenLabs returns mp3, Piper/Kokoro return wav
                fmt = "mp3" if self._tts.__class__.__name__ == "ElevenLabsTTS" else "wav"
                await on_event({
                    "type": "audio",
                    "data": base64.b64encode(wav_bytes).decode("ascii"),
                    "format": fmt,
                })
        except Exception as exc:
            logger.error("TTS synthesis failed: %s", exc)
            await on_event({"type": "error", "message": f"TTS error: {exc}"})

    async def run_text(self, text: str, on_event: EventCallback, speak: Optional[bool] = None) -> None:
        """Execute one conversation turn from typed text, skipping STT."""
        if not self._initialized:
            raise RuntimeError(
                "ConversationLoop.initialize() must be called before run_text().")

        if is_kill_switch_active():
            await on_event({"type": "error", "message": "System kill switch is active."})
            await on_event({"type": "idle"})
            return


        await on_event({"type": "transcript", "text": text})

        if self._memory:
            await self._rebuild_system_prompt(query_text=text)

        try:
            await on_event({"type": "routing"})
            intent_name, spoken_response = await get_intent_router().route(text, self._user_id)
        except Exception as exc:
            logger.error("Intent routing failed: %s", exc)
            spoken_response = ""
            intent_name = "conversation"

        # RAG + Skills injection — both go through helpers that splice into
        # the system prompt idempotently. See voice-path comments above.
        rag_body = ""
        if intent_name == "document_qa" and self._settings.semantic_memory_enabled:
            try:
                from providers.rag.rag_provider import RAGProvider
                rag = RAGProvider()
                rag_results = await rag.query_documents(text)
                if rag_results:
                    rag_body = "\n" + rag.format_context(rag_results)
            except Exception as exc:
                logger.warning("RAG context lookup failed: %s", exc)
        self._splice_system_block(self._RAG_BLOCK_MARKER, rag_body)
        await self._inject_skills_block(text)

        if intent_name != "conversation" and spoken_response and intent_name != "document_qa":
            await self._append_history("user", text, {"input_mode": "text"})
            await self._append_history("assistant", spoken_response, {"model_label": "intent_router"})
            await on_event({"type": "response_complete", "text": spoken_response})
            if speak if speak is not None else self._mode == "voice":
                await self._speak_and_send(spoken_response, on_event)
            await on_event({"type": "idle"})
            return

        await self._append_history("user", text, {"input_mode": "text"})

        # Let River Decide: re-resolve the engine for this message.
        router_label = await self._maybe_route_auto(text)
        if router_label:
            await on_event({"type": "model_route", "label": router_label})

        full_response = ""
        try:
            await on_event({"type": "thinking"})

            # Phase 3: Tool Use / Function Calling
            if self._settings.tool_use_enabled:
                from core.tools import TOOL_SCHEMAS, execute_tool
                from core.agent_loop import run_agent_loop

                # Filter tools based on session settings
                active_tools = TOOL_SCHEMAS
                if self._web_search is False:
                    active_tools = [
                        t for t in TOOL_SCHEMAS if t["name"] != "web_search"]

                tool_system_prompt = (
                    "You have access to tools. If the user asks for an action that matches "
                    "a tool, use the tool. If not, respond normally."
                )

                # Use thinking stream if requested
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_method = self._llm.stream_response_thinking if use_thinking else self._llm.stream_response  # type: ignore

                final_buffered = await run_agent_loop(
                    self._llm,
                    self._history,
                    active_tools,
                    execute_tool,
                    on_event,
                    self._append_history,
                    self._user_id,
                    self._session_id,
                    tool_system_prompt,
                    tool_context=self._tool_context_extras
                )
                
                if final_buffered:
                    full_response = final_buffered
                    await on_event({"type": "token", "content": full_response})
                else:
                    async for chunk in stream_method(self._history):
                        full_response += chunk
                        await on_event({"type": "token", "content": chunk})

            # Phase 2: Normal streaming (no tool use enabled)
            elif self._settings.llm_streaming_enabled and self._llm.__class__.__name__ == "OllamaLLM":
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_chat_fn = self._llm.stream_response_thinking if use_thinking else getattr(  # type: ignore
                    self._llm, "stream_chat", self._llm.stream_response)  # type: ignore
                async for chunk in stream_chat_fn(self._history):
                    full_response += chunk
                    await on_event({"type": "token", "content": chunk})
            else:
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_chat_fn = self._llm.stream_response_thinking if use_thinking else self._llm.stream_response  # type: ignore
                async for chunk in stream_chat_fn(self._history):
                    full_response += chunk
                    await on_event({"type": "response_chunk", "text": chunk})

        except Exception as exc:
            self._history.pop()
            logger.error("LLM streaming failed: %s", exc)
            await on_event({"type": "error", "message": f"LLM error: {exc}"})
            await on_event({"type": "idle"})
            return

        # Strip DeepSeek / Qwen thinking blocks that some models emit inline.
        import re as _re
        full_response = _re.sub(
            r"<think>.*?</think>",
            "",
            full_response,
            flags=_re.DOTALL).strip()

        await self._append_history("assistant", full_response, {"model_label": router_label or "default"})
        await on_event({"type": "response_complete", "text": full_response})

        if speak if speak is not None else self._mode == "voice":
            await self._speak_and_send(full_response, on_event)

        if self._memory:
            try:
                summary_text = (
                    f"User said: \"{text[:200]}\". "
                    f"River Song responded: \"{full_response[:200]}\"."
                )
                await self._memory.record_summary(self._user_id, summary_text)
            except Exception as exc:
                logger.warning(
                    "Summary recording failed (user=%s): %s",
                    self._user_id,
                    exc)

        # Graphiti episode — best-effort, no-op when disabled, never raises.
        try:
            await get_graphiti_provider().add_episode(Episode(
                group_id=f"user:{self._user_id}",
                name="conversation_turn",
                episode_body=(
                    f"User: {text}\n\n"
                    f"River Song: {full_response}"
                ),
                source="conversation_loop.run_text",
                metadata={"user_id": self._user_id, "channel": "text"},
            ))
        except Exception as ge:
            logger.debug("Graphiti episode write skipped: %s", ge)

        await on_event({"type": "idle"})

    async def reset_history(self, flush_memory: bool = False, session_id: Optional[str] = None, new_session: bool = False) -> None:
        """
        Clear conversation history and rebuild the system prompt with fresh memory context.

        Call this to start a fresh conversation without reinitializing
        all providers (which would reload the Whisper model, etc.).
        """
        self._history = []
        self._skills_block_cache.clear()

        if new_session:
            self._session_id = None
        elif session_id is not None:
            self._session_id = session_id

        if not self._session_id and self._memory and hasattr(self._memory._store, 'create_chat_session'):
            try:
                meta = {}
                if self._tool_context_extras.get("vehicle_id"):
                    meta["scope"] = f"vehicle:{self._tool_context_extras['vehicle_id']}"
                self._session_id = await self._memory._store.create_chat_session(self._user_id, "", meta=meta)
            except Exception as e:
                logger.error("Failed to create chat session during reset: %s", e)
        elif self._session_id and self._memory and hasattr(self._memory._store, 'get_chat_messages'):
            try:
                db_msgs = await self._memory._store.get_chat_messages(self._user_id, self._session_id)
                for m in db_msgs[-20:]:
                    role = m.get("role")
                    content = m.get("content")
                    if role and content:
                        self._history.append({"role": role, "content": content})
                logger.info("History loaded for session %s (%d msgs)", self._session_id, len(db_msgs))
            except Exception as e:
                logger.error("Failed to load history for session %s: %s", self._session_id, e)

        if flush_memory:
            self._suppress_memory = True
        await self._rebuild_system_prompt()
        self._flush_memory = flush_memory
        # Preserve vehicle_id across resets
        vid = self._tool_context_extras.get("vehicle_id")
        self._tool_context_extras = {"vehicle_id": vid} if vid else {}
        logger.info(
            "Conversation history reset (user=%s, suppress_memory=%s, session_id=%s).",
            self._user_id,
            self._suppress_memory,
            self._session_id)
