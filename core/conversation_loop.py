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
from typing import Any, Callable, Coroutine, List, Optional

from config.settings import get_settings
from core.kill_switch import is_kill_switch_active
from core.intent_router import get_intent_router
from core.memory_manager import MemoryManager
from providers.base import LLMProvider, STTProvider, TTSProvider


logger = logging.getLogger(__name__)

# Type alias: an async callable that accepts a dict event payload.
# Typically sends JSON over a WebSocket connection.
EventCallback = Callable[[dict], Coroutine[Any, Any, None]]


# -----------------------------------------------------------------------------
# Provider factories
# -----------------------------------------------------------------------------

def _build_stt_provider() -> STTProvider:
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
        return WhisperLocalSTT()
    raise ValueError(
        f"Unsupported STT_PROVIDER '{key}'. Supported values: whisper_local"
    )


def _build_llm_provider(
    provider_override: Optional[str] = None,
    model_override: Optional[str] = None,
) -> LLMProvider:
    """
    Instantiate the LLM provider. If provider_override is given it takes
    precedence over LLM_PROVIDER in .env; model_override is passed to
    the provider constructor when supported.

    Returns:
        LLMProvider: Concrete provider instance ready to use.

    Raises:
        ValueError: If the configured provider key is not supported.
        RuntimeError: If the provider fails to initialize.
    """
    settings = get_settings()
    key = provider_override or settings.llm_provider
    model = model_override  # passed to provider constructors that support it

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
    raise ValueError(
        f"Unsupported LLM_PROVIDER '{key}'. "
        f"Supported values: ollama | anthropic | gemini | openai | mistral_ai"
    )


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
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).warning(
                "Voice registry lookup failed for '%s': %s — falling back to TTS_PROVIDER",
                active_id, exc,
            )

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
    ) -> None:
        settings = get_settings()
        self._settings = settings
        self._system_prompt: str = settings.river_song_system_prompt
        self._user_id: str = user_id or settings.default_user_id
        self._memory: Optional[MemoryManager] = memory_manager
        self._llm_provider_override: Optional[str] = llm_provider_override
        self._llm_model_override: Optional[str] = llm_model_override
        self._voice_id_override: Optional[str] = voice_id_override
        self._stt: Optional[STTProvider] = None
        self._llm: Optional[LLMProvider] = None
        self._tts: Optional[TTSProvider] = None
        self._history: List[dict] = []
        self._initialized: bool = False
        self._turn_transcript: str = ""

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
        try:
            llm_provider_override = self._llm_provider_override
            llm_model_override    = self._llm_model_override
            voice_id_override     = self._voice_id_override

            def _build_all():
                stt = _build_stt_provider()
                llm = _build_llm_provider(
                    provider_override=llm_provider_override,
                    model_override=llm_model_override,
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

    async def _rebuild_system_prompt(self) -> None:
        """Rebuild the system prompt with current memory context, then reset history."""
        memory_block = ""
        if self._memory:
            try:
                memory_block = await self._memory.build_context_block(self._user_id)
            except Exception as exc:
                logger.warning("Memory context build failed (user=%s): %s", self._user_id, exc)

        full_system = self._system_prompt + memory_block
        self._history = [{"role": "system", "content": full_system}]

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
        # Step 4: LLM response (with optional Tool Use)
        # -----------------------------------------------------------------
        self._history.append({"role": "user", "content": transcript})

        full_response = ""
        try:
            await on_event({"type": "thinking"})

            # Phase 3: Tool Use / Function Calling
            if self._settings.tool_use_enabled:
                from core.tools import TOOL_SCHEMAS, execute_tool
                
                # Instruction to use tools
                tool_system_prompt = (
                    "You have access to tools. If the user asks for an action that matches "
                    "a tool, use the tool. If not, respond normally."
                )
                
                # Use chat_with_tools if available on the provider
                if hasattr(self._llm, "chat_with_tools"):
                    # Build a messages list including the tool-specific system instruction
                    messages_with_tools = self._history.copy()
                    if messages_with_tools[0]["role"] == "system":
                        messages_with_tools[0]["content"] += f"\n\n{tool_system_prompt}"
                    
                    res = await self._llm.chat_with_tools(messages_with_tools, TOOL_SCHEMAS)
                    
                    if res["type"] == "tool_call":
                        # Execute the tool
                        tool_name = res["tool_name"]
                        tool_input = res["tool_input"]
                        tool_id = res.get("tool_use_id")
                        
                        logger.info("LLM requested tool: %s", tool_name)
                        result_text = await execute_tool(
                            tool_name, 
                            tool_input, 
                            {"user_id": self._user_id}
                        )
                        
                        # Add tool call and result to history
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
                            # Ollama / Generic format
                            self._history.append({
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "function": {"name": tool_name, "arguments": tool_input}
                                }]
                            })
                            self._history.append({
                                "role": "tool",
                                "content": result_text
                            })
                            
                        # Get final response summarizing the tool result
                        async for chunk in self._llm.stream_response(self._history):
                            full_response += chunk
                            await on_event({"type": "token", "content": chunk})
                    else:
                        full_response = res["content"]
                        await on_event({"type": "response_complete", "text": full_response})
                else:
                    # Fallback to normal streaming if chat_with_tools is missing
                    async for chunk in self._llm.stream_response(self._history):
                        full_response += chunk
                        await on_event({"type": "response_chunk", "text": chunk})

            # Phase 2: Normal streaming (no tool use enabled)
            elif self._settings.llm_streaming_enabled and self._llm.__class__.__name__ == "OllamaLLM":
                # Note: we use getattr to safely call the newly added stream_chat
                stream_chat_fn = getattr(self._llm, "stream_chat", self._llm.stream_response)
                async for chunk in stream_chat_fn(self._history):
                    full_response += chunk
                    await on_event({"type": "token", "content": chunk})
            else:
                # Existing behavior: response_chunk
                async for chunk in self._llm.stream_response(self._history):
                    full_response += chunk
                    await on_event({"type": "response_chunk", "text": chunk})

        except Exception as exc:
            self._history.pop()
            logger.error("LLM streaming failed: %s", exc)
            await on_event({"type": "error", "message": f"LLM error: {exc}"})
            await on_event({"type": "idle"})
            return

        self._history.append({"role": "assistant", "content": full_response})
        await on_event({"type": "response_complete", "text": full_response})

        # -----------------------------------------------------------------
        # Step 5: TTS synthesis -> send WAV to browser
        # -----------------------------------------------------------------
        await self._speak_and_send(full_response, on_event)

        # -----------------------------------------------------------------
        # Step 6: Record conversation summary (fire-and-forget on error)
        # -----------------------------------------------------------------
        if self._memory:
            try:
                summary_text = (
                    f"User said: \"{transcript[:200]}\". "
                    f"River Song responded: \"{full_response[:200]}\"."
                )
                await self._memory.record_summary(self._user_id, summary_text)
            except Exception as exc:
                logger.warning("Summary recording failed (user=%s): %s", self._user_id, exc)

        await on_event({"type": "idle"})

    async def _speak_and_send(self, text: str, on_event: EventCallback) -> None:
        """Synthesize text with Piper and send WAV bytes to the browser."""
        try:
            await on_event({"type": "speaking"})
            wav_bytes = await self._tts.synthesize(text)
            if wav_bytes:
                await on_event({
                    "type": "audio",
                    "data": base64.b64encode(wav_bytes).decode("ascii"),
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

        if intent_name != "conversation" and spoken_response:
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
            async for chunk in self._llm.stream_response(self._history):
                full_response += chunk
                await on_event({"type": "response_chunk", "text": chunk})
        except Exception as exc:
            self._history.pop()
            logger.error("LLM streaming failed: %s", exc)
            await on_event({"type": "error", "message": f"LLM error: {exc}"})
            await on_event({"type": "idle"})
            return

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

    async def reset_history(self) -> None:
        """
        Clear conversation history and rebuild the system prompt with fresh memory context.

        Call this to start a fresh conversation without reinitializing
        all providers (which would reload the Whisper model, etc.).
        """
        await self._rebuild_system_prompt()
        logger.info("Conversation history reset (user=%s).", self._user_id)
