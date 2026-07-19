# River Song — Routines & Briefings (The Proactive Spine): Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the other plans).

Companion documents — this plan is the spine they all lean on:
- `docs/chat-voice-unification-plan.md` — conversation service (Phase 1) is
  where proactive items become permanent messages; agent loop (Phase 2)
  powers acting routines.
- `docs/maintenance-garage-plan.md` (G1), `docs/home-inventory-plan.md` (I5),
  `docs/culinary-kitchen-plan.md` (K4) — each says "reuse/generalize the
  sweep machinery." **This plan defines that machinery.** Their sweeps
  register here instead of building their own loops.

---

## 1. Mission

River speaks first — on schedule (morning brief, routines), on condition
(maintenance due, stock out, weather), and with discipline (per-person quiet
rules, severity gates). Everything River initiates lands in the conversation
as a permanent message, is pushed to the phone when appropriate, and — as the
device fleet (Vexa/Kova/Vector, phone app) arrives — gets *spoken in the room
you're in*. One delivery pipeline, one sweep scheduler, one ledger.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Delivery | Presence-aware: in-app when the app exists; spoken "in the room we are in based off the devices" when River can tell the room. Conversation = the permanent record; push when away. Build the room/presence seam now, presence detection later. |
| Morning brief | Configurable sections AND an auto mode — River uses calendar, date, and context to decide what to brief. Per-user schedule. |
| Routines | Created **and edited** by voice/chat (plus the form UI), and they run through the full agent loop — routines can act (tools + receipts), not just talk. |
| Interruption rules | Per-person quiet hours in each member's own timezone + severity gates. Critical (tornado, security) always breaks through. Stricter rules possible for kids' devices. |

---

## 2. Current state (audited 2026-07-19)

Five proactive systems grew independently:

1. **Routines** — `core/routines_scheduler.py` (minute-poll loop),
   `api/routes/routines.py` (CRUD + manual run), store methods in
   `providers/memory/store/family.py`, `RoutinesPage.jsx`, and a
   `create_routine` chat tool. Types: "simple" (LLM prompt via a fresh
   `ConversationLoop`) and "advanced" (n8n/webhook POST).
2. **Initiative Engine** — `core/initiative.py`. Well-designed gates
   (enabled, quiet hours, per-kind cooldowns, dedupe key, severity), delivery
   to live conversation WebSockets + push (`providers/push/notifier`:
   Web Push, FCM, ntfy/Apprise), observable ring buffer. Fed today by exactly
   one sense: the NWS weather watcher loop (15-min poll).
3. **Startup briefing** — `ConversationLoop.run_startup_briefing`: greets with
   calendar + pulse snapshots when a voice WebSocket connects.
4. **Pulse daemon** — separate process fetching news/markets/flights
   snapshots on a tick into `pulse_snapshots`.
5. **BriefingPage** — pull dashboard: weather, calendar, feeds, Chronos daily
   note. Nothing arrives on its own.

### Confirmed bugs / gaps
1. **Routines ignore `days`.** `_check_routines` matches trigger+time only —
   a "Mondays" routine fires every day.
2. **Routine output evaporates.** The scheduler broadcasts to live voice
   sockets (usually zero) and pushes "New briefing ready" — but the generated
   text is persisted nowhere. Tapping the notification leads to nothing.
3. **Quiet hours use the server clock** (`datetime.now().hour`), are global
   (not per-user), and cooldowns live in-memory — every restart forgets what
   it already said.
4. **No unified pipeline**: routines bypass the Initiative gates entirely;
   the startup briefing bypasses both; the four companion plans would have
   added four more bypasses.
5. Routines can't act (prompt or webhook only), can't be edited by voice,
   and the scheduler comment admits it was wired speculatively ("Mocking
   global list for now" — the store method does exist and works).
6. Timezone for scheduling is read from `llm_settings` (works, but document
   it — it's the per-user tz source of truth).

---

## 3. Target architecture

```
 senses & schedules                   one pipeline                    surfaces
 ──────────────────                ────────────────                 ──────────
 SweepRunner (in-app cron)   ┐                                   ┌ conversation
   garage due-items (G1)     │     DeliveryRouter                │   (permanent
   inventory warranty (I5)   ├──►  ProactiveItem ──► gates ──►  ─┤    message)
   kitchen autopilot (K4)    │     (kind, severity,   per-user   │ push (phone)
   weather watcher           │      user, content,    quiet tz,  │ live WS toast
   registry health, …        │      actions)          severity,  │ TTS on device
 Routines v2 (user-authored) ┘                        cooldown   └  (presence
 external (n8n, device hooks)          persisted in proactive_log     seam)
```

- **ProactiveItem** is the only way River initiates anything. The Initiative
  Engine's gates evolve into the DeliveryRouter; nothing bypasses it.
- **The conversation is the ledger**: every delivered item is written as a
  River-initiated message via the conversation service (chat plan Phase 1),
  so it's readable later, replyable, and part of history.
- **SweepRunner** replaces ad-hoc `while True` loops for in-app periodic
  checks. Separate-process daemons (pulse, scribe, sifter…) stay as they are.

---

## 4. Build phases

Work in order; each phase independently shippable with its listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase R0 — Surgical fixes (no dependencies)

1. **Fix the `days` bug**: scheduler honors `r["days"]` (empty = every day;
   else match `now_local.strftime("%a")`-style tokens — match whatever format
   the UI writes, and normalize it in one helper).
2. **Persist routine output** (interim, pre-ledger): add `last_output` TEXT to
   the routines table (additive migration); scheduler and manual-run both
   write it; `RoutinesPage` shows last run time + output; the push
   notification deep-links to the routine.
3. **Per-user quiet hours, correct clock** (interim): move the quiet-hour
   check to the target user's timezone (from `llm_settings`), keeping the
   global settings values as defaults.

Verify: a Mon/Wed routine skips Tuesday; run output is visible in the UI
after the fact; a 23:00 event for a UTC+2 user is correctly held as quiet.

### Phase R1 — DeliveryRouter + persistent gates

**Schema** (main store, additive):

```sql
CREATE TABLE IF NOT EXISTS proactive_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- weather_alert | routine | brief | maint_due | …
    dedupe_key   TEXT NOT NULL,
    severity     TEXT NOT NULL,          -- info | warning | critical
    title        TEXT, body TEXT,
    delivered    INTEGER NOT NULL,       -- bool
    reason       TEXT,                   -- ok | quiet_hours | cooldown | disabled
    channels     TEXT DEFAULT '[]',      -- JSON: ["conversation","push","ws","tts"]
    created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proactive_prefs (
    user_id      TEXT PRIMARY KEY,
    quiet_start  INTEGER, quiet_end INTEGER,   -- hours, user-local; NULL = defaults
    min_push_severity TEXT DEFAULT 'info',
    kinds_muted  TEXT DEFAULT '[]'             -- JSON list of muted kinds
);
```

- `core/proactive.py`: `DeliveryRouter.submit(ProactiveItem)` — evolves
  `InitiativeEngine` (keep its dataclass/severity/dedupe shape; the engine
  becomes a thin alias so existing callers keep working). Gates read
  `proactive_prefs` (per-user tz via `llm_settings`) and check cooldowns
  against `proactive_log` instead of an in-memory dict. Critical severity
  bypasses quiet hours and mutes, always.
- **Channels**: conversation write (see below), push (`notify_user`,
  respecting `min_push_severity`), live WS toast (existing payload shape),
  TTS (Phase R4 seam — no-op for now).
- **Conversation ledger**: when chat plan Phase 1 exists, delivered items are
  appended as River-initiated messages (role assistant, meta
  `{"proactive": kind}`) to the user's main session and wake live clients.
  Until then, `proactive_log` + R0's `last_output` are the record — build the
  router now, snap in the ledger write when the dependency lands.
- Settings UI: a Notifications section — quiet hours, per-kind mutes,
  min push severity. Parent-managed stricter values for child accounts
  (reuse the existing parent/child tables).

Verify: same alert twice → second logged `cooldown` and not pushed; critical
at 3am pushes anyway; a muted kind lands in the log/ledger but never pushes;
restart the backend → cooldowns still respected.

### Phase R2 — SweepRunner (the shared cron the other plans register into)

- `core/sweeps.py`: `register_sweep(name, interval, fn)` +
  one runner task started from `main.py` lifespan. Staggered starts, per-sweep
  last-run/last-error persisted (small `sweeps_state` table), jittered
  scheduling, a sweep never kills the runner, `GET /api/admin/sweeps` status
  route (admin-only) for observability.
- Migrate the weather watcher loop into a registered sweep (15 min).
- Migrate the routines scheduler tick into a sweep (1 min).
- **Registration points for the companion plans** (implement the seams, the
  sweeps themselves land with their own plans): garage due-maintenance +
  odometer staleness (G1), inventory warranty/health/audit (I5), kitchen
  weekly draft + daily proposal + stock warnings (K4), chat session distiller
  (chat plan Phase 4). All of them emit ProactiveItems through the
  DeliveryRouter — none of them push or write conversations directly.

Verify: sweeps status route shows registered sweeps with last-run times; kill
one sweep with a forced exception and the others keep running; weather alerts
still arrive.

### Phase R3 — Routines v2 (say it, and it can act)
*(Depends on chat plan Phase 2 — agent loop.)*

- **Agent execution**: "simple" routines run through the agent loop with the
  full toolset and produce receipts; output + receipts delivered via
  DeliveryRouter (kind=`routine`, severity from routine config, default
  info). Webhook ("advanced") type unchanged.
- **Natural-language management**: upgrade/add tools — `create_routine`
  (exists; extend with days/severity), `list_routines`, `update_routine`,
  `delete_routine`, `run_routine_now`. "River, every Sunday at 5 check the
  vehicles and put parts on the list" → created; "move my Sunday check to
  6pm" → edited; both confirmed with a receipt. Voice path identical (same
  tools).
- RoutinesPage: add days display (post-R0 fix), severity, last receipts, and
  a run-history view fed by `proactive_log`.

Verify: create by voice, edit by voice, and the Sunday routine actually
executes tools (list gains parts) and lands a receipted message; the form UI
round-trips the same routine.

### Phase R4 — The morning brief (composed, scheduled, caught-up)

- **Composer** (`core/brief.py`): section registry — weather, calendar,
  due-today (aggregates garage/inventory/kitchen "due" queries when those
  phases exist; each section is optional and fails soft), dinner plan, news/
  markets from pulse snapshots, overnight proactive items the user missed.
  Two modes per user: **manual** (picked sections) and **auto** (River
  selects and orders sections from context: calendar density, day of week,
  what's due, weekend vs weekday). Output: short conversational markdown —
  written to the conversation, TTS-able.
- **Schedule**: per-user brief time (default 07:00 local) via a registered
  sweep; delivered through the router (kind=`brief`, respects quiet prefs —
  a 07:00 brief inside quiet hours waits for quiet-end).
- **Catch-up**: if undelivered-by-presence (no interaction since generation),
  the first conversation/voice contact of the day leads with the brief
  (replaces the current startup briefing — `run_startup_briefing` becomes
  "deliver pending brief if any", keeping its TTS behavior).
- BriefingPage: shows today's generated brief at the top (from the ledger)
  above the existing live dashboard; settings section for time + sections +
  auto mode.

Verify: brief arrives at the set time as a conversation message + push; with
the app closed all morning, the first "hey River" of the day opens with the
brief; auto mode produces different sections on a busy-calendar day vs an
empty Saturday.

### Phase R5 — Presence seam (rooms + spoken delivery)

Build the seam, not the sensing:

- **Device registry** (additive table): `devices(id, user_id/household,
  name, kind [browser|phone|vexa|kova|vector], room, capabilities JSON
  [tts, push, display], last_seen)`. Live WS connections register/heartbeat
  into it (browser today; Vexa/Kova when they arrive).
- **Router TTS channel**: for items with `speak=true` (briefs, critical
  alerts), the router picks a target device: the room the user is in **when
  presence is known** (future), else the device with the freshest activity,
  else skip TTS. Uses the warm TTS provider pool (chat plan Phase 1).
- Document the presence contract in code: a future presence source (voice ID
  hit on a room device, phone BLE, motion) just updates `user_presence(user,
  room, confidence, ts)` — the router already consumes it.

Verify: with a live voice session open, a critical alert is spoken there;
with none, it pushes only; the devices table shows the browser session with
its room set manually.

---

## 5. Explicitly out of scope (leave hooks, do not build)

- Actual room-presence detection (voice ID, BLE, motion) — seam only (R5).
- Vexa/Kova/Vector device firmware/clients — they consume the device
  registry + WS protocol when they land.
- Replacing the separate-process daemons (pulse/scribe/sifter/warden/
  mechanic) — SweepRunner is for in-app periodic work only.
- Calendar-aware "River judges" interruption timing (owner chose explicit
  per-person rules; revisit later).
- n8n workflow authoring UI (webhook routines remain as-is).

## 6. Working agreements for the implementing agent

- Same branch and conventions as the other plans (chat plan §6). Commit per
  phase; push `-u origin claude/chat-voice-integration-bzdo2v`.
- **Nothing initiates contact except through the DeliveryRouter** once R1
  lands — grep for direct `notify_user`/`notify_admins` calls outside the
  router and migrate them (routines scheduler, initiative engine, any
  stragglers).
- The companion plans' sweeps (G1/I5/K4/distiller) must register via
  `register_sweep` and emit ProactiveItems — if those phases were built
  before this plan, refactor them onto the spine as part of R2.
- Additive-only migrations in the main store, matching existing patterns;
  feature flags + defaults in `config/settings.py`.
- Tests: days matching, quiet-hours across timezones + critical override,
  persisted cooldown across restart simulation, sweep isolation (one failing
  sweep doesn't stop others), brief catch-up state machine, routine NL
  create/edit round-trip.
- Production auto-deploys nightly from `main` — merge only verified phases.
