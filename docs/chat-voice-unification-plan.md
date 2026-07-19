# River Song — Chat + Voice Unification: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (already exists, tracks origin).

---

## 1. Mission

One conversation surface — the Gemini model. The user types or speaks into a
single continuous conversation; River answers in text always and in voice when
appropriate. The chat box is the front door to **everything** the app can do:
tools, web search, deep research, documents, memory. The voice page exists only
as the stage for a future Cortana-style avatar; it is a *view* of the same
conversation, never a separate one.

Owner-confirmed product decisions (from a structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Chat ↔ voice | One continuous conversation, one history. Voice is an input mode of chat. Separate page survives only as avatar stage. |
| History | Server-side. Raw transcripts retained for a bounded window, then distilled (“sparsed”) into a permanent per-user profile — facts, preferences, habits. This is the Chronos/personalization pipeline. |
| Actions | Full agent: chain multiple tools autonomously, show a receipt of what was done. No confirmation gates in this phase. |
| Web access | River decides automatically when to search. Deep research triggers off explicit user intent (“research X in depth”). Manual toggles remain as overrides. |
| Voice output | Match input mode (spoke → speaks back, typed → silent) + a user toggle to force always-speak or always-silent. |
| Devices | Phone app, River Vexa, River Kova, River Vector all coming. The conversation engine must be fully server-side and device-agnostic — every client is just I/O attached to one brain. |
| Research UX | Depth-dependent: quick research streams live progress inline; big jobs run in the background and drop the report into the conversation when done. |
| Hardware | Home server with NVIDIA GPU, local-first. Keep Whisper/TTS/Ollama warm; cloud (Claude/Gemini/GPT/NIM) is for heavy lifting. Voice latency is a first-class goal. |
| Users | Household, each member logs in. Per-user everything. Voice ID + Face ID later — leave hooks, do not build. |

---

## 2. Current state (audited 2026-07-19)

### What exists and works
- `core/conversation_loop.py` (1,286 lines) — the shared brain. Memory injection,
  skills injection, RAG splicing, intent router, single-shot tool use, model
  auto-routing (“River Decides”) with local Ollama safety net, sentence-chunked
  TTS streaming.
- `api/routes/conversation.py` — WS `/ws/conversation` (voice, ticket auth,
  barge-in, wake word, startup briefing) + HTTP SSE `POST /api/conversation/chat`
  (text) + `POST /api/conversation/extract-facts` + `enhance-prompt` + `transcribe`.
- `core/tools.py` — 25+ tool schemas + executors (calendar, inventory, shopping,
  reminders, smart home, vehicles, recipes, routines, commerce, n8n, reports,
  web_search, email search, weather, image gen, Google Books/Tasks, vault notes,
  code interpreter, mower, Playwright browser tools).
- `core/intent_router.py` — keyword/phrase fast-path for ~15 domains.
- `core/deep_research.py` + `api/routes/research.py` — staged pipeline
  (decompose → gather → fetch/extract → synthesize), saves report as a
  `research` document. Blocking, no progress events.
- `providers/memory/sqlite_store.py` — `facts`, `preferences`,
  `conversation_summaries`, `pending_habits`, `llm_settings`, `users`,
  `documents`, `skills`, plus the whole vault (Chronos) system.
- Frontend: `ChatInterface.jsx` (SSE chat), `ConversationPage.jsx` (WS voice),
  `ConversationPanel.jsx` (message rendering), `useAudioRecorder`, `AudioPlayer`
  (PCM chunk playback with gen-id staleness), `PresetSelector`.

### Confirmed bugs / dead code (fix in Phase 0)
1. **RAG chat broken**: with a doc attached, `ChatInterface.handleSend` posts to
   `/api/rag/query` and parses the response as SSE; the endpoint returns plain
   JSON (`{answer, chunks}`). Answer silently dropped, chat shows `...`.
2. **History clobbering**: both pages write localStorage key
   `rs-history:${userId}` — `ChatInterface` prepends + `slice(0,30)`,
   `ConversationPage` appends + `slice(-30)`, different record shapes. Using
   both surfaces corrupts history. (Fixed structurally by Phase 1.)
3. **Dead memory pipeline**: `/api/conversation/extract-facts` (facts +
   preferences + summary → store → Chronos daily note) is fully implemented and
   never called by any frontend code. Same for `enhance-prompt`.
4. **Text chat pays the voice tax**: `chat_http` builds a fresh
   `ConversationLoop` per request; `initialize()` loads Whisper **and** TTS in
   an executor for a text-only turn, and `run_text()` always ends with
   `_speak_and_send` — TTS synthesized then discarded by the SSE stream.
5. **Single-shot tools**: `run_text` handles exactly one `tool_call` then
   streams a final answer. No chaining.
6. Cosmetic/structural: `whisper_model if 'whisper_model' in locals()` hack in
   `conversation.py:164`; ~200 lines of model-picker JSX duplicated between the
   two pages; deep research has no progress reporting.

---

## 3. Target architecture

```
                    ┌────────────────────────────────────────────┐
 clients            │            Conversation Service            │
 ──────────         │  (server-side sessions, device-agnostic)   │
 web chat  ─┐       │                                            │
 web avatar ├─ WS ──┤  ConversationSession (per session_id)      │
 phone app ─┤       │    • message log  → SQLite                 │
 vexa/kova ─┘       │    • AgentLoop (multi-step tools)          │
                    │    • auto web-search / research triggers   │
                    │    • memory/skills/RAG context splicing    │
                    │  ProviderPool (warm, process-wide)         │
                    │    • Whisper (STT)  • TTS engine  • LLMs   │
                    │  Distiller (background)                    │
                    │    • session close → facts/prefs/summary   │
                    │    • retention sweep → prune raw, keep     │
                    │      profile (Chronos)                     │
                    └────────────────────────────────────────────┘
```

Key principles:
- **Sessions live server-side.** A `session_id` is the unit of conversation.
  Any client can attach to a session over one WS protocol. HTTP SSE remains as
  a thin compatibility path for fire-and-forget text turns.
- **One event protocol** for all clients (superset of today’s WS events).
  Text-only clients simply ignore audio events.
- **Providers are warm singletons.** Whisper/TTS/embedding models load once at
  app startup (GPU box, local-first). `ConversationLoop` stops owning provider
  lifecycle; it borrows from the pool. Text turns never touch STT; TTS runs
  only when voice output is wanted (`speak` flag per turn).
- **Voice output rule**: `speak = (input was audio) XOR user override toggle`
  (toggle states: `auto` | `always` | `never`, persisted in `user_preferences`).

---

## 4. Build phases

Work in order. Each phase is independently shippable and ends with the
verification listed. Commit per phase (or finer), push to
`claude/chat-voice-integration-bzdo2v`.

### Phase 0 — Surgical fixes (small, do first)

1. **Fix RAG-in-chat**: make `/api/rag/query` stream SSE in the same event
   shape as `/api/conversation/chat` (`{type:'text', content}` … `[DONE]`), or
   simpler: have `ChatInterface` detect JSON responses (`content-type`) and
   render `data.answer` + a sources footnote. Prefer the backend SSE change —
   one client parser everywhere.
2. **`text_only` conversations**: add `mode: "text" | "voice"` to
   `ConversationLoop.__init__`. In text mode `initialize()` skips STT and TTS
   construction, and `run_text` skips `_speak_and_send`. Use it in `chat_http`
   and `rag.query_rag`.
3. Remove the `locals()` hack: initialize `whisper_model = None` before the
   `try` in `conversation.py`.
4. Extract the duplicated model picker into
   `frontend/src/components/ModelPickerPopover.jsx` (rows, back button,
   popover positioning, provider views) and use it from both pages.

Verify: attach a PDF in chat and get a real answer; time a text chat turn
before/after (should drop by seconds on cold start); both pages still pick
models.

### Phase 1 — Server-side conversation service (the foundation)

**Schema** (add to `providers/memory/sqlite_store.py`, follow existing
`CREATE TABLE IF NOT EXISTS` + migration conventions):

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id            TEXT PRIMARY KEY,          -- uuid
    user_id       TEXT NOT NULL,
    title         TEXT DEFAULT '',           -- auto-generated after first turns
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    distilled_at  TEXT,                      -- when Distiller processed it
    archived      INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id),
    role        TEXT NOT NULL,               -- user|assistant|system|tool
    content     TEXT NOT NULL,
    meta        TEXT DEFAULT '{}',           -- JSON: input_mode, model_label,
                                             -- tool receipts, doc refs, etc.
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON chat_messages(session_id, id);
```

**Routes** (`api/routes/chat_sessions.py`, mounted like the other routers):
- `GET  /api/chat/sessions` — list (id, title, updated_at, message_count).
- `POST /api/chat/sessions` — create; returns id.
- `GET  /api/chat/sessions/{id}` — full message log.
- `DELETE /api/chat/sessions/{id}` — archive.
- All JWT-authed with the standard `_require_user` pattern; users only see
  their own sessions.

**Wire the loop**: `ConversationLoop` gains `session_id`; every appended
user/assistant/tool message also persists via the store. On attach, history is
loaded from DB (last N turns into the LLM window; full log available to the
client). The localStorage history in both pages dies; history UI reads the API.

**WS protocol additions** (keep every existing event; add):
- Client → server: `{"type":"attach","session_id":...}`,
  `{"type":"new_session"}`, `text_input` gains optional `speak` override.
- Server → client: `{"type":"session","session_id","title"}`,
  `{"type":"receipt","items":[{tool,summary,ok}]}` (Phase 2 emits these).

**Provider pool** (`core/provider_pool.py`): process-wide lazy singletons for
STT/TTS/embeddings created at app startup (`main.py` lifespan), with a lock
around first load. `ConversationLoop` borrows instead of building. Per-user
voice selection = per-call parameter where the engine allows it; only rebuild
an engine when the engine type itself changes.

Verify: two browsers (or browser + curl WS) attached to the same session see
the same live conversation; restart backend → history intact; text turn does
not load Whisper (log line absent); voice turn latency improved on second turn.

### Phase 2 — Agent loop (multi-step tools + auto search)

Replace the single-shot tool branch in `run_text`/`run_once` with a loop in a
new `core/agent_loop.py`:

```
for step in range(MAX_TOOL_STEPS=6):
    res = llm.chat_with_tools(history, active_tools)
    if res is final text: break
    emit tool_use → execute_tool → emit tool_result
    append tool exchange to history (existing Claude/Ollama formats)
stream final answer
emit receipt event summarizing all executed tools
```

- Guardrails: step cap, per-tool timeout (30s default), total turn budget,
  identical-call-twice breaker. On tool failure, feed the error back to the
  model (it may recover) rather than aborting the turn.
- **Auto web search**: `web_search` is always in `active_tools` (the system
  prompt already tells the model to use it for current events). The SCAN WEB
  toggle becomes an override: `on` = nudge (“prefer searching”), `off` =
  remove the tool. Default = model decides.
- **Receipts**: each executed tool contributes `{tool, summary, ok}`; the
  frontend renders a compact ✓-list card under the assistant message and it is
  persisted in the message `meta`.
- Voice path uses the same loop; TTS speaks only the final answer.

Verify: “add milk to the shopping list and remind me at 5pm” executes two
tools in one turn with a two-line receipt; “what happened in the news today”
triggers a search without any toggle; a deliberately failing tool produces a
graceful spoken/text explanation, not an error event.

### Phase 3 — Unified frontend

- `ChatInterface.jsx` becomes the single conversation surface, now WS-first
  (attach/new_session), rendering: streamed text, tool receipts, research
  progress, doc chips. Mic button records → sends audio over the session WS
  (reuse `useAudioRecorder` + existing binary path); replies play via
  `AudioPlayer` when audio events arrive.
- Voice-output toggle (auto/always/never) in the input bar; persisted via
  `user_preferences`.
- History drawer reads `/api/chat/sessions`; selecting one attaches to it
  (continues it — not read-only like today).
- `ConversationPage.jsx` (avatar stage) is rebuilt as a thin view over the same
  session hook: orb + status + transcript overlay, no own model picker, no own
  history. Extract shared logic into `frontend/src/hooks/useConversation.js`
  (session state machine, WS wiring, audio in/out) so chat page, avatar page,
  and the future phone app consume the same hook.
- Wire session-end distillation: on `new_session` / tab close (sendBeacon),
  call `POST /api/conversation/extract-facts` — or better, do it server-side in
  Phase 4 and skip the client’s involvement entirely (preferred).

Verify: type a message, then speak the next one — one thread, spoken reply only
for the spoken turn; open the avatar page mid-conversation and see the same
session live; refresh browser → conversation resumes.

### Phase 4 — Memory distillation + retention (the “learns you” pipeline)

- **Distiller** (`core/distiller.py`, scheduled via the existing
  `core/routines_scheduler.py` pattern): finds sessions with
  `updated_at < now - IDLE_CLOSE (default 30 min)` and `distilled_at IS NULL`,
  runs the extraction logic that already lives in
  `conversation.py::extract_facts_http` (move it into the module; the route
  becomes a thin manual trigger). Writes facts/preferences/summary, appends the
  summary to the Chronos daily note (existing `VaultProvider.append_to_daily`),
  marks `distilled_at`, generates a session `title` (one-line LLM call).
- **Retention sweep** (same scheduler): delete `chat_messages` older than
  `CHAT_RETENTION_DAYS` (setting, default 90) for distilled sessions; keep the
  session row + title + summary linkage. Profile data is permanent.
- Surface it: settings section showing retention setting; MemoryHub already
  displays facts/preferences — confirm distilled output appears there.
- Per-user isolation is already enforced by `user_id` columns everywhere; keep
  it absolute (household members must never see each other’s sessions/facts).

Verify: hold a conversation mentioning a new fact (“my daughter’s name is X”),
wait past the idle window (or force-run the distiller), see the fact in
MemoryHub and the summary in the Chronos daily note; next new session, River
knows it.

### Phase 5 — Deep research, depth-aware

- Add an `on_progress` callback threading through `core/deep_research.py`
  stages (decompose/gather/fetch/synthesize — the pipeline is already staged
  and injectable, this is plumbing).
- **Trigger**: intent — explicit phrasing (“research … in depth”, “deep dive”)
  routes to research; the RESEARCH toggle remains as a manual override.
  Implement as an intent-router entry + a `deep_research` tool in the agent
  loop so the model can also elect it.
- **Depth split**: estimate cost from sub-query count × source count.
  - *Quick* (≤ ~1 min): run inside the turn; progress events stream as
    `{"type":"research_progress","stage","detail"}`; report lands inline and
    saves to Docs (existing behavior).
  - *Big*: enqueue a background job (asyncio task registry keyed by session;
    survive-disconnect, not survive-restart is acceptable for v1). River
    replies “on it — I’ll drop the report here when it’s done”, the user keeps
    chatting; on completion the report is appended to the session as an
    assistant message and pushed over WS + existing push-notification plumbing
    (`push_subscriptions`/`fcm_tokens`).
- Frontend: progress renders as a live stage checklist card; finished reports
  render markdown with a “saved to Docs” chip.

Verify: quick topic shows staged progress then an inline report; a big job lets
you keep chatting and later delivers the report into the same conversation
(and a push notification if subscribed).

---

## 5. Explicitly out of scope (leave hooks, do not build)

- Voice ID / Face ID speaker identification (Resemblyzer subsystem exists at
  `providers/voice_id/`; the loop keeps a clean seam where transcript + audio
  are both in hand — do not remove it).
- The avatar itself (`frontend/public/avatar.glb`, Cortana presence) — Phase 3
  only ensures the avatar page is a thin view ready to receive it.
- Confirmation gates on tool actions (owner chose full-auto; revisit when
  commerce/smart-home destructive actions grow).
- Cross-restart persistence of background research jobs.

## 6. Working agreements for the implementing agent

- Develop on `claude/chat-voice-integration-bzdo2v`; commit per phase with
  descriptive messages; `git push -u origin claude/chat-voice-integration-bzdo2v`.
- Follow existing conventions: route modules own their auth via
  `_require_user`; store methods on the SQLite store class with
  `CREATE TABLE IF NOT EXISTS` migrations; feature flags in
  `config/settings.py`; frontend uses the `rs-*` class system and existing
  chrome slots (`setAction`).
- Do not break the existing WS protocol — every current event type keeps its
  shape; additions only. Vexa/Kova/Vector clients will be built against it.
- Tests live in `tests/`; pytest is configured. At minimum: session store CRUD,
  agent-loop step cap + failure feedback, distiller idempotency, retention
  sweep boundaries, SSE/WS event shape snapshots.
- Production is live at riversongai.com with nightly auto-deploy — keep `main`
  deployable; this branch merges only when a phase is verified.
