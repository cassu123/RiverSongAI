# RIVER SONG AI — FULL CODEBASE AUDIT

**Auditor:** Claude Opus 4.7 (read-only pass, no code modified)
**Date:** 2026-05-13
**Snapshot commit:** `4689cc1` (uncommitted changes captured as wip before audit)
**Branch:** `main` (also pushed to `origin/main`)
**Stack actually present in the repo:** Python 3.11+ / FastAPI backend, React 18 + Vite frontend, SQLite (`river_song.db`, `commerce.db`, `inventory.db`, `vehicles.db`, `culinary.db`) + ChromaDB (optional), Ollama / Anthropic / Gemini / OpenAI / Mistral / Bedrock LLM providers, Whisper local STT, Piper + Kokoro + ElevenLabs + Chatterbox TTS, Stable Diffusion (A1111 REST API) for images, JWT auth (PyJWT + bcrypt). The brief mentions **Firebase Auth and Firestore rules** — **neither exists in this repo.** Auth is local JWT signed against `JWT_SECRET_KEY` in `.env`, users live in the SQLite `users` table inside `river_song.db`. Treat every mention of "Firebase" in this audit as the local SQLite/JWT layer that actually backs the app.

---

## SECTION 1 — ARCHITECTURE MAP

### 1.1 Backend entry & lifecycle

| File | Purpose |
|---|---|
| `main.py` | FastAPI factory. Wires CORS + `TrustedHostMiddleware` + a custom `_CloudflareIPMiddleware` that promotes `CF-Connecting-IP` into `request.client`. Lifespan boots `SQLiteStore`, `MemoryManager`, `DaemonRegistry`, `ContextEngine`, rover telemetry dict, applies persisted AI flags + ElevenLabs + persona, then launches `routines_scheduler.start_scheduler` as an asyncio task. Mounts the React build (`frontend/dist`) with an SPA fallback that serves any unknown path as `index.html`. |
| `config/settings.py` | `Settings(BaseSettings)` — single source of truth, loads `.env`. Validates `JWT_SECRET_KEY` ≥ 32 chars, log level, temperature range, intent threshold. |
| `core/kill_switch.py` | File-based global kill switch in `logs/kill_switch_state.txt`. Loaded on import, polled by every conversation turn. Reset gated by bcrypt password. |
| `core/auth.py` | 24-line module: `create_access_token` / `decode_token` (PyJWT, HS256, default 7-day expiry). |
| `core/memory_manager.py` | Coordinates SQLite + (optional) Chroma vector store. `build_context_block(user_id)` is the file that re-injects facts, preferences, and recent summaries into every system prompt. |
| `core/conversation_loop.py` | Per-WebSocket loop. Provider factories `_build_stt_provider`, `_build_llm_provider`, `_build_tts_provider`. Owns `_history`, `_rebuild_system_prompt`, sentence-streaming TTS pipeline. |
| `core/intent_router.py` | Two-stage keyword/phrase scorer with 13 registered intents. `get_intent_router()` singleton. |
| `core/tools.py` | 17 LLM tool schemas + executors (calendar, inventory, shopping list, reminders, HA control, vehicle log, recipe stub, routine stub, reading status, Kindle sync, commerce search/sale, n8n trigger, business report, web search, email search, weather). `get_upcoming_events()` helper for the startup briefing. |
| `core/family.py` / `core/family_migration.py` | Resolves "module owner" for shared-resource family groups (used by culinary, inventory, vehicles). |
| `core/context_engine.py` | In-memory `ContextEngine` with `_rooms: Dict[str, RoomState]`. Hydrated by Warden + Home Assistant via `/api/context/sensor_event`. |
| `core/wake_word_service.py` | openWakeWord ambient-mode wrapper, optional. |
| `core/routines_scheduler.py` | Scheduler launched in lifespan. |

### 1.2 API routes (mounted in `main.py`, prefixes from each router)

| File | Prefix | Public surface |
|---|---|---|
| `api/routes/health.py` | `/health` | Unauth health check. |
| `api/routes/auth.py` | `/api/auth` | `setup-status`, `setup`, `signup`, `login`, `me`, `password`, `integrations` (GET/PUT), `google/authorize`, `google/callback`, `profile` (GET/PATCH). |
| `api/routes/conversation.py` | `/ws/conversation`, `/api/conversation/*` | Voice WebSocket + HTTP `chat` (SSE), `extract-facts`, `enhance-prompt`, `transcribe`. |
| `api/routes/models_settings.py` | `/api` | `models`, `settings/llm`, `settings/memory`, `settings/voice`, `settings/orchestration`, `settings/elevenlabs`, `settings/persona`, `settings/persona/default`, `tts/preview/{voice_id}`. |
| `api/routes/dashboard.py` | `/api` | `dashboard`. |
| `api/routes/memory.py` | `/api/memory` | facts CRUD, preferences GET/PUT, summaries GET. |
| `api/routes/killswitch.py` | `/api/killswitch` | status, `activate`, `reset`. |
| `api/routes/home.py` | `/api/home` | `status`, `devices`, `action`. |
| `api/routes/admin.py` | `/api/admin` | `users`, `users/{user_id}`, `model-visibility`, `feature-visibility`, `family`, `family-groups` family CRUD. |
| `api/routes/routines.py` | `/api/routines` | CRUD + `/run`. |
| `api/routes/inventory.py` | `/api/inventory` | homes, items, collaborators, manifest, scan, receipt, warranty, issue, return. |
| `api/routes/commerce.py` | `/api/commerce` | workspaces, products, suppliers, customers, sales, stock. |
| `api/routes/vehicles.py` | `/api/vehicles` | vehicles, specs (fluids/torques/checkpoints), people, assignments, logs, receipt. |
| `api/routes/feeds.py` | `/api/feeds` | weather, news, sports, stocks (each with sub-endpoints). |
| `api/routes/reading.py` | `/api/reading` | shelf CRUD, libby/audible/google_play connect, sync. |
| `api/routes/features.py` | `/api` | `features`, `features/{flag_name}`. |
| `api/routes/parent.py` | `/api/parent` | `children`, `children/{child_id}/features`. |
| `api/routes/analytics.py` | `/api/analytics` | platforms, snapshots, `{platform}/summary`, `business-report`. |
| `api/routes/culinary.py` | `/api/culinary` | household, banned, equipment, recipes, dinner, prep, stockroom, walmart, WebSocket `/ws`. |
| `api/routes/location.py` | `/api/location` | `city` (IP geolocation). |
| `api/routes/google.py` | `/api/google` | auth url/callback, status, calendar, gmail, music, etc. |
| `api/routes/vision.py` | `/api/vision` | `analyze`, `inventory-item`, `listing`, `recipe`. |
| `api/routes/shopify_webhooks.py` | `/api/webhooks/shopify` | `orders`. |
| `api/routes/n8n_webhooks.py` | `/api/webhooks/n8n` | webhook receiver, `status`, `workflows`. |
| `api/routes/image.py` | `/api/image` | `generate`. |
| `api/routes/push.py` | `/api/push` | subscribe, unsubscribe, vapid public key, `test`. |
| `api/routes/legal.py` | _no prefix_ | `/privacy`, `/privacy-policy`, `/terms`, `/terms-of-service`. |
| `api/routes/rag.py` | `/api/rag` | `ingest`, `query`. |
| `api/routes/daemons.py` | `/api/daemon` | `heartbeat`, `status`, `{daemon_name}/task`. |
| `api/routes/context.py` | `/api/context` | `sensor_event`, `rooms`. |
| `api/routes/broadcast.py` | `/api/broadcast` | `lip_sync`. |
| `api/routes/rover.py` | `/api/rover` | `telemetry` (POST daemon, GET user), `command`, `status`. |

### 1.3 Provider abstraction (`providers/`)

```
providers/
├── base.py                       # STTProvider, LLMProvider, TTSProvider ABCs
├── llm/
│   ├── ollama.py                 # Local — primary
│   ├── claude_api.py             # Anthropic (claude-haiku/sonnet/opus 4.x)
│   ├── gemini.py                 # google-genai SDK
│   ├── openai_api.py             # OpenAI
│   ├── mistral_api.py            # Mistral AI
│   ├── bedrock.py                # AWS Bedrock (Nova, Claude, Llama, DeepSeek, Mistral)
│   ├── vision_provider.py        # Local image analysis (moondream/llava via Ollama)
│   └── registry.py               # Static catalog: 35+ ModelEntry rows with vram_gb and pricing
├── stt/
│   └── whisper_local.py
├── tts/
│   ├── piper.py                  # Default local
│   ├── kokoro_provider.py        # CPU neural, Python 3.10–3.12 only
│   ├── elevenlabs.py             # Cloud, returns MP3
│   ├── chatterbox_provider.py    # Voice cloning
│   ├── null_tts.py               # Disabled
│   └── voice_registry.py         # Voice catalog (engine + voice_code)
├── memory/
│   ├── sqlite_store.py           # All persistence
│   ├── vector_store.py           # ChromaDB wrapper
│   ├── embedding_provider.py
│   ├── models.py                 # Fact, Preference, ConversationSummary, MemorySettings, LLMSettings, TTLOption
│   └── ttl_engine.py
├── google/                       # auth, calendar, gmail, maps, books, youtube_music
├── feeds/                        # weather, news, sports, stocks
├── web/                          # search.py (SearXNG → Tavily → Google PSE → TinyFish chain), weather.py
├── commerce/                     # amazon, walmart, shopify
├── reading/                      # audible, kindle, libby
├── smart_home/                   # home_assistant, device_registry
├── rag/                          # rag_provider + chunker
├── image/                        # sd_provider (A1111 on-demand)
├── push/                         # sender (pywebpush)
├── automation/                   # n8n_client
└── google/                       # auth/calendar/gmail/maps/books/youtube_music
```

### 1.4 Daemons (`daemons/`)

`base_daemon.py`, `registry.py`, `river-song-daemon@.service` (systemd template). Concrete daemons: `warden/` (vision/RTSP+YOLO), `mechanic/` (MAVLink/ArduRover), `herald/` (lip-sync + Hub casting), `sifter/` (background RAG indexing). All disabled by default via `*_ENABLED` flags.

### 1.5 Frontend (`frontend/src/`)

```
main.jsx           # Mounts AuthProvider → App (short-circuits to KioskPage on /kiosk)
App.jsx            # Page router via currentPage state stored in localStorage('rs-page')
context/AuthContext.jsx
hooks/useWebSocket.js, useAudioRecorder.js, useAudioLevel.js
utils/AudioPlayer.js, constants.js, pushNotifications.js
styles/global.css, themes.css
components/
  Sidebar.jsx              # primary nav, USER_ITEMS vs ADMIN_ITEMS
  NavBar.jsx               # legacy/unused — App.jsx never imports it
  ConversationPanel.jsx
  AudioVisualizer.jsx
  RiverSong.jsx            # 3D avatar (react-three-fiber)
  RiverStatusBox.jsx
  HealthCard.jsx
  ErrorBoundary.jsx
  MaintenancePulse.jsx
  InventoryVault.jsx
  QuickPOS.jsx             # MOCK-only POS demo, fed from in-file MOCK_PRODUCTS
pages/
  LoginPage / SignupPage / SetupPage / GoogleCallbackPage / ReadingOAuthCallbackPage
  DashboardPage
  ConversationPage      # "Speak"  → WebSocket
  ChatPage              # "Chat"   → HTTP SSE
  MemoryPage / RoutinesPage / HomeNodePage / EnvironmentPage / KillSwitchPage
  ProfilePage / SettingsPage
  FeedsPage / GooglePage / CommercePage / ReadingPage / AnalyticsPage
  InventoryPage / MaintenancePulsePage / CulinaryPage
  UsersPage
  KioskPage             # /kiosk standalone
```

### 1.6 Tier-1 SQLite tables (in `river_song.db`)

From `providers/memory/sqlite_store.py`: `facts`, `preferences`, `conversation_summaries`, `memory_settings`, `llm_settings`, `users`, plus `admin_config` (k/v JSON blob holding `hidden_features`, `hidden_llms`, `hidden_voices`, `ai_features`, `elevenlabs_config`, `persona_config`, `child_features`). Tool executors lazily `CREATE TABLE IF NOT EXISTS` for: `inventory_items`, `shopping_list`, `reminders`, `vehicle_logs`, `recipe_stubs`, `routine_stubs`, `reading_shelf`, `kindle_books` (note `kindle_books` lives in `data/reading.db`, not `river_song.db`).

Other DBs: `data/commerce.db` (SQLAlchemy `commercial_inventory/models.py`), `data/inventory.db` (`inventory/models.py`), `data/vehicles.db` (`vehicles/models.py`), `data/culinary.db` (`culinary/models.py`).

---

## SECTION 2 — DEAD CODE & ORPHANED LOGIC

### 2.1 Backend modules with no consumer

| Module | Why it is dead |
|---|---|
| `users/user_management/user_management.py` | `UserManager` class is empty stubs; no caller anywhere. Auth is handled by `providers/memory/sqlite_store.py` + `core/auth.py`. |
| `users/user_profiles/user_profile.py` | Only referenced by sibling files in `users/`. Not imported by `main.py`, `api/`, `core/`. |
| `users/roles/roles.py`, `users/roles/permission.py` | Self-referential. Role data flows through JWT payload + the `users.role` column in SQLite. |
| `users/user_roles/admin/admin_dashboard.py` | Zero references. |
| `inventory/auth.py`, `inventory/qr_utils.py`, `inventory/file_utils.py`, `inventory/customerSchema.json` | Only one referrer each (within `inventory/management.py`); not used by FastAPI routes. `customerSchema.json` is unused completely. |
| `culinary/migrate_strip_html_steps.py` | One-time migration helper; harmless but should be retired. |
| `legacy/ha_environment_snapshot.txt` | Snapshot text file from the Home Assistant install — never read. |
| `docs/testing/test_cli_test_ascii.txt`, `docs/testing/test_cli_test_utf8.txt` | Random fragments ("Can you make pink a little more pinkish") — looked like accidental commits. |
| `docs/modules/gemini.txt`, `docs/modules/medical_image_analysis.txt` | Drafted module specs; nothing implements them. |
| `frontend/src/components/NavBar.jsx` | Imported nowhere. The active nav is `Sidebar.jsx`. |

### 2.2 Backend bugs that make whole endpoints unusable

| File:line | Symptom |
|---|---|
| `api/routes/auth.py:258` | `re.compile(...)` is called but the file never `import re`. Hitting `PUT /api/auth/integrations` raises `NameError`. |
| `api/routes/auth.py:269` | `dotenv.load_dotenv(override=True)` — `dotenv` is never imported. Same code path. |
| `api/routes/auth.py:393` and `:406` | `request.app.state.memory_manager.store` — the attribute is `_store`. Calling `GET /api/auth/profile` or `PATCH /api/auth/profile` raises `AttributeError`. The frontend `App.jsx` calls `PATCH /api/auth/profile` every time the theme changes; on the first theme save the call fails silently because the frontend wraps it in `.catch(() => {})`. |
| `api/routes/models_settings.py:480-535` | `GET /api/tts/preview/{voice_id}` synthesizes audio then **never returns it**. The function falls off the end after the empty-bytes check, so the endpoint always returns `null` to the client. Voice previews in the Settings UI cannot work. |
| `core/conversation_loop.py:101` | `ClaudeAPILLM(model=model)` is called when `llm_model_override` is set, but `providers/llm/claude_api.py:23` `def __init__(self)` accepts no `model` argument. Picking an Anthropic model in the Chat dropdown will raise `TypeError` and the chat will fail. The same is true for `BedrockLLM`, `OpenAILLM`, and `MistralAILLM` — only `OllamaLLM` and `GeminiLLM` accept `model=`. |
| `core/conversation_loop.py:303` | `await self._llm.chat(...)` is called inside `run_startup_briefing`, but only `ClaudeAPILLM` and `OllamaLLM` define `chat()`. For Gemini/OpenAI/Mistral/Bedrock the briefing always raises `AttributeError`, which is silently caught and logged at `DEBUG`. |
| `core/conversation_loop.py:625` | Same `await self._llm.chat(...)` call in habit inference. Same problem. |
| `api/routes/conversation.py:362` | SSE chunks are written as `f"data: {chunk}\n\n"`. If a token contains a literal newline, the SSE protocol fences break and the frontend reader stops mid-stream. There is no JSON-encoding. |
| `core/conversation_loop.py:355–377` | `_stream_sentences` splits on `[.!?\n]+`. Code blocks, decimals, abbreviations ("e.g.") all chop into partial sentences sent to TTS, producing audible artifacts. |
| `api/routes/n8n_webhooks.py:46`, `:55` | `/api/webhooks/n8n/status` and `/workflows` accept no auth. They reveal the n8n base URL, enabled flag, and (worse) the full workflow list. |
| `daemons/registry.py:call_daemon` callers | `core/conversation_loop.py:_trigger_herald_lip_sync` swallows errors silently; a missing Herald daemon never surfaces. |
| `api/routes/conversation.py:107–110` | `store.get_llm_settings(user_id)` is called against the **outer** memory store, but per-user voice/model is read here while inside `lifespan` `MemoryManager` exposes `_store` privately. Works only because both names line up; if `MemoryManager._store` is renamed, the WebSocket fails. |

### 2.3 Frontend components referencing missing endpoints / fields

| Reference | Reality |
|---|---|
| `App.jsx` — `fetch('/api/auth/profile', { method: 'PATCH', body: { theme } })` | `PATCH /api/auth/profile` exists but reads `request.app.state.memory_manager.store` (`.store` — wrong attr). Server returns 500; frontend ignores it (silent miss). Same on the GET call that reads `serverTheme`. |
| `ChatPage.jsx` model dropdown — uses `data.cloud[i].model_id` + `data.local[i].model_id` then sets `selectedModel.provider`/`model_id` | The `POST /api/settings/llm` body contract is `{ provider, model_id, cloud_fallback_enabled, cloud_fallback_provider?, cloud_fallback_model? }` — matches. But the chat then sends `provider` and `model_id` to `POST /api/conversation/chat`; the server in `_build_llm_provider` passes those to provider constructors that don't accept them (see 2.2). Picking any cloud model fails. |
| `ConversationPage.jsx` — `fetch('/api/settings/llm')` and uses `d.model` as the `display_name` | The backend returns `s.model` (the raw model id like `llama3.2:3b`), not a display name. UI shows the wire id, not the pretty label that `models` endpoint exposes. |
| `ConversationPage.jsx` line 274 — uses `d.active_voice` from `/api/settings/voice` | Server response shape matches, but `d.active_voice` is the human "display_name", not the voice_id. Comparison code elsewhere that wants the voice_id has to use `d.active_voice_id`. The current page only displays it so it's cosmetic. |
| `ChatPage.jsx` — `fetch(... /api/conversation/chat)` reads SSE chunks split on `data: ` | If a chunk contains a `\n` (Claude often produces them) the loop emits half a token and resyncs only on the next `data: `. See 2.2. |
| `DashboardPage.jsx` — references widgets like `health_status`, `system_status`, etc. | Only `GET /api/dashboard` is implemented as a single aggregated endpoint. Widget toggles render but the data they show is whatever `dashboard` returns; nothing is per-widget. |
| Sidebar `USER_ITEMS` includes a `google` item flagged `soon: true` | `App.jsx` does render `<GooglePage />` for `currentPage === 'google'`. The "SOON" badge is purely cosmetic but misleading because the page is fully wired. |
| Sidebar `ADMIN_ITEMS` has `environment` but no `vehicles` | `MaintenancePulsePage` is the only vehicle-related page, mounted as `maintenance`. There is no top-level `vehicles` nav item even though `/api/vehicles` is fully implemented. The backend tree is wider than the frontend exposes. |
| `App.jsx` does not render any `currentPage === 'links'` page | `api/routes/features.py:ALL_FEATURES` defines a feature `{key: "links"}`. Nothing in the frontend consumes it. Dead feature key. |
| `ChatPage.jsx` history dropdown lists `m.provider` etc. | OK — display only. |
| `DashboardPage.jsx`, `MemoryPage.jsx`, `RoutinesPage.jsx`, `KioskPage.jsx` | None show loading / empty states for the case where `fetch` rejects with `TypeError: NetworkError`. They display nothing or `[]` — no user-visible error. |

---

## SECTION 3 — SESSION & MEMORY FAILURES

The user complaint: **"New chat sessions are inheriting prior context."** Both transports (HTTP `ChatPage` and WebSocket `ConversationPage`) re-inject persistent memory into the system prompt on every turn. That is the design — but two amplifiers turn it into the bug you're observing.

### 3.1 Conversation array lifecycle

**Voice path (`ConversationPage.jsx` → `/ws/conversation`):**

1. WebSocket connects. `api/routes/conversation.py:116` builds a fresh `ConversationLoop(user_id, ...)`.
2. `initialize()` builds providers and calls `_rebuild_system_prompt()`. `core/conversation_loop.py:331` populates `_history` with **just** a `{"role":"system", "content": personality + memory_block + context_block}`. **History is empty for the new connection.** ✓
3. Every turn: `_rebuild_system_prompt()` is invoked again at `run_once:478` / `run_text:668`. This **overwrites** index 0 with a freshly-built system prompt; user/assistant entries appended in previous turns of **the same WebSocket** remain.
4. `reset_history()` rebuilds the system prompt and clears user/assistant entries.
5. Closing and reopening the WebSocket creates a new `ConversationLoop`. No bleed of `_history` across connections.

**Text path (`ChatPage.jsx` → `POST /api/conversation/chat`):**

1. Stateless on the server. The endpoint at `api/routes/conversation.py:302` reads `body.history[-20:]` and prepends a system message it computes from `settings.river_song_system_prompt + memory_manager.build_context_block(user_id)`.
2. The client's `messages` state is the only "session memory". Clicking RESET clears `messages` and saves the session into localStorage.

### 3.2 Where context leaks across sessions

| Source | Behavior |
|---|---|
| `MemoryManager.build_context_block(user_id)` (`core/memory_manager.py:90`) | Always loads **all facts**, **all preferences**, and the **last N summaries** (default `memory_max_summaries_in_context=10`). These are concatenated under `--- MEMORY ---` and injected. Every turn of every session sees them. |
| `ChatPage.jsx:185-205` `extractFacts` triggers | The page calls `POST /api/conversation/extract-facts` whenever (a) the user hits RESET, **(b) `visibilitychange` fires `hidden`**, and **(c) ChatPage unmounts**. Each call runs three LLM passes in the background (`_extract_facts`, `_extract_preferences`, `_generate_summary`) and unconditionally `upsert_fact` / `upsert_preference` / `record_summary` to SQLite. The result is that switching tabs, navigating away, locking the screen, or just switching pages writes "facts" the user never explicitly asked to remember. By the next session, those facts are already in the system prompt. |
| `core/conversation_loop.py:594-606` (`run_once` Step 6) | Every voice turn auto-writes a summary like `User said: "..." River Song responded: "...". MEMORY_SUMMARIES_ENABLED=true` is the default, `MEMORY_AUTO_EXTEND=true` is the default. The TTL extends every time the summary is referenced again. Old conversations effectively never expire. |
| `core/conversation_loop.py:609-638` `_infer_habits` | After every voice turn the LLM is asked to infer a "habit pattern". If the model says anything other than `NONE` it is `upsert_preference`'d with confidence `low`. There is no de-duplication and no review queue. |
| `MemoryManager.upsert_fact` / `upsert_preference` | The id is a fresh UUID every call. The `sqlite_store.upsert_fact` SQL uses `INSERT OR REPLACE` keyed on `(user_id, key)` — facts dedupe, **but preferences key on `(user_id, category)` only**, so a category like `tone` is overwritten each time and never accumulates. Facts dedupe but their keys are produced by the LLM (`job_title`, `employer`, …) — so a misspelled key (`employer_name` vs `employer`) creates duplicate fact rows. |
| Auto-extension | `build_context_block` calls `extend_ttl` on every retrieved summary (because `auto_extend` defaults to true). The pull itself postpones expiry. |
| `core/conversation_loop.py:_rebuild_system_prompt` | This injects memory + live `ContextEngine.build_context_block()` into the system prompt. If `ContextEngine` ever holds stale room state (from Warden/HA), the assistant "remembers" things from a previous physical session. |

### 3.3 Root cause, plain English

The **HTTP** path is stateless per request — but the server stuffs facts/preferences/summaries into the system message every call. The **WebSocket** path runs a fresh `ConversationLoop` per connection — but the same memory block is built every turn. There is no concept of "clean slate session." The `reset_history` and `RESET` button only flush the *current* exchange; they don't suspend memory injection.

Compounding it, `ChatPage` is overzealous about writing memory: visibility change + unmount + reset all fire the extraction pipeline. A user who clicks `Chat → Memory → Chat` once will have already pushed an LLM-generated summary and inferred facts to SQLite. By turn 2 of the next session those are quoted back.

### 3.4 Recommended remediation (out of scope for this audit, listed so SECTION 9 can reference)

- Add a `MEMORY_INJECTION_MODE` toggle: `always` (current), `on_reference`, `off`. Default `off` for fresh chats.
- Make `ChatPage` `extractFacts` fire **only on explicit RESET**, never on `visibilitychange` or unmount.
- Gate `_infer_habits` behind an admin toggle.
- Require a `confidence >= medium` threshold for inferred preferences to land in the context block.
- Add a `DELETE /api/memory/preferences/{id}` route (currently missing — see SECTION 5).

---

## SECTION 4 — PROVIDER CAPABILITY GAPS

### 4.1 Capability matrix

| Provider class | File | Capability | UI hook present? | Notes |
|---|---|---|---|---|
| `LLMProvider.stream_response` | `providers/base.py:78` | Text streaming | ✅ ConversationPage / ChatPage | Required of every LLM. |
| `LLMProvider.stream_response_thinking` | `providers/base.py:103` | Extended thinking | ✅ ChatPage "THINK" chip | Only Claude (`claude_api.py`) and Gemini-2.5 (`gemini.py`) implement it. Others silently fall back. UI gives no signal which models actually think. |
| `LLMProvider.chat_with_tools` | implicit | Tool/function calling | ⚠️ Hidden | Only `ClaudeAPILLM.chat_with_tools` and `OllamaLLM.chat_with_tools` exist. Gemini/OpenAI/Mistral/Bedrock providers lack the method, so `core/conversation_loop.py:562` `hasattr` skips them. No UI toggle exposes tool use — gated solely on `TOOL_USE_ENABLED` in `.env`. |
| `LLMProvider.chat` (non-streaming) | `claude_api.py:30`, `ollama.py` | One-shot call | ❌ | Used by `_infer_habits` and `run_startup_briefing`. Missing on Gemini/OpenAI/Mistral/Bedrock → both features crash for those providers. |
| `STTProvider.transcribe` | `whisper_local.py` | Speech-to-text | ✅ Mic button on both Speak + Chat | Local only; `.env.example` lists `whisper_cloud`/`deepgram` as "future" — no implementation. |
| `TTSProvider.synthesize` / `stream_synthesize` | `piper.py`, `kokoro_provider.py`, `elevenlabs.py`, `chatterbox_provider.py`, `null_tts.py` | Text-to-speech | ✅ Settings → Voice | Voice picker correctly enumerates `VoiceRegistry`. **ElevenLabs** synthesizes only if `ELEVENLABS_API_KEY` is set; the elevenlabs provider always returns MP3, the rest return WAV — caller assembles `format=...` correctly. |
| Vision | `providers/llm/vision_provider.py` + `api/routes/vision.py` | Image analysis (analyze, inventory-item, listing, recipe) | ⚠️ Partial | Backend routes exist. The Inventory and Culinary pages call `/api/vision/inventory-item`, `/recipe`, `/listing` for receipt/manual capture. `analyze` has no UI consumer. `VISION_ENABLED=false` by default. |
| Image generation | `providers/image/sd_provider.py` + `api/routes/image.py` | Stable Diffusion image gen | ❌ **No UI surface anywhere.** | The route exists, the provider is fully implemented (including on-demand process spawning to free VRAM for Ollama), but no frontend page or component calls `POST /api/image/generate`. The capability is dead from the user's perspective. |
| Web search | `providers/web/search.py` chain | Web search | ✅ ChatPage "WEB" chip wires `web_search: true` to `/api/conversation/chat` | Voice path can also reach it via the `web_search` tool when tool use is on, but **the WebSocket path never sets `web_search`** — Speak page cannot search the web. |
| RAG (document QA) | `providers/rag/rag_provider.py` + `api/routes/rag.py` | Ingest + query | ⚠️ MaintenancePulse calls `/api/rag/ingest?doc_id=vehicle_…` for manuals. No general "Documents" UI. `RAG_ENABLED=false` by default. |
| Weather | `providers/feeds/weather.py` and `providers/web/weather.py` | Forecast | ✅ FeedsPage | Two implementations exist — `feeds/weather.py` (OpenWeatherMap, used by intent router + feeds page) and `web/weather.py` (used only by the `get_weather` tool). They overlap. |
| News | `providers/feeds/news.py` | NewsAPI + RSS | ✅ FeedsPage | Multi-source. |
| Sports / Stocks | feeds providers | ✅ FeedsPage | OK. |
| Google Calendar / Gmail / Maps / YouTube Music / Books | `providers/google/*` | OAuth + read | ✅ GooglePage + intent router | The Books provider exists but the Reading page only wires Audible / Kindle / Libby / Google Play Books. |
| Audible / Kindle / Libby | `providers/reading/*` | Library sync | ✅ ReadingPage | OK. |
| Commerce (Amazon SP-API / Walmart / Shopify) | `providers/commerce/*` | Inventory + orders | ⚠️ CommercePage exists but is mostly manual entry. The intent router (`_handle_commerce`) and tools call SP-API; UI does not call any of those routes from `/api/commerce`. The Amazon "low stock" view is intent/voice-only. |
| Smart home | `providers/smart_home/home_assistant.py` + `providers/smart_home/device_registry.py` | HA control | ✅ HomeNodePage | OK. |
| Push notifications | `providers/push/sender.py` | Web Push | ⚠️ `PUSH_NOTIFICATIONS_ENABLED=false` default; `utils/pushNotifications.js` subscribes when called but **nothing in the app calls `registerPushNotifications()`**. There is no subscribe button in Settings. |
| n8n orchestration | `providers/automation/n8n_client.py` | Workflow trigger | ⚠️ SettingsPage has fields but the only consumer is the `trigger_n8n_workflow` tool. No UI button to fire a workflow. |
| Wake word | `core/wake_word_service.py` + Ambient mode in ConversationPage | Hands-free wake | ⚠️ `WAKE_WORD_ENABLED=false`. The `tflite-runtime` install is manual and openWakeWord is optional. ConversationPage has the Ambient toggle. |
| Daemons (Warden / Mechanic / Herald / Sifter) | `daemons/` | Vision, telemetry, casting, document indexing | ⚠️ EnvironmentPage and rover routes touch them, but every daemon ships disabled. No status overview surfaces in the dashboard. |
| Voice cloning | `providers/tts/chatterbox_provider.py` | Voice clone | ❌ No UI hook. `CHATTERBOX_ENABLED=false`. |
| Vehicle manual RAG | route exists, RAG ingest from MaintenancePulse | ✅ Partial | Limited to the maintenance page. |
| Routines scheduler | `core/routines_scheduler.py` | Cron-style | ✅ RoutinesPage | OK. |
| Analytics platforms (TikTok / Instagram / Facebook / YouTube / Etsy / eBay / Shopify / Pinterest / Twitter) | only env keys exist; no provider modules | ❌ | `.env.example` collects credentials for all 9 platforms. **There is no Python code that uses them.** The Analytics page lets the user enter snapshot rows manually. The "business-report" route generates a report from `commercial_inventory` SQLAlchemy data only. |

### 4.2 Summary of capabilities defined-but-not-surfaced

- **Image generation** (`api/routes/image.py`) — backend complete, no UI page.
- **Voice cloning** (Chatterbox) — backend complete, no UI page.
- **Tool use** — implemented for Anthropic + Ollama only; no toggle on the UI; no UI panel that shows which tool the LLM called.
- **Multi-LLM routing / cloud fallback** — `LLMSettings` has `cloud_fallback_enabled / cloud_fallback_provider / cloud_fallback_model` columns saved by `POST /api/settings/llm`. Nothing in `core/conversation_loop.py` ever reads them — there is no actual fallback. Settings UI lets the user pick them, but the field has no effect.
- **Wake word** — backend ready, disabled by default, no admin UI to enable it (just `.env`).
- **Push notifications** — VAPID keys + subscribe route + service worker exist, but no front-end "Enable notifications" button is wired.
- **Analytics platform integrations** — credentials accepted in `.env.example`, no code consumes them.
- **n8n trigger** — exposed only via the tool calling path; no admin UI to fire a workflow manually.
- **Daemons** — Warden / Mechanic / Sifter have full skeletons but no operational telemetry surfaced.

---

## SECTION 5 — FRONTEND / BACKEND CONTRACT FAILURES

| Frontend expects | Backend returns | Failure mode |
|---|---|---|
| `ChatPage` `fetch('/api/models')` → `data.cloud[i].available` boolean, `m.display_name` | `_model_to_dict` returns `available`/`display_name` ✓ | OK. |
| `ChatPage` `fetch('/api/settings/llm')` → `s.provider, s.model` | `get_llm_settings` returns `provider, model, cloud_fallback_*` ✓ | OK. |
| `POST /api/settings/llm` body `{provider, model_id, cloud_fallback_enabled}` | Backend matches ✓ | OK. |
| `ChatPage` `POST /api/conversation/chat` body `{message, history, provider, model_id, web_search, thinking_mode, system_prompt?}` | `_ChatRequest` schema matches ✓ | OK — but downstream provider build crashes for non-Ollama/Gemini when `model_id` is set (see 2.2). |
| `ChatPage` SSE stream `data: <chunk>\n\n` | Server emits `f"data: {chunk}\n\n"` and `data: [DONE]\n\n` | If `chunk` contains `\n`, the client splits incorrectly. Symptom: missing partial sentences and trailing `data: ` lines treated as empty events. |
| `ConversationPage` `fetch('/api/settings/llm')` reads `d.model` to display | Returns the raw `model_id` (e.g. `llama3.2:3b`), not display_name | UI shows raw ID instead of "Meta Llama Standard". |
| `ConversationPage` `fetch('/api/settings/voice')` reads `d.active_voice` | Server returns the human-readable display name in `active_voice` ✓ | OK. |
| `App.jsx` `PATCH /api/auth/profile {theme}` | Endpoint references `memory_manager.store` (wrong attribute name) | Always 500. Silent — theme save fails to sync between devices. |
| `App.jsx` `GET /api/auth/profile` | Same bug | Server theme can never be loaded. |
| `MemoryPage` `DELETE /api/memory/facts/{id}` | Route exists ✓ | OK. |
| `MemoryPage` `DELETE /api/memory/preferences/{id}` | **No matching route exists.** Memory router only defines GET for `/preferences`. The DELETE call always 404s. | UI button does nothing. |
| `MemoryPage` `PUT /api/memory/preferences` | Route exists ✓ | OK. |
| `MemoryPage` `DELETE /api/memory/summaries/{id}` | **No matching route.** | DELETE fails 404. |
| `RoutinesPage` `POST /api/routines/{id}/run` | Route exists ✓ | OK. |
| `InventoryPage` `GET /api/inventory/homes/{home_id}/audit/active` and `/audit/history` | Routes exist (see grep output) ✓ | OK. |
| `MaintenancePulse` `POST /api/rag/ingest?doc_id=vehicle_{id}` | Route accepts `doc_id` query + file upload ✓ | OK. |
| `MaintenancePulse` `POST /api/vehicles/{vehicle_id}/manual/preview` | Route exists ✓ | OK. |
| `EnvironmentPage` `fetch('/api/context/rooms')` | Route exists, returns rooms dict ✓ | OK. |
| `EnvironmentPage` `fetch('/api/context/sensor_event', POST)` | Route expects daemon internal secret header — user JWT will be rejected. | Manual room override from EnvironmentPage POSTing as a logged-in user is **rejected** because the route's `_require_internal` check looks for `Bearer {daemon_internal_secret}`. The page's manual-event UI cannot work. |
| `KioskPage` opens `WSS /ws/conversation` | Server requires `token` query param; KioskPage does not send one. | KioskPage **immediately disconnects** with code 4001. Kiosk mode is currently broken because `/ws/conversation` now enforces auth (`conversation.py:82-86`). |
| `EnvironmentPage` and `HomeNodePage` JSON fetches | use `localStorage.getItem('rs-auth-token')` directly | Works, but bypasses `AuthContext.token` — if the token is rotated by `useAuth().logout`, these pages keep the stale value until reload. |
| `ConversationPage.jsx:267-275` `setActiveVoice({active_voice: d.active_voice})` | Should be `d.active_voice` (string) but later reads `activeVoice?.active_voice` | Works — but the nested shape is unnecessary. |
| `SettingsPage` ElevenLabs save passes `voice_id`/`model_id` | Backend reads them ✓ | OK. |
| `SettingsPage` Persona save | `POST /api/settings/persona` ✓ | OK. |
| `AnalyticsPage` `GET /api/analytics/platforms` | Returns list ✓ | OK. |
| `AnalyticsPage` `GET /api/analytics/business-report?days=30` | Route exists ✓ | OK. |
| `ChatPage` `POST /api/conversation/extract-facts` | Returns 202 + status ✓ but runs heavy background work | Each call is a triple LLM dispatch — see SECTION 3. |
| `ChatPage` model picker hides "available=false" cloud models | Cloud availability is `enabled && api_key set`. Anthropic key missing → model hidden. Good. | OK. |
| `useWebSocket` reconnect | Code 4001 ("Authentication required") triggers reconnect loop indefinitely with no user-facing message. | If JWT expires mid-session, the UI just shows "Connecting…" forever. |

---

## SECTION 6 — UI / UX INTEGRITY

### 6.1 Navigation & hierarchy

- **`USER_ITEMS` vs `ADMIN_ITEMS` divergence:** the user view shows `commerce`, `analytics`, `feeds`, `google`, `reading`, `culinary` — but does **not** include `routines`, `home`, `environment`, `users`, `killswitch`, `dashboard`. The admin view includes all of these but also re-includes the user items. The two lists are maintained separately — drift is inevitable (e.g. `vehicles` is missing from both).
- **"SOON" badge on Google:** the page is fully wired and functional. Remove the `soon: true` flag.
- **`KioskPage` is bound to `/kiosk` outside the auth shell** but its WebSocket call has been hardened to require a JWT, so kiosk mode no longer works without an auth bypass (SECTION 5).
- **No persistent active-state in mobile topbar** — when the sidebar drawer is closed, there is no breadcrumb or label on mobile telling you which page you are on.
- **`mobile-overlay` only closes when clicking the backdrop**, not when navigating via the back button. Browser back-button navigation does not change `currentPage` because navigation is purely in React state (no React Router). Pressing the browser back button will exit the SPA entirely.

### 6.2 Loading / error / empty states

| Page | Loading | Error | Empty |
|---|---|---|---|
| `ConversationPage` | "Connecting..." status strip ✓ | Inline `conv-status-error` ✓ | "Start a conversation" via ConversationPanel ✓ |
| `ChatPage` | Thinking bubble during request ✓ | Inline `chat-error-inline` ✓ | ConversationPanel empty state ✓ |
| `DashboardPage` | None — widgets render undefined | `HealthCard` has its own retry ✓ | "No data yet" per widget — sometimes missing |
| `MemoryPage` | None — flicker between tabs | None on `catch` | Empty tabs render no message |
| `RoutinesPage` | None | None | "No routines yet" ✓ |
| `HomeNodePage` | None | "Not configured" message ✓ | Empty room shows nothing |
| `FeedsPage` | None on each tile | None | Default fallback strings ✓ |
| `GooglePage` | None | Inline ✓ | OK |
| `CommercePage` | None | Toasts ✓ | OK |
| `ReadingPage` | None | Inline ✓ | OK |
| `AnalyticsPage` | None | "Failed to load" ✓ | OK |
| `InventoryPage` | None | Inline ✓ | OK |
| `MaintenancePulsePage` | spinner ✓ | Inline ✓ | OK |
| `CulinaryPage` | None on tabs | Inline ✓ | OK |
| `EnvironmentPage` | None | None | "No room data" ✓ |
| `KillSwitchPage` | spinner ✓ | Inline ✓ | OK |
| `UsersPage` | None | None | "No users" ✓ |
| `KioskPage` | "INITIALIZING…" loading screen via Suspense | None | Empty |
| `SettingsPage` | None | None | OK |
| `ProfilePage` | None | None | OK |

**Verdict:** loading indicators are inconsistent. Most pages just render `[]` while waiting. Failing fetches almost always disappear silently because the code uses `.catch(() => {})` heavily.

### 6.3 Layout

- `frontend/src/styles/global.css` mixes a Material 3 palette (`--md-*` tokens) with a separate set of `themes.css` palettes (`--bg`, `--primary`, `--accent`, `--text-muted`). Components reference both vocabularies inconsistently — `Sidebar.jsx` uses `--md-*`, `RiverStatusBox` uses theme vars, `EnvironmentPage` mixes both. Switching theme via `data-theme` only swaps the theme set, not the M3 set, so half the UI ignores the user's theme choice.
- The `'rs-theme:' + user.id` localStorage key persists per user but defaults to `halo` — a theme that doesn't always exist depending on the load order of `themes.css`. The valid theme set is enforced server-side at `auth.py:VALID_THEMES = {"halo","crimson-dark","combat","midnight-violet","amber","arctic","cyberpunk","dune"}`. The CSS file must contain all eight; if it doesn't, the UI silently falls back to undefined CSS variables.
- `ConversationPage` reserves vertical space for a `conv-state-bar` listing `STATE_TABS` even when the avatar is hidden. Looks vestigial.

### 6.4 Orphan or vestigial UI

- `frontend/src/components/QuickPOS.jsx` — hardcoded `MOCK_PRODUCTS`. Not imported anywhere (verified with `grep -rln "QuickPOS"`).
- `frontend/src/components/NavBar.jsx` — not imported (Sidebar replaced it).
- `frontend/src/components/InventoryVault.jsx` — referenced once by `InventoryPage` (still alive — keep).
- `STATE_TABS` constant is exported from `utils/constants.js` *and* redefined inline in `ConversationPage.jsx:31`. Should consolidate.
- `frontend/public/avatar.glb` — only referenced from `RiverSong.jsx` (alive).
- `frontend/public/sw.js` — referenced by `pushNotifications.js`. The push button is never wired, so the service worker registration code never runs.

---

## SECTION 7 — SECURITY & AUTH

> A full severity-graded security audit lives in `RIVER_SONG_SECURITY.md`. The points below are a structural summary; see that file for CRITICAL/HIGH/MEDIUM/LOW classification and remediation.

### 7.1 Authentication enforcement at route level

- The JWT helper `core/auth.py:decode_token` is invoked by either an inline `_require_user`/`_require_admin` helper, an explicit `decode_token(...)` call, or a `Depends(get_current_…_user)` FastAPI dependency.
- Routes that **lack any auth** or have weakened auth:
  - `GET /health` — intentional.
  - `GET /privacy`, `GET /terms`, etc. — intentional public HTML.
  - `POST /api/image/generate` — **no auth check.** Anyone on the network (or via the Cloudflare tunnel) can run Stable Diffusion on your GPU. Gated only by `IMAGE_GENERATION_ENABLED`.
  - `POST /api/webhooks/shopify/orders` — no signature verification. Any HTTPS client can post a fake order payload and it will be processed by `ShopifySyncWrapper`.
  - `GET /api/webhooks/n8n/status` and `GET /api/webhooks/n8n/workflows` — anonymous. Leaks `n8n_url`, enabled flag, and the entire workflow list.
  - `GET /api/auth/setup-status` — intentional, but also accessible after setup is complete, which is fine.
- Routes that rely on `daemon_internal_secret` — `POST /api/broadcast/lip_sync`, `POST /api/rover/telemetry`, `POST /api/context/sensor_event`. The default value of that secret is the literal string `"change_me_in_production"` and it lives in plaintext in `.env` (correctly excluded from git).
- `_require_admin` is correctly enforced for: admin routes, `PUT /api/features/{flag}`, `POST /api/settings/elevenlabs`, `POST /api/settings/persona`, `POST /api/rover/command`, daemons routes.
- **Role enforcement at the data layer:** the `features.py` cascade is enforced server-side (admin → globally hidden minus → child filtered). However:
  - `commerce.py`, `culinary.py`, `inventory.py`, `vehicles.py` all do auth at the endpoint but rely on `resolve_module_owner` (`core/family.py`) for cross-user access. **There is no test of role**: a non-admin user who is added as a "collaborator" can perform writes; no read-only family role.
  - `MemoryPage` allows the user to delete their own facts (`DELETE /api/memory/facts/{id}`). The handler trusts the JWT `sub`; if a child role is using the page they can wipe all their memory. There is no per-feature role check in `memory.py`.

### 7.2 Secrets & credentials

- `.env` is correctly `.gitignore`d at HEAD.
- **`config_files/google_client_secrets.json` is present locally and was committed in earlier history.** `git show 6252652:config_files/google_client_secrets.json` reveals a live Google OAuth `client_id` and client secret. Commit `8cdf2a6` "remove tracked credential files and .env from git history" only deleted them from HEAD — the history was **not** rewritten, so the secret is still extractable from any cloned copy of the repository. The repo is currently pushed to `cassu123/RiverSongAI` on GitHub. See `RIVER_SONG_SECURITY.md` finding **C-1**.
- `JWT_SECRET_KEY` in the live `.env` is a 64-char hex secret (`0f1e1c…`) — strong, but unique to this single deployment. If it ever appears in logs or a screenshot, every issued token is forgeable.
- `NEWS_API_KEY` and `GOOGLE_MAPS_API_KEY` are real credentials in `.env`. They are **not** in git history (only the example placeholders are).
- The `KILL_SWITCH_PASSWORD_HASH` in `.env` is a bcrypt cost-12 hash. OK.

### 7.3 API security posture

- **No rate limiting** anywhere. The webhook routes and the `/api/conversation/chat`, `/api/conversation/extract-facts`, `/api/image/generate` endpoints are wide open to abuse.
- **Stack traces:** the SSE handler in `chat_http` formats raw exception strings into the response stream (`yield f"data: [ERROR] {exc}\n\n"`). A failed Anthropic call will return its internal error message to the browser.
- **CORS:** `cors_origins` is correctly restricted in production (`["https://riversongai.com", "www.riversongai.com", "app.riversongai.com"]`). The development default in `config/settings.py` is `["http://localhost:5173"]`. Watch out for `ALLOWED_HOSTS=["*"]` in `.env.example` — must be tightened in prod.
- **Input validation:** Pydantic enforces schemas on the body, but `culinary` and `commerce` write user-supplied strings directly into SQLite via SQLAlchemy ORM — safe from SQL injection. `core/tools.py:_exec_*` uses parameterized `sqlite3` queries — safe. Free-text user inputs are not sanitized before being rendered as bubble text on the frontend (React auto-escapes — fine), but **HTML inside fact values** would render literally inside `<p className="chat-bubble-text">`.
- **Path traversal:** `inventory` allows the user to upload `receipt` and `warranty-image` files to `/api/inventory/items/{item_id}/receipt`. The filename is generated server-side from `item.id`, so path traversal is unlikely; but the file is written under `data/` without a content-type whitelist.
- **WebSocket auth:** `/ws/conversation` requires a `token` query parameter. Tokens-in-URL leak to access logs and the Cloudflare edge.
- **Cloudflare middleware:** `_CloudflareIPMiddleware` trusts the `CF-Connecting-IP` header blindly. If the app is ever exposed directly (without the tunnel), an attacker can spoof any client IP for logs/intent routing.

### 7.4 Firebase

There is no Firebase usage anywhere. The brief assumes Firestore + Storage rules — none exist. **All "data layer authorization" actually means SQLite query filters and the `user_id` field on every row.** If the auth dependency is bypassed, the SQLite layer trusts whatever `user_id` is passed.

---

## SECTION 8 — MISSING FEATURES WITH NO IMPLEMENTATION

| Feature | Status | What is missing |
|---|---|---|
| **Image generation** | Backend complete (`/api/image/generate`). | No UI page. No "create image" button. Capability is currently a hidden API. |
| **Monument Valley theme toggle** | Not present. | `VALID_THEMES` does not include `monument-valley` (or anything analogous). `themes.css` has no entry. No code references this theme. |
| **Multi-LLM routing / cloud fallback** | DB schema and POST body exist (`LLMSettings.cloud_fallback_*`). | `_build_llm_provider` never reads them. There is no try/except wrapper that catches a primary-provider failure and switches to the fallback. UI exposes the setting but it is inert. |
| **Voice cloning (Chatterbox)** | Provider class implemented (`providers/tts/chatterbox_provider.py`). | No UI to manage reference audio, no admin toggle, `CHATTERBOX_ENABLED=false`, voice registry only has piper/kokoro/elevenlabs entries. |
| **Wake-word configuration UI** | Backend optional. | No "configure wake word" panel — value comes only from `.env`. |
| **Push notifications UX** | Backend route exists, frontend `pushNotifications.js` helper exists. | No button to call `registerPushNotifications()`. No `/api/push/test` button. Setting `PUSH_NOTIFICATIONS_ENABLED=true` does not auto-prompt the user. |
| **Analytics platform integrations** | `.env.example` collects credentials for TikTok, Instagram, Facebook, YouTube, Etsy, eBay, Shopify, Pinterest, Twitter. | **No Python module reads them.** AnalyticsPage is manual-input-only. |
| **Vehicle nav UI** | Backend complete. | No sidebar entry — vehicles are only reachable via MaintenancePulse. |
| **Web search in Speak page** | ChatPage has a "WEB" chip; ConversationPage has none. | Voice users cannot opt into web search per turn (only via the global `tool_use_enabled` flag). |
| **Tool use UI** | Backend works for Claude + Ollama. | No UI to enable/disable per session; no surface showing "River Song called tool X with input Y." Tool errors return `{"type":"text","content":"I had trouble…"}`. |
| **RAG documents page** | Vehicle manual ingest works. | No general "Documents" page to upload + query arbitrary PDFs. |
| **Daemons dashboard** | Heartbeats stored. | No widget that says "Warden: down / up". EnvironmentPage shows room state but not daemon status. |
| **Voice preview** | `/api/tts/preview/{voice_id}` endpoint exists. | Endpoint **does not return audio** (see SECTION 2.2). Settings preview button always silent. |
| **Theme sync across devices** | `/api/auth/profile` PATCH wired from `App.jsx`. | Server crashes due to `.store` typo. Themes never sync. |
| **Memory deletion (preferences & summaries)** | Routes for facts exist. | No `DELETE /api/memory/preferences/{id}` or `/summaries/{id}` route. UI cannot remove individual prefs or summaries. |
| **Conversation history pagination** | `MemoryPage` summaries fetch is unpaginated. | Older summaries beyond the default limit cannot be browsed. |
| **Kiosk mode** | Backend WebSocket still gated by auth. | `KioskPage` has no way to obtain a token — kiosk is broken until a kiosk-token endpoint is added or the WebSocket gains a kiosk-token mode. |
| **Auto-reconnect UX on auth expiry** | `useWebSocket` reconnects infinitely. | No "please log in again" toast. |
| **Robust SSE encoding** | Plain text chunks. | A `\n` in any chunk silently truncates the visible response — see SECTION 5. |

---

## SECTION 9 — PRIORITY FIX LIST

Ordered by: (1) breaks core functionality → (2) data-integrity → (3) user-facing failure → (4) dead weight → (5) missing features.

### Group A — Breaks core functionality

1. **WebSocket auth required → KioskPage broken.** `api/routes/conversation.py:82-86`. Fix: accept a kiosk-mode bootstrap token, or branch on a query flag and serve a read-only kiosk session.
2. **`ClaudeAPILLM`, `OpenAILLM`, `MistralAILLM`, `BedrockLLM` constructors do not accept `model=`.** `providers/llm/claude_api.py:23`, `providers/llm/openai_api.py:*`, `providers/llm/mistral_api.py:*`, `providers/llm/bedrock.py:*`. Fix: accept `model: Optional[str] = None`, default to `settings.llm_model` when None.
3. **`GET /api/auth/profile` and `PATCH /api/auth/profile` crash.** `api/routes/auth.py:393, 406`. `request.app.state.memory_manager.store` → `_store`. Two-character fix; theme sync immediately starts working.
4. **`PUT /api/auth/integrations` crashes — `re` and `dotenv` not imported.** `api/routes/auth.py:258, 269`. Add `import re` and `import dotenv` (and decide whether `load_dotenv(override=True)` is what you actually want).
5. **`GET /api/tts/preview/{voice_id}` returns nothing.** `api/routes/models_settings.py:480-535`. After the empty-bytes check, add `return Response(content=wav_bytes, media_type="audio/wav")` (or base64 if frontend expects b64).
6. **`MEMORY` is injected on every turn even after RESET.** See SECTION 3. Add an opt-out per session: `POST /api/conversation/chat` accepts `forget_memory: bool`; `ConversationLoop.reset_history` accepts a `flush_memory: bool` flag.
7. **`/api/webhooks/shopify/orders` has no signature check.** `api/routes/shopify_webhooks.py`. Validate `X-Shopify-Hmac-SHA256` against a Shopify webhook secret stored in settings.
8. **`/api/image/generate` is anonymous.** `api/routes/image.py`. Add `_require_user` dependency; gate the SD process spawn behind the bearer check.

### Group B — Data integrity

9. **`ChatPage` writes facts on every page-blur or unmount.** `frontend/src/pages/ChatPage.jsx:196-205`. Fix: only call `extractFacts` from `handleReset`; remove the `visibilitychange` listener and the cleanup-effect call.
10. **`_infer_habits` writes low-confidence preferences with no human review.** `core/conversation_loop.py:609-638`. Gate behind a setting; persist into a `pending_habits` table that the user approves.
11. **`Preference` upsert is keyed on `(user_id, category)`.** New preferences with the same category overwrite old ones. `providers/memory/sqlite_store.py:_sync_upsert_preference`. Decide whether you want multi-value preferences and add a UUID-keyed mode if so.
12. **Auto-extend resets every TTL on every read.** `core/memory_manager.py:140`. Make `auto_extend` default off for the personal-data tier.
13. **Fact-extraction prompt asks the LLM to emit free-form keys.** `api/routes/conversation.py:411-429`. Result: `employer` / `employer_name` / `job_employer` duplicate rows. Enforce an allow-list of canonical keys in the prompt or post-process.

### Group C — User-facing failures

14. **SSE chunks containing `\n` break the client parser.** `api/routes/conversation.py:362`. JSON-encode each chunk: `yield f"data: {json.dumps(chunk)}\n\n"`; have the client `JSON.parse` each line.
15. **`useWebSocket` reconnects forever on `4001`.** `frontend/src/hooks/useWebSocket.js`. Detect code 4001 and surface a "session expired — please log in" banner; clear the token.
16. **No "DELETE /api/memory/preferences/{id}" or `/summaries/{id}`.** Add both routes; `MemoryPage` already calls them.
17. **`POST /api/context/sensor_event` rejects user JWTs.** `api/routes/context.py`. The EnvironmentPage manual override calls this endpoint with a user bearer — split into `/sensor_event` (daemon only) and `/manual_override` (admin only).
18. **`ConversationPage` displays `model_id` instead of `display_name`.** `frontend/src/pages/ConversationPage.jsx:268-271`. Either fetch `/api/models` and map, or extend `/api/settings/llm` to also include the display_name.
19. **"SOON" badge on Google sidebar.** `frontend/src/components/Sidebar.jsx:16,33`. Remove `soon: true`.
20. **Browser back button exits the SPA.** Adopt React Router (or push state synthetically when `currentPage` changes).
21. **Missing loading skeletons on Memory / Routines / Home pages.** Add per-tab skeletons.
22. **Mobile topbar lacks current-page label.** Add a heading bound to `currentPage`.

### Group D — Dead weight (cross-reference `RIVER_SONG_TRASH.md`)

23. Delete `frontend/src/components/NavBar.jsx`.
24. Delete `frontend/src/components/QuickPOS.jsx`.
25. Delete the `users/` Python tree (`user_management`, `user_profiles`, `roles`, `user_roles`).
26. Delete `inventory/customerSchema.json`, `culinary/migrate_strip_html_steps.py`, `legacy/`, `docs/testing/`, `docs/modules/gemini.txt`, `docs/modules/medical_image_analysis.txt`.
27. Delete `STATE_TABS` duplication in `ConversationPage.jsx:31`; use the import from `utils/constants.js`.
28. Consolidate `providers/feeds/weather.py` and `providers/web/weather.py` — pick one and delete the other.

### Group E — Missing features to build

29. Wire `cloud_fallback_*` into `_build_llm_provider` with a try/except chain (E1 cost: ~30 LOC, E2 add a setting to surface fallback decisions in the UI).
30. Image generation UI page consuming `/api/image/generate`.
31. Push-notifications enable button in Settings + Profile.
32. Wake-word configuration panel in Settings (admin-only).
33. Vehicle list page (separate from Maintenance Pulse).
34. General Documents/RAG page that ingests + queries arbitrary PDFs.
35. Tool-use side panel in ChatPage showing "River called `web_search` with query: …".
36. Daemon status widget on Dashboard.
37. Theme sync across devices (depends on fix #3).
38. Web-search toggle on the Speak page.
39. Analytics platform integrations — either build real providers for the 9 platforms in `.env.example` or remove the credentials from the example file to stop misleading new operators.

---

## SECTION 10 — TRASH REPORT

The detailed deletion list with rationale per file is in `RIVER_SONG_TRASH.md`.

---

## SECTION 11 — SECURITY AUDIT

See `RIVER_SONG_SECURITY.md` for the severity-graded breakdown.

---

*End of audit.*
