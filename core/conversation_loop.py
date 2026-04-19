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

import base64
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


def _build_llm_provider() -> LLMProvider:
    """
    Instantiate the LLM provider named in LLM_PROVIDER.

    Returns:
        LLMProvider: Concrete provider instance ready to use.

    Raises:
        ValueError: If the configured provider key is not supported.
        RuntimeError: If the provider fails to initialize.
    """
    settings = get_settings()
    key = settings.llm_provider
    if key == "ollama":
        from providers.llm.ollama import OllamaLLM
        return OllamaLLM()
    if key == "anthropic":
        if not settings.anthropic_enabled:
            raise ValueError("Anthropic LLM is disabled. Set ANTHROPIC_ENABLED=true in .env.")
        from providers.llm.claude_api import ClaudeAPILLM
        return ClaudeAPILLM()
    if key == "gemini":
        if not settings.gemini_enabled:
            raise ValueError("Gemini LLM is disabled. Set GEMINI_ENABLED=true in .env.")
        from providers.llm.gemini import GeminiLLM
        return GeminiLLM()
    if key == "openai":
        if not settings.openai_enabled:
            raise ValueError("OpenAI LLM is disabled. Set OPENAI_ENABLED=true in .env.")
        from providers.llm.openai_api import OpenAILLM
        return OpenAILLM()
    if key == "mistral_ai":
        if not settings.mistral_ai_enabled:
            raise ValueError("Mistral AI LLM is disabled. Set MISTRAL_AI_ENABLED=true in .env.")
        from providers.llm.mistral_api import MistralAILLM
        return MistralAILLM()
    raise ValueError(
        f"Unsupported LLM_PROVIDER '{key}'. "
        f"Supported values: ollama | anthropic | gemini | openai | mistral_ai"
    )


def _build_tts_provider() -> TTSProvider:
    """
    Instantiate the TTS provider named in TTS_PROVIDER.

    Returns:
        TTSProvider: Concrete provider instance ready to use.

    Raises:
        ValueError: If the configured provider key is not supported.
        FileNotFoundError: If the Piper binary or model file is missing.
        RuntimeError: If the provider fails to initialize.
    """
    key = get_settings().tts_provider
    if key == "piper":
        from providers.tts.piper import PiperTTS
        return PiperTTS()
    raise ValueError(
        f"Unsupported TTS_PROVIDER '{key}'. Supported values: piper"
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
    ) -> None:
        settings = get_settings()
        self._system_prompt: str = settings.river_song_system_prompt
        self._user_id: str = user_id or settings.default_user_id
        self._memory: Optional[MemoryManager] = memory_manager
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
        try:
            self._stt = _build_stt_provider()
            self._llm = _build_llm_provider()
            self._tts = _build_tts_provider()
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

        if intent_name != "conversation" and spoken_response:
            # Google provider handled this turn. Add to history and speak.
            logger.info("Intent '%s' handled. Skipping LLM.", intent_name)
            self._history.append({"role": "user", "content": transcript})
            self._history.append({"role": "assistant", "content": spoken_response})
            await on_event({"type": "response_complete", "text": spoken_response})
            await self._speak_and_send(spoken_response, on_event)
            await on_event({"type": "idle"})
            return

        # -----------------------------------------------------------------
        # Step 4: LLM response (streaming) -- Ollama path
        # -----------------------------------------------------------------
        self._history.append({"role": "user", "content": transcript})

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

    async def reset_history(self) -> None:
        """
        Clear conversation history and rebuild the system prompt with fresh memory context.

        Call this to start a fresh conversation without reinitializing
        all providers (which would reload the Whisper model, etc.).
        """
        await self._rebuild_system_prompt()
        logger.info("Conversation history reset (user=%s).", self._user_id)
