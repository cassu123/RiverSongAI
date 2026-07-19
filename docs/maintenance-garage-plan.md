# River Song — Maintenance / Garage: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the chat plan).

Companion document: `docs/chat-voice-unification-plan.md`. That plan builds the
unified conversation service, multi-step agent loop, and tool receipts. This
plan layers the garage onto it. Where a phase here depends on a phase there,
it says so explicitly — build order matters.

---

## 1. Mission

The garage ("The Hangar" / Maintenance Pulse) becomes both the household's
**vehicle record-keeper** (history, costs, receipts, reminders) and a
**hands-on shop companion** (what's due, guided jobs with photos/videos,
specs and torque values on demand, verified parts, manual Q&A) — reachable
from a focused in-garage chat helper *and* from the main River conversation.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Purpose | Both: record keeper AND aid/helper/guide. Photos or videos guide the work; the manual is loaded and can be asked questions. |
| Odometer & reminders | River asks for current mileage, estimates between readings from driving rate, and proactively surfaces due/overdue work — morning briefing, push notification, and a nudge in chat. |
| Chat integration | Two surfaces: (a) a focused in-garage chat helper — embedded, vehicle-scoped, never navigates away; (b) full garage powers from the main chat/voice brain ("what's the drain plug torque on the F-150?", "I did the oil on Cheryl's car at 84,200"). |
| Guided jobs & media | Media comes from multiple sources — user uploads, manual diagrams, web/video finds. River keeps a **compressed archived copy** server-side so guidance found once stays available forever. |
| Parts | Web-verified OEM + alternatives (no local-model guessing), persisted to the vehicle, with prices, and can be added to the shopping list. |
| Household | Use the existing Family Groups system. `resolve_module_owner(user_id, "maintenance")` already maps all members to `family:<group_id>` when the module is shared. The people roster / assignments = who drives what, and route reminders. |
| Future hooks | (1) OBD-II / telematics: live odometer, fault codes, health data eventually replaces manual entry. (2) Non-road equipment: mowers (Vector), generators, boats — hour-based intervals. Design for both, build neither now. |

---

## 2. Current state (audited 2026-07-19)

### What exists and works
- `vehicles/models.py` — SQLAlchemy on its own DB (`data/vehicles.db`,
  `VEHICLES_DB_URL`): `Vehicle` (auto/moto/truck/atv), unified
  `VehicleCheckPoint` (interval_miles/interval_days/due_at_miles, OEM spec,
  fluid volume, min/max, torque ft_lb/nm, last-service tracking),
  `VehiclePart` (OEM + JSON alternatives per checkpoint), `MaintenancePerson`
  + `VehicleAssignment` (roster & who-drives-what), `ServiceLog` +
  `ServiceCheckResult` (pass/warn/fail, actual measurements, cost, receipt
  path). Legacy fluid/torque spec tables retained for migration only.
- `api/routes/vehicles.py` (1,355 lines) — full CRUD; **maintenance timeline**
  (`GET /{id}/maintenance-timeline`: projects due miles/dates, overdue flags,
  mile-score sort, returns next_up + upcoming); **manual pipeline**
  (`POST /{id}/manual/preview` dry-run + `POST /{id}/manual`: pypdf text →
  regex parser → Ollama fallback → `apply_manual_intervals` creates
  checkpoints → RAG ingest with `{vehicle_id, type: vehicle_manual}`
  metadata); parts CRUD; service logs + `POST /logs/{id}/receipt`; family
  sharing via `resolve_module_owner(user_id, "maintenance")`.
- `frontend/src/pages/VehiclePage.jsx` ("The Hangar") — vehicle cards, ASK
  RIVER drawer (embedded ChatInterface), TECH MANUAL upload button.
- `frontend/src/components/MaintenancePulse.jsx` (1,684 lines) — vehicle
  form, checkpoint editor, manual upload with preview, people/assignments
  settings, service-log flow (checklist + actual values + auto pass/warn/fail
  + receipt upload), PredictiveTimeline, VehicleRAG ask box.
- `core/tools.py` — `log_vehicle_maintenance` tool with fuzzy checkpoint
  matching (difflib ≥0.6) that updates the checkpoint and creates a log.

### Confirmed bugs / dead code
1. **`POST /{id}/maintenance-ai` is dead on arrival**: imports
   `get_vehicle_tools` from `core.tools` — that function does not exist
   anywhere in the codebase → ImportError → 500 on every call. The
   MaintenancePulse "ask" feature (`VehicleRAG.handleAsk`) has never worked.
   Beyond the import: it reads RAG chunks as `c['content']` (store returns
   `text`/`metadata`), treats tool dicts as objects (`t.name`), calls Ollama
   directly (ignores the user's model settings/cloud providers), and does one
   tool round max.
2. **`log_vehicle_maintenance` is unusable from main chat/voice**: it requires
   `vehicle_id` in the execution context; the main chat path passes only
   `{user_id}` → always returns "No vehicle_id in context." No vehicle
   disambiguation exists anywhere.
3. **Two rival manual-upload paths**: the Hangar's TECH MANUAL button posts to
   generic `/api/rag/ingest?doc_id=vehicle_{id}` (no `vehicle_id` metadata, no
   interval parsing); MaintenancePulse posts to `/api/vehicles/{id}/manual`
   (parses intervals + tags metadata). Manuals uploaded from the Hangar are
   invisible to vehicle-scoped retrieval.
4. **ASK RIVER drawer** inherits the RAG JSON-vs-SSE bug (chat plan Phase 0
   item 1) — answers are dropped.
5. **No proactivity**: the timeline computes overdue beautifully; nothing ever
   notifies anyone. No integration with push (`push_subscriptions` /
   `fcm_tokens`), the morning briefing, or chat.
6. **No current odometer**: mileage is inferred from the latest service log
   only; predictions go stale between services. `current_odometer` is a query
   param the UI must supply each time.
7. **Parts lookup** (`POST /{id}/parts/lookup`): local Ollama guesses part
   numbers — hallucination-prone, never web-verified, and the AI result is
   returned without being persisted.

---

## 3. Build phases

Work in order. Each phase is independently shippable and ends with the listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase G0 — Repair what's advertised (no chat-plan dependency)

1. **Rewrite `maintenance-ai`** as a thin wrapper over `ConversationLoop`
   (text mode, per chat plan Phase 0 item 2) instead of raw Ollama:
   - Build the context block (vehicle, effective odometer, timeline next_up,
     parts on file) exactly as today.
   - RAG-retrieve with `where={"vehicle_id": ...}` and the store's real keys.
   - Provide the vehicle toolset (see G2) via the normal tool path so
     `log_vehicle_maintenance` works with `vehicle_id` pinned in context.
   - Delete the phantom `get_vehicle_tools` import.
2. **Unify manual ingestion**: the Hangar's TECH MANUAL button calls
   `/api/vehicles/{id}/manual` (with a preview step reusing the existing
   endpoint) and the generic `/api/rag/ingest` path for vehicles is removed
   from `VehiclePage.jsx`. One pipeline: parse intervals + tagged RAG ingest.
3. **Persist AI part lookups**: whatever survives Phase G4 verification gets
   written to `VehiclePart` with `source="ai_lookup"` instead of being
   returned and forgotten. (Interim fix; G4 replaces the lookup itself.)
4. Fix the ASK RIVER drawer transport once chat plan Phase 0 item 1 lands
   (shared fix — verify it here against a vehicle manual question).

Verify: ask a question in MaintenancePulse's ask box and get an answer that
cites the manual; upload a manual from the Hangar card and see checkpoints
created; "I just changed the oil at 84,200" in the vehicle-scoped ask box
creates a service log.

### Phase G1 — Usage readings + proactive reminders

**Schema** (new table in `vehicles/models.py` + `_migrate`; this is the
OBD-II and small-engine hook — do not skip the generalization):

```python
class UsageReading(Base):
    __tablename__ = "vehicle_usage_readings"
    id          # uuid pk
    vehicle_id  # fk vehicles.id
    value       # Float — odometer miles OR engine hours
    unit        # Enum: "miles" | "hours"   (hours unused until equipment lands)
    source      # Enum: "manual" | "service_log" | "estimated" | "telemetry"
                #   telemetry unused until OBD-II lands — the hook is the enum
    recorded_at # DateTime
```

- Every service log with an odometer auto-inserts a `source="service_log"`
  reading. Backfill from existing logs in the migration.
- `GET /api/vehicles/{id}/usage` + `POST /api/vehicles/{id}/usage` (quick
  odometer update — surfaced as a one-field affordance on the vehicle card
  and in MaintenancePulse header).
- **Estimator**: daily rate = linear fit over the last N readings (fallback
  27.4 mi/day, the constant already used in the timeline scoring). Effective
  odometer = last reading + rate × days since. Timeline uses the estimate when
  no explicit `current_odometer` is passed; responses mark
  `odometer_estimated: true` and include `last_reading_at`.
- **Reminder sweep** (register with the existing scheduler used by
  `core/routines_scheduler.py`, daily):
  - For each vehicle of each garage owner (family-group aware): compute the
    timeline; for items due within `MAINT_REMIND_MILES` (default 500) /
    `MAINT_REMIND_DAYS` (default 14) or overdue → notify **assigned drivers**
    (fall back to garage owner when unassigned) via the existing push plumbing
    (`push_subscriptions`/`fcm_tokens`), deduped per item per
    `MAINT_REMIND_COOLDOWN_DAYS` (default 7).
  - Staleness nudge: when the freshest reading is older than
    `MAINT_ODO_STALE_DAYS` (default 30), the sweep queues a mileage ask.
- **Briefing + chat surfacing**: expose `get_due_maintenance(user_id)` in
  `core/tools.py`-adjacent service code; the startup briefing
  (`run_startup_briefing`) and morning brief include due items; the chat brain
  can nudge ("the truck's oil change is ~200 miles out") and ask for current
  mileage when stale — via the agent loop once chat Phase 2 exists, via
  briefing text before that.
- Settings: thresholds above in `config/settings.py`; per-user opt-out flag.

Verify: enter an odometer reading, see the timeline shift; force the sweep →
push notification arrives for an overdue item and repeats only after the
cooldown; briefing mentions the due item; timeline marks estimates as such.

### Phase G2 — The garage joins the brain
*(Depends on chat plan Phase 1 [conversation service] + Phase 2 [agent loop].)*

New tools in `core/tools.py`, all family-group aware
(`resolve_module_owner`) and receipt-emitting:

- `list_vehicles()` — id, nickname, year/make/model, effective odometer.
- `resolve_vehicle(query)` — shared helper (not a tool): match by nickname /
  make / model / year, fuzzy; single hit → id; multiple → the agent asks the
  user which one; the in-garage helper skips this because `vehicle_id` is
  pinned.
- `get_vehicle_status(vehicle)` — timeline next_up/upcoming/overdue + odometer.
- `get_vehicle_spec(vehicle, item)` — checkpoint specs: torque, fluid, volume,
  min/max ("drain plug torque on the F-150" → "19 ft-lb").
- `query_vehicle_manual(vehicle, question)` — RAG over
  `where={"vehicle_id": ...}`.
- `log_vehicle_maintenance(vehicle, service_type, mileage, date?, cost?,
  notes?)` — upgraded existing tool: resolves the vehicle itself when no
  `vehicle_id` is in context; logging also inserts a usage reading.
- `record_odometer(vehicle, value)` — for "the truck's at 84,600."

**In-garage helper**: replace the ASK RIVER drawer's embedded
`ChatInterface` with the unified conversation surface (chat plan Phase 3's
`useConversation` hook) opened with a **pinned vehicle context** — a session
whose system context includes the vehicle snapshot and whose tool context
carries `vehicle_id`. It stays in the drawer (never navigates), and its
sessions are tagged in `chat_sessions` meta (`{"scope": "vehicle:<id>"}`) so
garage chatter doesn't clutter main history.

Verify: from main chat, "what's the drain plug torque on the F-150?" answers
with the spec; "I did the oil on Cheryl's car at 84,200" resolves the right
vehicle (asks only if genuinely ambiguous), logs it, updates the checkpoint,
inserts a reading, and shows a receipt; the drawer helper does the same with
zero disambiguation questions.

### Phase G3 — Guided jobs + media library

**Schema**:

```python
class VehicleMedia(Base):
    __tablename__ = "vehicle_media"
    id             # uuid pk
    vehicle_id     # fk
    checkpoint_id  # fk nullable — media attached to a job type
    log_id         # fk nullable — media attached to a specific service event
    kind           # Enum: "photo" | "video" | "diagram" | "link_archive"
    title          # str
    source         # Enum: "user_upload" | "manual_extract" | "web_find"
    source_url     # nullable — original URL for web finds
    file_path      # archived compressed copy under data/vehicle_media/
    thumb_path     # nullable
    created_at
```

- **Compression on ingest** (owner requirement: keep a compressed copy for
  reuse): photos → max 1920px JPEG/WebP via Pillow (already a dependency);
  video → 720p H.264 via `ffmpeg` when present on the host, stored as-is with
  a logged warning when not. Thumbnails for both. Serve through an authed
  endpoint (`GET /api/vehicles/media/{id}`), never a static mount.
- Routes: upload (multipart, attach to checkpoint or log), list per
  vehicle/checkpoint, delete. Receipt uploads stay as they are.
- **Guided job mode** (frontend, in MaintenancePulse): starting a service from
  a checkpoint opens a walkthrough panel — checkpoint description, specs +
  torque inline, attached media gallery, relevant manual excerpt (RAG,
  vehicle-scoped), and the existing check-result entry; completing it flows
  into the existing service-log save. Voice narration comes free once the
  in-garage helper (G2) sits beside it — "read me the next step."
- **Web finds**: in the walkthrough, "find a guide" asks the agent
  (web_search tool) for a walkthrough/video for this vehicle + job; chosen
  results are archived: page → readable text snapshot, direct images →
  compressed copy, video pages → store URL + metadata + thumbnail
  (`kind="link_archive"`; do not rip streaming-site videos — archive the
  reference, compress only directly-hosted files).

Verify: attach a phone photo to the ATV brake checkpoint (compressed copy +
thumbnail on disk); start the job — walkthrough shows spec, photo, and manual
excerpt; find-a-guide archives a chosen result and it renders offline later;
finish → service log saved with the media linked.

### Phase G4 — Parts, verified
*(Depends on chat plan Phase 2 for the agent/web-search loop.)*

- Replace the Ollama-guess in `parts/lookup` with an agent web-verification
  pipeline: search manufacturer/retailer sources for the vehicle
  (year/make/model/trim) + checkpoint; extract OEM number, verified
  alternatives (brand, part number), and observed prices; **require source
  URLs** — a part number without a citation is discarded; low-confidence →
  say so rather than invent.
- Persist to `VehiclePart` (`source="ai_lookup"`, alternatives JSON gains
  `{price, currency, url, seen_at}`); re-lookup refreshes prices.
- `find_parts(vehicle, job)` joins the toolset (G2) and the walkthrough (G3):
  "order pads for the ATV job" → verified parts → existing
  `add_shopping_list_item` tool, with a receipt.
- UI: parts card per checkpoint shows OEM, alternatives, prices, source
  links, and an "add to shopping list" button.

Verify: lookup on a real vehicle returns cited part numbers that match the
linked pages; result persists and reappears without a new lookup; add-to-list
lands on the household shopping list.

### Phase G5 — Equipment hooks (small, closes the future-proofing)

- Add `VehicleType` values: `mower`, `generator`, `marine`, `equipment`.
- `VehicleCheckPoint.interval_hours` (nullable Integer) + timeline math for
  hour-based projection using `UsageReading(unit="hours")` (table already
  supports it from G1). Hide hour fields in the UI unless the vehicle type is
  non-road.
- Document (code comment + this file) the telemetry seam: a future OBD-II or
  Vector integration only inserts `UsageReading(source="telemetry")` rows and
  optionally fault-code events — no schema change needed.

Verify: create a "mower" with a 50-hour oil interval, log hours, timeline
projects in hours; road vehicles unaffected.

---

## 4. Explicitly out of scope (leave hooks, do not build)

- OBD-II / telematics ingestion itself (seam = `UsageReading.source="telemetry"`).
- Vector mower auto-integration into the garage (it has its own subsystem;
  G5 only makes the schema ready).
- VIN decode / vehicle-data APIs.
- Ripping/downloading videos from streaming platforms — archive references
  only; compress only directly-hosted media and user uploads.
- Scanned/image-only manual OCR (current pipeline requires extractable text;
  keep the existing clear error).

## 5. Working agreements for the implementing agent

- Same branch and conventions as the chat plan (`docs/chat-voice-unification-plan.md`
  §6): commit per phase, push with `-u origin claude/chat-voice-integration-bzdo2v`,
  follow existing route/auth/store patterns, flags in `config/settings.py`.
- The vehicles domain keeps its own DB (`vehicles.db`) and SQLAlchemy models;
  new garage tables go there, not in the main SQLite store. Chat-session
  tagging (G2) lives in the main store with the other chat tables.
- Family-group awareness is non-negotiable: every new route and tool resolves
  ownership through `resolve_module_owner(user_id, "maintenance")` exactly
  like the existing routes.
- Respect the migration pattern in `api/routes/vehicles.py::_migrate` —
  additive columns/tables only, never drop data.
- Tests: timeline math with estimated odometer (fresh/stale/hours), reminder
  sweep dedupe + cooldown, vehicle resolver (unique / ambiguous / miss),
  media compression paths, parts-lookup citation requirement, migration
  backfill idempotency.
- Production auto-deploys nightly from `main` — merge only verified phases.
