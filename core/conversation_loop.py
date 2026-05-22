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
import json
import logging
import re
from typing import Any, Callable, Coroutine, List, Optional, AsyncGenerator

from config.settings import get_settings
from core.kill_switch import is_kill_switch_active
from core.intent_router import get_intent_router
from core.memory_manager import MemoryManager
from providers.base import LLMProvider, STTProvider, TTSProvider


logger = logging.getLogger(__name__)

# Type alias: an async callable that accepts a dict event payload.
# Typically sends JSON over a WebSocket connection.
EventCallback = Callable[[dict], Coroutine[Any, Any, None]]


class FallbackLLMProvider(LLMProvider):
    """
    Wraps two LLM providers. If the primary provider fails during streaming,
    it automatically falls back to the secondary provider for the remainder
    of the request.
    """
    def __init__(self, primary: LLMProvider, secondary: LLMProvider):
        self.primary = primary
        self.secondary = secondary

    async def stream_response(self, messages: List[dict]) -> AsyncGenerator[str, None]:
        try:
            async for chunk in self.primary.stream_response(messages):
                yield chunk
        except Exception as exc:
            logger.warning("Primary LLM failed, falling back to secondary: %s", exc)
            async for chunk in self.secondary.stream_response(messages):
                yield chunk

    async def stream_response_thinking(self, messages: List[dict]) -> AsyncGenerator[str, None]:
        try:
            async for chunk in self.primary.stream_response_thinking(messages):
                yield chunk
        except Exception as exc:
            logger.warning("Primary LLM (thinking) failed, falling back to secondary: %s", exc)
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
            raise ValueError("Anthropic LLM is disabled. Set ANTHROPIC_ENABLED=true in .env.")
        from providers.llm.claude_api import ClaudeAPILLM
        return ClaudeAPILLM(model=model) if model else ClaudeAPILLM()
    if key == "gemini":
        if not settings.gemini_enabled:
            raise ValueError("Gemini LLM is disabled. Set GEMINI_ENABLED=true in .env.")
        from providers.llm.gemini import GeminiLLM
        return GeminiLLM(model=model) if model else GeminiLLM()
    if key == "openai":
        if not settings.openai_enabled:
            raise ValueError("OpenAI LLM is disabled. Set OPENAI_ENABLED=true in .env.")
        from providers.llm.openai_api import OpenAILLM
        return OpenAILLM(model=model) if model else OpenAILLM()
    if key == "mistral_ai":
        if not settings.mistral_ai_enabled:
            raise ValueError("Mistral AI LLM is disabled. Set MISTRAL_AI_ENABLED=true in .env.")
        from providers.llm.mistral_api import MistralAILLM
        return MistralAILLM(model=model) if model else MistralAILLM()
    if key == "bedrock":
        if not settings.bedrock_enabled:
            raise ValueError("Amazon Bedrock is disabled. Set BEDROCK_ENABLED=true in .env.")
        from providers.llm.bedrock import BedrockLLM
        return BedrockLLM(model=model) if model else BedrockLLM()
    if key == "nvidia_nim":
        from api.routes.models_settings import _get_enabled_providers
        if not _get_enabled_providers().get("nvidia_nim", False):
            raise ValueError("NVIDIA NIM is disabled. Set NVIDIA_API_KEY in .env or enable it in Settings.")
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

    if key == "auto":
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
                logger.error("Intent router failed, falling back to direct provider resolution: %s", exc)
                key = fallback_provider or settings.llm_provider
                model_override = fallback_model or settings.llm_model
        else:
            key = fallback_provider or settings.llm_provider
            model_override = fallback_model or settings.llm_model

    if key != "auto" and key in enabled_providers and not enabled_providers[key]:
        raise ValueError(f"Provider '{key}' is disabled globally by the administrator.")

    primary = _instantiate_llm(key, model_override)

    if fallback_provider:
        try:
            secondary = _instantiate_llm(fallback_provider, fallback_model)
            return FallbackLLMProvider(primary, secondary), router_label
        except Exception as exc:
            logger.warning("Failed to initialize secondary LLM fallback: %s", exc)

    return primary, router_label


def _build_tts_provider(voice_id_override: Optional[str] = None) -> TTSProvider:
    """
    Instantiate the TTS provider for the active voice.

    Resolution order:
      1. voice_id_override — per-user preference from SQLite (no restart needed)
      2. ACTIVE_VOICE_ID in .env — system-wide fallback
      3. TTS_PROVIDER setting → piper | none
    """
    settings = get_settings()

    # Per-user override (from SQLite) takes priority over system .env default
    active_id = voice_id_override or getattr(settings, "active_voice_id", "") or ""
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
        is_kiosk: bool = False,
    ) -> None:
        settings = get_settings()
        self._settings = settings
        self._system_prompt: str = settings.river_song_system_prompt
        self._user_id: str = user_id or settings.default_user_id
        self._memory: Optional[MemoryManager] = memory_manager
        self._llm_provider_override: Optional[str] = llm_provider_override
        self._llm_model_override: Optional[str] = llm_model_override
        self._voice_id_override: Optional[str] = voice_id_override
        self._fallback_provider: Optional[str] = fallback_provider
        self._fallback_model: Optional[str] = fallback_model
        self._stt_model_override: Optional[str] = stt_model_override
        self._is_kiosk: bool = is_kiosk
        self._stt: Optional[STTProvider] = None
        self._llm: Optional[LLMProvider] = None
        self._tts: Optional[TTSProvider] = None
        self._history: List[dict] = []
        self._initialized: bool = False
        self._turn_transcript: str = ""
        self._flush_memory: bool = False
        self._web_search: bool = False
        self._thinking_mode: Optional[str] = "fast" # "fast" | "thinking" | "pro"
        self._suppress_memory: bool = False


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
                admin_config = await self._memory._store.get_admin_config()
            except Exception as e:
                logger.warning("Failed to fetch admin config for LLM routing: %s", e)

        try:
            llm_provider_override = self._llm_provider_override
            llm_model_override    = self._llm_model_override
            voice_id_override     = self._voice_id_override
            fallback_provider     = self._fallback_provider
            fallback_model        = self._fallback_model
            stt_model_override    = self._stt_model_override

            def _build_all():
                stt = _build_stt_provider(model_size=stt_model_override)
                llm, _router_label = _build_llm_provider(
                    provider_override=llm_provider_override,
                    model_override=llm_model_override,
                    fallback_provider=fallback_provider,
                    fallback_model=fallback_model,
                    admin_config=admin_config,
                )
                tts = _build_tts_provider(voice_id_override=voice_id_override)
                return stt, llm, tts

            self._stt, self._llm, self._tts = await loop.run_in_executor(None, _build_all)
        except Exception as exc:
            raise RuntimeError(
                f"ConversationLoop failed to initialize: {exc}"
            ) from exc

        await self._rebuild_system_prompt()
        self._initialized = True
        logger.info("ConversationLoop ready.")

    async def run_startup_briefing(self, on_event: EventCallback) -> None:
        """
        Check calendar and greet the user with upcoming events on first connect.
        Ambient, non-blocking, non-history briefing.
        """
        if not self._settings.startup_briefing_enabled:
            return

        try:
            from core.tools import get_upcoming_events
            from datetime import datetime
            import asyncio

            # 1. Fetch events
            events = await get_upcoming_events(self._user_id, hours_ahead=self._settings.startup_briefing_hours_ahead)
            if not events:
                return

            # 2. Build briefing prompt
            event_list = "\n".join([
                f"- {e['title']} at {datetime.fromisoformat(e['time']).strftime('%I:%M %p')}"
                for e in events
            ])
            
            prompt = (
                "The user has just opened the app. Greet them warmly as River Song "
                "and mention their upcoming calendar events naturally, as if you "
                f"noticed. Events today:\n{event_list}\n\n"
                "Be brief — 2 sentences max. No markdown."
            )

            # 3. Generate greeting (10s timeout)
            try:
                response = ""
                async def _collect():
                    nonlocal response
                    async for chunk in self._llm.stream_response([{"role": "user", "content": prompt}]):
                        response += chunk
                await asyncio.wait_for(_collect(), timeout=10.0)
            except asyncio.TimeoutError:
                logger.debug("Startup briefing LLM timed out.")
                return

            if not response:
                return

            # 4. Dispatch events
            await on_event({"type": "proactive_briefing_start", "text": response})
            
            # 5. Synthesize TTS
            await on_event({"type": "speaking"})
            audio_bytes = await self._tts.synthesize(response)
            if audio_bytes:
                import base64
                b64 = base64.b64encode(audio_bytes).decode("utf-8")
                # ElevenLabs returns mp3, Piper/Kokoro return wav
                fmt = "mp3" if self._tts.__class__.__name__ == "ElevenLabsTTS" else "wav"
                await on_event({"type": "audio", "data": b64, "format": fmt})
            
            await on_event({"type": "idle"})

        except Exception as exc:
            logger.debug("Startup briefing skipped: %s", exc)

    async def _rebuild_system_prompt(self) -> None:
        """Rebuild the system prompt with current memory context, then reset history."""
        memory_block = ""
        if self._memory and not self._flush_memory and not self._suppress_memory:
            try:
                memory_block = await self._memory.build_context_block(self._user_id)
            except Exception as exc:
                logger.warning("Memory context build failed (user=%s): %s", self._user_id, exc)

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

        full_system = self._system_prompt + memory_block + context_block + mode_block
        if self._history and self._history[0].get("role") == "system":
            self._history[0]["content"] = full_system
        else:
            self._history = [{"role": "system", "content": full_system}]

        # Clear the flag so memory is only skipped on the next turn (session-scoped)
        self._flush_memory = False

    async def _stream_sentences(self, stream: AsyncGenerator[str, None], on_token: Callable[[str], Coroutine[Any, Any, None]]) -> AsyncGenerator[str, None]:
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

    async def _process_tts_stream(self, sentence_stream: AsyncGenerator[str, None], on_event: EventCallback):
        """Consume sentences and stream audio chunks to the browser."""
        async for sentence in sentence_stream:
            if not sentence.strip():
                continue
            
            audio_data = b""
            async for chunk in self._tts.stream_synthesize(sentence):
                if chunk:
                    audio_data += chunk
            
            if audio_data:
                await on_event({"type": "speaking"})
                # ElevenLabs returns mp3, Piper/Kokoro return wav
                fmt = "mp3" if self._tts.__class__.__name__ == "ElevenLabsTTS" else "wav"
                await on_event({
                    "type": "audio",
                    "data": base64.b64encode(audio_data).decode("ascii"),
                    "format": fmt,
                })
                # NEW: trigger Herald lip-sync in background (non-blocking)
                asyncio.create_task(
                    self._trigger_herald_lip_sync(audio_data, fmt)
                )

    async def _trigger_herald_lip_sync(self, audio_bytes: bytes, fmt: str) -> None:
        """Calls the Herald daemon to compute and broadcast lip-sync timings."""
        import base64
        try:
            from daemons.registry import call_daemon
            await call_daemon("herald", "lip_sync", {
                "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
                "format": fmt,
            })
        except Exception as e:
            logger.debug("Lip-sync trigger skipped: %s", e)

    async def run_once(self, audio_bytes: bytes, on_event: EventCallback) -> None:
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
            logger.critical("Kill switch active -- aborting conversation turn.")
            await on_event({"type": "error", "message": "System kill switch is active."})
            await on_event({"type": "idle"})
            return

        # -----------------------------------------------------------------
        # Step 0: Refresh memory context into system prompt for this turn
        # -----------------------------------------------------------------
        if self._memory:
            await self._rebuild_system_prompt()

        # -----------------------------------------------------------------
        # Step 1: Transcribe audio bytes received from the browser
        # -----------------------------------------------------------------
        try:
            await on_event({"type": "transcribing"})
            transcript = await self._stt.transcribe(audio_bytes)
        except Exception as exc:
            logger.error("Transcription failed: %s", exc)
            await on_event({"type": "error", "message": f"Transcription error: {exc}"})
            await on_event({"type": "idle"})
            return

        # Voice ID — only override when session is anonymous kiosk
        if self._is_kiosk and audio_bytes:
            from providers.voice_id.voice_id_provider import VoiceIDProvider
            from config.settings import get_settings
            if get_settings().voice_id_enabled:
                try:
                    from providers.voice_id import _SINGLETON
                    vid = _SINGLETON
                except ImportError:
                    vid = VoiceIDProvider()
                try:
                    ident = await vid.identify(audio_bytes, threshold=get_settings().voice_id_threshold)
                    if ident and ident.get("user_id"):
                        # Override anonymous kiosk identity with identified user
                        self._user_id = ident["user_id"]
                        logger.info(f"Voice ID: identified as {ident['user_id']} score={ident['score']:.3f}")
                        # Log event
                        if self._memory and hasattr(self._memory, "_store"):
                            import time
                            await self._memory._store.log_voice_id_event(
                                ts=time.time(),
                                identified_user_id=ident["user_id"],
                                score=ident["score"],
                                runner_up_user_id=ident.get("runner_up_user_id"),
                                runner_up_score=ident.get("runner_up_score"),
                                audio_duration_ms=int(len(audio_bytes) * 1000 / 32000),  # rough estimate
                                session_kind="kiosk",
                            )
                        
                        # Since user_id changed, we MUST rebuild the system prompt to pick up the new user's context
                        if self._memory:
                            await self._rebuild_system_prompt()
                    else:
                        logger.debug("Voice ID: no enrolled speaker matched")
                except Exception as e:
                    logger.warning(f"Voice ID failed (non-fatal): {e}")

        if not transcript.strip():
            logger.info("Empty transcript -- skipping LLM call.")
            await on_event({"type": "transcript", "text": ""})
            await on_event({"type": "idle"})
            return

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

        # Inject RAG document context when the document_qa intent was triggered
        if intent_name == "document_qa" and self._settings.semantic_memory_enabled:
            try:
                from providers.rag.rag_provider import RAGProvider
                rag = RAGProvider()
                rag_results = await rag.query_documents(transcript, n_results=5)
                if rag_results:
                    doc_context = rag.format_context(rag_results)
                    # Prepend to the current turn's system prompt without mutating history
                    if self._history and self._history[0]["role"] == "system":
                        self._history[0] = {
                            "role": "system",
                            "content": self._history[0]["content"] + f"\n\nRELEVANT DOCUMENT EXCERPTS:\n{doc_context}"
                        }
            except Exception as exc:
                logger.warning("RAG context injection failed: %s", exc)

        if intent_name != "conversation" and spoken_response and intent_name != "document_qa":
            # Google provider handled this turn. Add to history and speak.
            logger.info("Intent '%s' handled. Skipping LLM.", intent_name)
            self._history.append({"role": "user", "content": transcript})
            self._history.append({"role": "assistant", "content": spoken_response})
            await on_event({"type": "response_complete", "text": spoken_response})
            await self._speak_and_send(spoken_response, on_event)
            await on_event({"type": "idle"})
            return

        # -----------------------------------------------------------------
        # Step 4: Stream LLM + interleaved TTS
        # -----------------------------------------------------------------
        self._history.append({"role": "user", "content": transcript})
        await on_event({"type": "thinking"})

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
                if hasattr(self._llm, "chat_with_tools"):
                    res = await self._llm.chat_with_tools(self._history, TOOL_SCHEMAS)
                    if res["type"] == "tool_call":
                        result_text = await execute_tool(res["tool_name"], res["tool_input"], {"user_id": self._user_id})
                        # Add to history and get final response summarization
                        if self._llm.__class__.__name__ == "ClaudeAPILLM":
                            self._history.append({"role": "assistant", "content": [{"type": "tool_use", "id": res["tool_use_id"], "name": res["tool_name"], "input": res["tool_input"]}]})
                            self._history.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": res["tool_use_id"], "content": result_text}]})
                        else:
                            self._history.append({"role": "assistant", "content": "", "tool_calls": [{"function": {"name": res["tool_name"], "arguments": res["tool_input"]}}]})
                            self._history.append({"role": "tool", "content": result_text})

            # Run the streaming pipeline
            stream_fn = getattr(self._llm, "stream_chat", self._llm.stream_response)
            llm_stream = stream_fn(self._history)
            sentence_stream = self._stream_sentences(llm_stream, on_token)
            
            # Interleave TTS synthesis with LLM token arrival
            await self._process_tts_stream(sentence_stream, on_event)

        except Exception as exc:
            logger.error("Conversation turn failed: %s", exc)
            await on_event({"type": "error", "message": f"LLM/TTS error: {exc}"})
            await on_event({"type": "idle"})
            return

        self._history.append({"role": "assistant", "content": full_response})
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
                asyncio.create_task(self._infer_habits(transcript, full_response))
            except Exception as exc:
                logger.warning("Summary recording failed (user=%s): %s", self._user_id, exc)

        await on_event({"type": "idle"})

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
            f"Response format: 'Pattern: <description>'"
        )
        
        try:
            # Low-priority background inference
            res = await self._llm.chat([{"role": "user", "content": prompt}])
            if "Pattern:" in res:
                pattern = res.split("Pattern:")[1].strip()
                if pattern and pattern.upper() != "NONE":
                    logger.info("Inferred new habit for %s: %s", self._user_id, pattern)
                    # FIX B10: Persist to pending table instead of active preferences
                    await self._memory.save_pending_habit(
                        user_id=self._user_id,
                        pattern=pattern,
                        confidence="low"
                    )
        except Exception as exc:
            logger.debug("Habit inference skipped: %s", exc)

    async def _speak_and_send(self, text: str, on_event: EventCallback) -> None:
        """Synthesize text and send audio bytes to the browser."""
        try:
            await on_event({"type": "speaking"})
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

    async def run_text(self, text: str, on_event: EventCallback) -> None:
        """Execute one conversation turn from typed text, skipping STT."""
        if not self._initialized:
            raise RuntimeError("ConversationLoop.initialize() must be called before run_text().")

        if is_kill_switch_active():
            await on_event({"type": "error", "message": "System kill switch is active."})
            await on_event({"type": "idle"})
            return

        if self._memory:
            await self._rebuild_system_prompt()

        await on_event({"type": "transcript", "text": text})

        try:
            await on_event({"type": "routing"})
            intent_name, spoken_response = await get_intent_router().route(text, self._user_id)
        except Exception as exc:
            logger.error("Intent routing failed: %s", exc)
            spoken_response = ""
            intent_name = "conversation"

        # Inject RAG document context when the document_qa intent was triggered
        if intent_name == "document_qa" and self._settings.semantic_memory_enabled:
            try:
                from providers.rag.rag_provider import RAGProvider
                rag = RAGProvider()
                rag_results = await rag.query_documents(text, n_results=5)
                if rag_results:
                    doc_context = rag.format_context(rag_results)
                    if self._history and self._history[0]["role"] == "system":
                        self._history[0] = {
                            "role": "system",
                            "content": self._history[0]["content"] + f"\n\nRELEVANT DOCUMENT EXCERPTS:\n{doc_context}"
                        }
            except Exception as exc:
                logger.warning("RAG context injection failed: %s", exc)

        if intent_name != "conversation" and spoken_response and intent_name != "document_qa":
            self._history.append({"role": "user", "content": text})
            self._history.append({"role": "assistant", "content": spoken_response})
            await on_event({"type": "response_complete", "text": spoken_response})
            await self._speak_and_send(spoken_response, on_event)
            await on_event({"type": "idle"})
            return

        self._history.append({"role": "user", "content": text})

        full_response = ""
        try:
            await on_event({"type": "thinking"})

            # Phase 3: Tool Use / Function Calling
            if self._settings.tool_use_enabled:
                from core.tools import TOOL_SCHEMAS, execute_tool
                
                # Filter tools based on session settings
                active_tools = TOOL_SCHEMAS
                if not self._web_search:
                    active_tools = [t for t in TOOL_SCHEMAS if t["name"] != "web_search"]
                
                tool_system_prompt = (
                    "You have access to tools. If the user asks for an action that matches "
                    "a tool, use the tool. If not, respond normally."
                )
                
                # Use thinking stream if requested
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_method = self._llm.stream_response_thinking if use_thinking else self._llm.stream_response

                if hasattr(self._llm, "chat_with_tools"):
                    messages_with_tools = self._history.copy()
                    if messages_with_tools[0]["role"] == "system":
                        messages_with_tools[0]["content"] += f"\n\n{tool_system_prompt}"
                    
                    res = await self._llm.chat_with_tools(messages_with_tools, active_tools)
                    if res["type"] == "tool_call":
                        tool_name = res["tool_name"]
                        tool_input = res["tool_input"]
                        tool_id = res.get("tool_use_id")
                        logger.info("LLM requested tool: %s", tool_name)
                        
                        await on_event({"type": "tool_use", "tool": tool_name, "input": tool_input})
                        
                        result_text = await execute_tool(tool_name, tool_input, {"user_id": self._user_id})
                        
                        await on_event({"type": "tool_result", "tool": tool_name, "result": result_text})
                        
                        if self._llm.__class__.__name__ == "ClaudeAPILLM":
                            self._history.append({
                                "role": "assistant",
                                "content": [{"type": "tool_use", "id": tool_id, "name": tool_name, "input": tool_input}]
                            })
                            self._history.append({
                                "role": "user",
                                "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": result_text}]
                            })
                        else:
                            self._history.append({
                                "role": "assistant", "content": "",
                                "tool_calls": [{"function": {"name": tool_name, "arguments": tool_input}}]
                            })
                            self._history.append({"role": "tool", "content": result_text})
                            
                        async for chunk in stream_method(self._history):
                            full_response += chunk
                            await on_event({"type": "token", "content": chunk})
                    else:
                        full_response = res["content"]
                        await on_event({"type": "token", "content": full_response})
                else:
                    async for chunk in stream_method(self._history):
                        full_response += chunk
                        await on_event({"type": "response_chunk", "text": chunk})

            # Phase 2: Normal streaming (no tool use enabled)
            elif self._settings.llm_streaming_enabled and self._llm.__class__.__name__ == "OllamaLLM":
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_chat_fn = self._llm.stream_response_thinking if use_thinking else getattr(self._llm, "stream_chat", self._llm.stream_response)
                async for chunk in stream_chat_fn(self._history):
                    full_response += chunk
                    await on_event({"type": "token", "content": chunk})
            else:
                use_thinking = self._thinking_mode in ("thinking", "pro")
                stream_chat_fn = self._llm.stream_response_thinking if use_thinking else self._llm.stream_response
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
        full_response = _re.sub(r"<think>.*?</think>", "", full_response, flags=_re.DOTALL).strip()

        self._history.append({"role": "assistant", "content": full_response})
        await on_event({"type": "response_complete", "text": full_response})

        await self._speak_and_send(full_response, on_event)

        if self._memory:
            try:
                summary_text = (
                    f"User said: \"{text[:200]}\". "
                    f"River Song responded: \"{full_response[:200]}\"."
                )
                await self._memory.record_summary(self._user_id, summary_text)
            except Exception as exc:
                logger.warning("Summary recording failed (user=%s): %s", self._user_id, exc)

        await on_event({"type": "idle"})

    async def reset_history(self, flush_memory: bool = False) -> None:
        """
        Clear conversation history and rebuild the system prompt with fresh memory context.

        Call this to start a fresh conversation without reinitializing
        all providers (which would reload the Whisper model, etc.).
        """
        self._history = []
        if flush_memory:
            self._suppress_memory = True
        await self._rebuild_system_prompt()
        self._flush_memory = flush_memory
        logger.info("Conversation history reset (user=%s, suppress_memory=%s).", self._user_id, self._suppress_memory)
