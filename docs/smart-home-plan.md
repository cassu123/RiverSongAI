# River Song — Smart Home / Home Node: Full Build Plan

Handoff document for the implementing agent (Kimi / Antigravity). Self-contained:
read this top to bottom and you can execute without prior session context.

Branch: `claude/chat-voice-integration-bzdo2v` (same branch as the other plans).

Companion documents:
- `docs/chat-voice-unification-plan.md` — Phase 2 (agent loop) powers voice
  authoring and device tools here (H4).
- `docs/routines-briefings-plan.md` — R1 DeliveryRouter carries every home
  alert; R3 routines gain device-event triggers here; R5's device registry
  is where speaker announcement targets live.
- Read `docs/AGENT_KICKOFF_PROMPT.md` first if you haven't.

---

## 1. Mission

One Home location — "like Google Home but a lot better." Rooms-first: open to
your house as rooms, each with its devices, climate, and (later) occupancy;
a house-wide status strip on top. Every device class is first-class: lights/
climate, security that alerts, media/speakers, and the sensor nervous system.
**River is the automation brain** — Home Assistant becomes the device layer
only; triggers flow into River's routine/initiative machinery and are
authored by voice. Ships with sensible safety alerts on by default.

Owner-confirmed product decisions (structured interview, 2026-07-19):

| Topic | Decision |
|---|---|
| Device scope | All of it: core (lights/plugs/climate/fans), security (locks/garage/door sensors), media & speakers (playback + announcements), sensors & environment (leak/smoke/temp/motion/energy). |
| Layout | **Rooms first, Google Home style**: the house as rooms, tap a room to control everything in it; house-wide status strip (locks, alerts, climate, mower) pinned on top. One page — replaces the scattered HomeNode/Environment split. |
| Automations | **River is the brain.** Device-event triggers feed River's routines/initiative; actions run through the agent loop; authored and edited by voice. HA is the device layer only — its own automation editor is not managed by River (leave any existing HA automations alone). |
| Cameras / presence | **Parked.** No usable cameras today and no spare compute; future cameras will be off-network, directly attached. Warden stays dormant and untouched; document its seam, build nothing on it. Room presence arrives later via the voice-device fleet (routines plan R5), not cameras. |
| Built-in alerts | **Sensible defaults ON**: leak/smoke (critical — breaks quiet hours), door/garage open too long, lock unlocked late at night, freezer temp rising. Each individually mutable. Everything else user-authored. |

---

## 2. Current state (audited 2026-07-19)

### What exists and works
- `api/routes/home.py` — thin HA REST proxy: `/status`, `/devices` (filtered
  to light/switch/fan/cover/lock/climate/scene/script/input_boolean),
  `/action` (turn_on/off/toggle/lock/unlock, brightness, temperature).
- `providers/smart_home/home_assistant.py` (402 lines) — the real HA client
  (`HomeAssistantClient`, `build_ha_client`), used by the route, the intent
  router, and the `control_device` tool.
- `providers/smart_home/device_registry.py` — spoken-name → entity-id
  mapping from a **hand-maintained JSON file** (devices + groups, fuzzy
  word-overlap matching, `config_files/device_registry.example.json`).
- Voice/chat control: `core/intent_router.py::_handle_smart_home` (regex
  action/device/value parsing + confirmation phrasing) and
  `core/tools.py::control_device`.
- `HomeNodePage.jsx` (404 lines) — devices grouped **by domain**, scene
  strip, 30-second polling.
- `EnvironmentPage.jsx` — separate page: room occupancy/activity from
  `core/context_engine.py` (in-memory `RoomState`, fed only by
  `POST /api/context/rooms` — nothing in-repo calls it) + rover telemetry.
- `daemons/warden/` — YOLO person detection over RTSP camera streams;
  detections are **logged and discarded** (connected to nothing).
- `api/routes/willow.py` — token-authed WebSocket for ESP32-S3 voice
  satellite hardware, wired into the ConversationLoop (the Vexa/Kova seam).
- Initiative engine has a `device_alert` kind with a 30-min cooldown —
  **zero senses feed it.**

### Confirmed bugs / gaps
1. **Duplicate HA clients**: `providers/smart_home/homeassistant.py`
   (115 lines, env-var/module-level cache style) is imported by nothing —
   orphan.
2. **`control_device` lies on failure** (`core/tools.py:639`): unreachable
   HA returns "I've noted that you want to…" — nothing is noted anywhere.
3. **No rooms**: HA knows every entity's area; the UI and voice resolution
   ignore areas entirely.
4. **Manual JSON registry**: voice can only control devices someone
   hand-typed into the JSON file, duplicating names HA already has.
5. **Polling only**: no HA WebSocket event subscription — UI is 30s stale,
   and no device state change can trigger anything.
6. **Domain blind spots**: sensors, binary_sensors, media_players, energy —
   invisible to `VISIBLE_DOMAINS` and to River.
7. Context engine room states are in-memory (lost on restart) and unfed.

---

## 3. Build phases

Work in order; each phase independently shippable with its listed
verification. Commit per phase, push to `claude/chat-voice-integration-bzdo2v`.

### Phase H0 — Surgical fixes

1. Delete the orphan `providers/smart_home/homeassistant.py` (verify zero
   imports first).
2. Fix `control_device` failure honesty: on HA error return "Home Assistant
   isn't reachable right now — I couldn't turn {action} the {device}." No
   fictional note-taking.
3. Widen `VISIBLE_DOMAINS` in `api/routes/home.py` to add `media_player`,
   `sensor`, `binary_sensor` (serialize the attributes each needs:
   media title/app/volume; sensor value + unit + device_class). Keep
   `camera` excluded (owner decision).

Verify: no imports break; a dead-HA `control_device` call answers honestly;
`/api/home/devices` returns media players and sensors with sane fields.

### Phase H1 — Entity/area sync (kill the manual registry)

**Schema** (main store, additive):

```sql
CREATE TABLE IF NOT EXISTS ha_entities (
    entity_id    TEXT PRIMARY KEY,
    domain       TEXT NOT NULL,
    name         TEXT NOT NULL,          -- HA friendly_name
    area         TEXT,                   -- HA area name (nullable)
    device_class TEXT,                   -- HA device_class (door, moisture, …)
    aliases      TEXT DEFAULT '[]',      -- user-added spoken aliases (JSON)
    hidden       INTEGER DEFAULT 0,      -- user hid it from UI/voice
    updated_at   TEXT NOT NULL
);
```

- **Sync job**: pull entities + areas from HA (entity/device/area registries
  via the WebSocket API's `config/*_registry/list` commands, or the template
  REST fallback) and upsert. Runs at startup, on demand
  (`POST /api/home/sync`), and periodically via the SweepRunner (R2) when it
  exists (hourly).
- **Resolution v2** (`device_registry.py` evolves, keeps its public
  `resolve()` shape): match against synced names + aliases + `area + domain`
  compounds ("kitchen lights" → all `light.*` in area Kitchen — group
  result), then the legacy JSON file as a final fallback (kept for
  overrides, no longer required).
- Voice/tool paths (`intent_router`, `control_device`) automatically benefit
  — same entry point.
- Alias + hide management endpoints (`PATCH /api/home/entities/{id}`).

Verify: after sync, "turn off the kitchen lights" works with an empty JSON
registry; renaming a device in HA and re-syncing updates resolution; hidden
entities stop resolving.

### Phase H2 — Live events (the house gets a pulse)

- Add a **persistent HA WebSocket subscription** to
  `home_assistant.py` (`/api/websocket`, `subscribe_events` on
  `state_changed`): a lifespan task with auto-reconnect/backoff, feeding an
  in-process async event bus (`core/home_events.py` — subscribe by
  entity/domain/area pattern).
- **Frontend live updates**: bridge state changes to the Home page over the
  app's existing WebSocket/SSE plumbing (scoped per authed user) — device
  cards update in real time; the 30s poll becomes a fallback.
- Update `context_engine` room temperature/lights from live states (its
  occupancy fields stay dormant until presence exists).

Verify: flipping a light physically updates the UI in under a second;
backend restart resubscribes cleanly; HA restart doesn't wedge the bus.

### Phase H3 — The Home page (one location, rooms first)

Rebuild `HomeNodePage.jsx` as **the** Home location:

- **Status strip** (top): anything unhealthy or notable — unlocked locks,
  open covers/doors, active safety alerts (H5), HA unreachable banner,
  climate summary, mower state (link to Fleet). Empty strip = all quiet.
- **Rooms** (main body, from synced areas): one card per area — occupancy
  placeholder (wired later by R5 presence), temperature if a sensor exists,
  the room's devices with tap/slider controls, media player if present.
  Unassigned entities group under "Other."
- **Sections** below rooms: Scenes strip (existing), Security (locks +
  door/window sensors), Media (all players + volume/playback), Sensors &
  Energy (device_class-grouped readings).
- Live-updating via H2. Room edits (assign entity to area) happen in HA —
  link out; River renders what HA declares (one source of truth).
- **Retire `EnvironmentPage.jsx`**: room states fold into the room cards;
  the rover telemetry card moves to the Fleet page or the status strip
  link. Remove the drawer entry; keep a redirect.

Verify: the whole house is operable from one page on phone and desktop;
domain page parity checklist (everything HomeNode did still works); a
device change from a wall switch appears live in its room card.

### Phase H4 — River is the brain (triggers + voice authoring + media)
*(Depends on chat plan Phase 2 [agent loop] and routines plan R1/R3
[DeliveryRouter, agent routines]. If R3 isn't built yet, build the trigger
store here and surface the dependency.)*

- **Device triggers on routines**: extend the routine model with
  `trigger="device"` + `trigger_config` JSON:
  `{entity/area/device_class pattern, to_state, for_seconds, time_window}`.
  A `core/home_triggers.py` evaluator subscribes to the H2 event bus,
  handles `for_seconds` debouncing (state must hold), checks time windows in
  the owner's timezone, and fires the routine through the agent loop with
  the triggering event in context. Delivery/receipts via DeliveryRouter.
- **Voice authoring**: extend the R3 routine tools so trigger phrases parse
  naturally — "when the garage door opens after 10pm, alert me" →
  device-trigger routine (confirmed back in plain language); "what happens
  when the garage opens?" lists matching routines; edits/deletes by voice.
- **Media tools**: `play_media(target_room_or_player, query)`,
  `pause/resume/volume`, using HA media_player services + the synced
  area mapping ("play music in the kitchen").
- **Announcements**: `announce(message, room|all)` — TTS through HA
  media_players (`media_player.play_media` with a served TTS clip from the
  warm TTS pool, or HA's own tts service as fallback). Register announce-
  capable players as devices in the R5 device registry so the
  DeliveryRouter's TTS channel can target them.

Verify: author the garage-after-10pm rule by voice, trip it (state change
via HA dev tools), get the alert with a receipt; "play music in the
kitchen" starts the kitchen speaker; an announcement plays in one named
room.

### Phase H5 — Built-in safety pack (defaults on)

Pre-registered trigger rules, created at startup if absent, each visible
and individually mutable in a Home settings section:

| Rule | Condition (device_class driven) | Severity |
|---|---|---|
| Leak | `moisture` binary_sensor on | **critical** (bypasses quiet hours) |
| Smoke/CO | `smoke`/`gas`/`carbon_monoxide` on | **critical** |
| Door/garage left open | `door`/`garage_door`/cover open ≥ N min (default 10) | warning |
| Unlocked late | any lock unlocked after H o'clock (default 22:00) local | warning |
| Freezer warm | temp sensor named/classed freezer above threshold | warning |

- Implemented as rows in the H4 trigger store flagged `builtin=true`
  (mutable: threshold, enabled, severity), not hardcoded paths — one
  engine.
- All deliveries via DeliveryRouter (critical uses its quiet-hours bypass).
  Missing sensor classes = rule silently inert (no config nagging).

Verify: simulate a moisture sensor turning on at 3am → push arrives
(critical bypass); a door held open crosses N minutes → one warning, no
repeat spam (router cooldown); disabling a builtin in settings silences it.

---

## 4. Explicitly out of scope (leave hooks, do not build)

- **Cameras and Warden** — owner decision: no camera compute today; future
  cameras will be off-network/directly-attached. Warden stays exactly as
  is (dormant). The seam when it returns: Warden posts detections to
  `POST /api/context/rooms` (already exists) and/or emits ProactiveItems —
  document this in a Warden README comment, build nothing.
- Room presence/occupancy sensing — arrives via the voice-device fleet
  (routines plan R5), not here. The room cards keep a dormant occupancy
  slot.
- Managing/authoring HA's own automations, dashboards, or areas from River
  (areas are edited in HA; River syncs).
- Energy analytics/history charts (current readings only this phase).
- Matter/Zigbee/Z-Wave direct integrations — HA owns the device layer.

## 5. Working agreements for the implementing agent

- Same branch and conventions as the other plans; commit per phase; push
  `-u origin claude/chat-voice-integration-bzdo2v`.
- **One HA client** (`home_assistant.py`) — every HA touch goes through it;
  no new module-level clients. One resolution entry point
  (`device_registry.resolve`) for every voice/tool path.
- All alerts/notifications through the DeliveryRouter once it exists — the
  trigger evaluator never calls push directly.
- Trigger evaluation must be resilient: a failing routine or unreachable HA
  never crashes the event bus; reconnect with backoff; log + continue.
- Additive-only migrations; feature flags in `config/settings.py`
  (`ha_sync_enabled`, `home_triggers_enabled`, per-builtin defaults).
- Tests: resolution v2 (name/alias/area+domain/hidden), sync upsert
  idempotency, trigger debounce (`for_seconds`) + time windows + timezone,
  builtin-pack creation idempotency, critical bypass path, event-bus
  reconnect, honest failure message.
- Production auto-deploys nightly from `main` — merge only verified phases.
