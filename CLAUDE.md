# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

River Song AI is a personal AI operating system: a FastAPI backend + React/Vite frontend that implements a local-first voice conversation loop (STT → LLM → TTS). The LLM, STT, and TTS providers are fully swappable via a single `.env` line. Phase 1 is complete (core loop, auth, memory, routines, Home Assistant). Phases 2–8 are scaffolded but not yet active.

---

## Commands

### Backend
```bash
# Activate venv first
source venv/bin/activate

# Run dev server (stops the systemd service first if it's running)
sudo systemctl stop river-song
python main.py

# Install/update dependencies
pip install "setuptools<71" && pip install -r requirements.txt --no-build-isolation
```

### Frontend
```bash
cd frontend
npm run dev        # Vite dev server at http://localhost:5173 (hot reload)
npm run build      # Production build → frontend/dist/ (served by FastAPI)
npm run preview    # Preview the production build locally
```

### Production (systemd)
```bash
sudo systemctl start|stop|restart|status river-song
journalctl -u river-song -f          # Live logs

# One-command deploy from GitHub
./deploy.sh        # git pull → pip install → npm build → systemctl restart
```

**Dev vs production ports:** Vite dev uses `localhost:5173`; production FastAPI serves the built frontend at `localhost:8000`. If the systemd service is running, kill it before `python main.py` or you'll get a port conflict on 8000.

---

## Architecture

### Request Flow (Voice Turn)
```
Browser (mic) → base64 WAV over WebSocket
  → api/routes/conversation.py  (WebSocket handler, JWT auth)
  → core/conversation_loop.py   (orchestrates everything)
      ├─ providers/stt/whisper_local.py  → transcript text
      ├─ core/intent_router.py           → route to Google service or fall through
      ├─ providers/llm/{provider}.py     → stream LLM tokens back via events
      ├─ core/memory_manager.py          → inject context, record summary
      └─ providers/tts/piper.py          → WAV bytes → base64 → browser plays
```

Each step fires an async event via a callback so the WebSocket route forwards state changes (`listening → transcribing → thinking → response_chunk* → response_complete → speaking → audio → idle`) to the frontend in real time. **This event sequence is load-bearing** — the frontend UI state machine depends on it.

### Provider Pattern
All providers implement abstract base classes in `providers/base.py`:
- `STTProvider.transcribe(audio_bytes) → str`
- `LLMProvider.stream_response(messages) → AsyncGenerator[str]`
- `TTSProvider.synthesize(text) → bytes`

Providers are instantiated once per WebSocket connection via factory functions in `core/conversation_loop.py`. The active provider is determined by `settings.llm_provider` (or a per-user override loaded from SQLite). Never call provider implementations directly — always go through the factory.

### Configuration
`config/settings.py` is the single source of truth. It's a Pydantic `BaseSettings` class that reads from `.env`. Import via `get_settings()` everywhere — never hardcode values or import `_settings` directly (the function makes test mocking possible).

### Authentication
- First run: `POST /api/auth/setup` creates the master admin (locked after first use)
- Regular users sign up → created with `is_approved=False` → admin approves via `/api/admin/users`
- JWT tokens are passed as `?token=<jwt>` on WebSocket connections and `Authorization: Bearer <jwt>` on REST endpoints
- Token payload: `{ sub: user_id, email, role, exp }`
- Auth utilities: `core/auth.py` (`create_access_token`, `decode_token`)

### Memory System
Three tiers, all in SQLite (`providers/memory/sqlite_store.py`):
1. **Facts** — explicit user-told info (name, job, etc.), never expire
2. **Preferences** — inferred patterns, overwritten not appended
3. **Summaries** — compressed session records with TTL (short/standard/extended/long/forever)

At conversation start, `memory_manager.build_context_block(user_id)` assembles a formatted block injected into the system prompt. Conversation history itself is **in-memory per WebSocket connection** (ephemeral by design).

### Frontend State
- `App.jsx` owns top-level auth state (`useAuth()`) and navigation
- Theme is persisted per-user in `localStorage` as `rs-theme:<user.id>`
- Avatar visibility: `rs-avatar:<user.id>`; conversation history: `rs-history:<user.id>`; routines are mirrored to `rs-routines` for the Dashboard widget
- WebSocket managed by `hooks/useWebSocket.js` (auto-reconnect, up to 5 retries)
- Audio capture via `hooks/useAudioRecorder.js` (Web Audio API → WAV → base64)

### Static Serving
After `npm run build`, FastAPI mounts `frontend/dist/assets/` and serves all unmatched routes via an SPA fallback that returns `index.html`. API routes registered before the fallback take priority. The fallback is only mounted if `frontend/dist/` exists.

---

## Key Conventions

- **No server-side audio I/O.** The browser captures mic input and plays TTS output. All audio travels as base64-encoded WAV over WebSocket.
- **`app.state.memory_manager`** is the shared `MemoryManager` instance injected at startup. Routes access it via `request.app.state.memory_manager`. The underlying store is at `request.app.state.memory_manager._store`.
- **Per-user LLM overrides** are stored in the `llm_settings` SQLite table and loaded in `api/routes/conversation.py` before creating the `ConversationLoop`.
- **Routines run via `ConversationLoop.run_text()`** — they go through the full LLM pipeline (intent routing, memory context, streaming) just like a typed message.
- **Home Assistant** integration is gated on `HOME_ASSISTANT_TOKEN` being set in `.env`. All HA routes return safe stubs when unconfigured.
- **`sudo systemctl stop river-song` before `python main.py`** — both bind port 8000.
