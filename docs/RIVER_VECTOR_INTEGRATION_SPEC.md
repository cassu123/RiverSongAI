# River Vector × River Song — Integration Specification

**Status:** Draft for implementation
**Version:** 1.0
**Last updated:** 2026-05-30
**Owners:** River Vector side — Claude. River Song side — Antigravity (Google CLI agent).

---

## Document Purpose

This is the **single source of truth** for how River Vector mowers and the River Song AI ecosystem communicate, configure each other, and operate together. Both teams implement against this document. No work begins without alignment to this spec.

If implementation reveals a missing decision, the spec is updated **first**, then the code follows.

---

## Glossary

| Term | Meaning |
|---|---|
| **River Song** | The central self-hosted AI ecosystem at `riversongai.com` / `192.168.1.221`. FastAPI + React/Vite. |
| **River Vector** | The autonomous mower control software. Runs on a Raspberry Pi inside each mower. |
| **Unit** | A single mower. Each has a unique `unit_id`. Current unit: Voyager (`VOY-RV-001`). |
| **Zone** | A GPS-bounded area where a mower is allowed to operate. Stored as a closed polygon. |
| **No-go area** | A polygon *inside* a zone that the mower must avoid (flower beds, fire pit, etc.). |
| **Program** | A named mowing job: which zones, what pattern, what settings, assigned to which unit. |
| **Schedule** | A cron-driven trigger that runs a program automatically. |
| **Session** | One execution of a program by a unit. Has a start, an end, and a status. |
| **Bootstrap config** | The minimal file on the device: known WiFi networks, claim state, server URLs. |
| **Operational config** | Everything else (hardware specs, zones, programs, safety floors). Lives in River Song. |
| **Unit token** | Per-unit secret issued at claim time. Required on every device-server call. |
| **Config version** | Monotonic integer. Increments when anything affecting a unit changes server-side. |
| **Claim code** | One-time 6-digit code shown on the device during pairing. Used to bind a unit to River Song. |

---

## 0. Guiding Principles

1. **River Song is the source of truth for everything configurable.** No operator ever edits a `.json` file on the device.
2. **River Vector owns all real-time autonomy.** River Song sends mission-level commands; the device decides how to execute them.
3. **Hardware is declared, not assumed.** A unit with no cameras runs fine — it just can't do vision-based obstacle avoidance. Missing hardware degrades gracefully, never crashes.
4. **Safety floors live on the device and cannot be overridden remotely.** River Song can configure clearance distances within bounds; it cannot disable the watchdog or override an e-stop.
5. **River Song is optional at runtime.** A mowing session in progress survives a River Song outage using cached config.
6. **Two control channels.** Commands flow over a **long-poll connection** for low latency. Telemetry flows over **HTTP POST** at cadence. Browser UI gets updates via **Server-Sent Events**.
7. **Every device-server call is authenticated** with a per-unit token issued at claim time. WireGuard is defense in depth, not the auth boundary.
8. **The hardware E-stop button is the safety guarantee.** Remote E-stop is best-effort and high-priority, but it is not the primary safety mechanism.
9. **This design scales from one Voyager to a commercial fleet.** Every decision is made with that in mind.

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ River Song (riversongai.com / 192.168.1.221)                    │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  FastAPI     │  │  SQLite DB   │  │  Scheduler daemon      │ │
│  │  + vector    │←→│  + vector_*  │←→│  (cron evaluation)     │ │
│  │  routes      │  │  tables      │  │                        │ │
│  └──────┬───────┘  └──────────────┘  └────────────────────────┘ │
│         │                                                       │
│  ┌──────┴───────┐                                               │
│  │  React/Vite  │  ←─── browser via JWT-authenticated REST + SSE│
│  │  frontend    │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
         ▲                                          ▲
         │ HTTP POST (telemetry, alerts, events)    │ Long-poll
         │ token-authenticated                      │ (commands)
         │                                          │
┌────────┴──────────────────────────────────────────┴─────────────┐
│ River Vector — Mower (Raspberry Pi + RP2040 Pico)               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ config_sync  │  │ main.py loop │  │ telemetry_thread       │ │
│  │ (cache.json) │  │  + autonomy  │  │ command_stream         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow summary:**
- **On boot:** Device reads bootstrap → connects to WiFi → registers → claims if needed → pulls full config → starts threads.
- **At rest:** Telemetry every 30s. Command long-poll continuously held open. UI shows live telemetry via SSE.
- **While mowing:** Telemetry every 5s. Commands arrive in ~100ms over long-poll. Path planning is local to the device.
- **On config change (server-side):** Server bumps `config_version`. Long-poll response carries new version. Device re-pulls config on next session start (or immediately if it's a safety floor change).

---

## 2. Device Lifecycle

The mower is always in exactly one of these states. State is reported in every status push.

| State | Meaning | Entered from | Allowed transitions |
|---|---|---|---|
| `UNCLAIMED` | First boot or factory reset. Device has an identity but no River Song association. | factory / reset | `CLAIMING` |
| `CLAIMING` | mDNS discovery active, waiting for River Song to pair via claim code. | `UNCLAIMED` | `SETUP_PENDING`, `UNCLAIMED` (on timeout) |
| `SETUP_PENDING` | Claimed but no operational config yet (or config invalid/missing). | `CLAIMING`, `OFFLINE_REPLAY` | `IDLE` |
| `IDLE` | Has full config. Engine off or running but parked. Ready to accept commands. | `SETUP_PENDING`, `MANUAL`, `AUTO`, `RETURNING_HOME` | `MANUAL`, `AUTO`, `ESTOP`, `FAULT` |
| `MANUAL` | Operator-driven or teleoperated. Autonomy off. | `IDLE` | `IDLE`, `ESTOP`, `FAULT` |
| `AUTO` | Executing an autonomous session. | `IDLE` | `IDLE` (complete), `RETURNING_HOME`, `ESTOP`, `FAULT` |
| `RETURNING_HOME` | Autonomous return to home position. | `AUTO`, `IDLE` (manual return-home) | `IDLE`, `ESTOP`, `FAULT` |
| `ESTOP` | E-stop engaged (remote, hardware button, or fault). All motion halted. | any | `IDLE` (after manual reset) |
| `FAULT` | Critical fault preventing operation. | any | `IDLE` (after fault cleared) |
| `OFFLINE_REPLAY` | River Song unreachable, finishing current session from cache; queuing telemetry. | `AUTO`, `IDLE` | `IDLE` (when reconnected and replayed) |

**State diagram:** All states (except `UNCLAIMED`, `CLAIMING`) can be interrupted by `ESTOP` or `FAULT`. Recovery from `ESTOP` or `FAULT` always goes through `IDLE`.

---

## 3. Connectivity Model

The mower needs to reach `riversongai.com` (or the LAN address as fallback). This section defines exactly how.

### 3.1 WiFi connection — pre-agreed SSID list

The bootstrap stores a **prioritized list of known WiFi networks**. On boot, the device's WiFi manager attempts each in order until one connects.

```json
{
  "wifi_networks": [
    {"ssid": "HokeHome", "psk_encrypted": "...", "priority": 1},
    {"ssid": "ChrisPhoneHotspot", "psk_encrypted": "...", "priority": 2},
    {"ssid": "Backyard-Repeater", "psk_encrypted": "...", "priority": 3}
  ]
}
```

- Stored in `/etc/river-vector/bootstrap.json`, root-readable only (0600).
- Passwords stored encrypted at rest using the device's hardware-derived key (RPi serial + secure element if available, fallback to a generated key in `/etc/river-vector/keystore` 0600).
- WiFi management uses `wpa_supplicant` (Pi default) or `NetworkManager`.
- New networks added via the setup wizard or via a service mode (see §4.5).

### 3.2 Server URL resolution

The bootstrap stores two URLs, tried in order:

```json
{
  "river_song": {
    "url_primary":   "https://riversongai.com",
    "url_fallback":  "http://192.168.1.221:8000"
  }
}
```

- **Primary** is reached over the internet (any WiFi with internet access works).
- **Fallback** is reached on the LAN only (works when phone hotspot is used as bridge OR when home WiFi has lost internet but is otherwise up).
- If both fail, the device enters `OFFLINE_REPLAY`.

### 3.3 Connectivity tiers

The device reports its current connectivity tier with every telemetry push:

| Tier | Meaning |
|---|---|
| `internet` | Reached server via primary URL. |
| `lan` | Reached server via fallback URL only. |
| `offline` | Neither URL reachable. Running from cache. |
| `meshtastic_only` | All WiFi options dead, Meshtastic beacon active for position + kill commands only. |

The current code's `MeshtasticBeacon` continues as a last-resort channel: GPS position broadcast + remote kill switch. No telemetry, no config, no normal commands over Meshtastic.

### 3.4 Captive portals & connectivity probing

After WiFi association, the device probes connectivity with a HEAD request to a known URL (`https://riversongai.com/api/health` or `http://192.168.1.221:8000/api/health`). If 200, online. If 3xx redirect to a non-River-Song host → captive portal detected, log warning, retry next SSID after 30s.

### 3.5 Time synchronization

NTP-synchronized clock is **required**. On boot:

1. Device starts `systemd-timesyncd` against `pool.ntp.org`.
2. Waits up to 30 seconds for sync.
3. If not synced after 30 seconds, raises fault `CLOCK_NOT_SYNCED` and stays in `SETUP_PENDING`.
4. Time anomalies during operation (clock jumps >5s) raise fault `CLOCK_DRIFT`.

---

## 4. First-Time Setup (Google Home / Sonos model)

### 4.1 Step 0 — Discovery & Claim

**Device side:**
- On first boot (no `claim_state` in bootstrap), the device:
  1. Connects to a WiFi network from the bootstrap list (or fails, see §4.5).
  2. Generates a `unit_id` of the form `RV-{rpi_serial_last8}-{4_random_hex}` (deterministic per-Pi, with random suffix to allow multiple flashes).
  3. Generates a 6-digit `claim_code`.
  4. Begins mDNS broadcast on `_rivervector._tcp.local` with TXT record `unit_id=<id>`, `proto_version=1`.
  5. Displays `claim_code` on its OLED if present, prints it to logs always, and writes it to `/var/lib/river-vector/claim_code.txt` (chmod 600).
  6. State becomes `CLAIMING`.

**River Song side:**
- Frontend `/fleet` page has a "Discovered Devices" panel that polls `GET /api/vector/units/discovered` (which the server populates via its own mDNS listener on the LAN).
- User clicks "Claim" next to a discovered unit.
- A modal prompts for the `claim_code` (the user reads it from the device or from where they wrote it down).
- Frontend POSTs `/api/vector/units/{unit_id}/claim` with `{"claim_code": "123456"}`.
- Server verifies the claim code by calling the device's local HTTP endpoint `POST http://<device_ip>:8765/verify-claim` with the code. The device confirms or denies. (This step uses the LAN connection that mDNS discovered — no internet needed.)
- If verified, server generates a `unit_token` (32 random bytes, base64-encoded), stores it in `vector_units.unit_token`, and pushes it back to the device via the `verify-claim` response.
- Device writes `(claimed=true, unit_token=...)` to `/etc/river-vector/bootstrap.json`, stops mDNS, transitions to `SETUP_PENDING`.

### 4.2 Setup Wizard — collected fields

After claim, the wizard runs on the frontend. All fields are written to the unit's record server-side and pushed to the device via the config endpoint.

**Step 1 — Identity**
- `name` (e.g. "Voyager")
- `platform`: `riding` / `robot` / `push`
- `timezone` (auto-detected from browser, editable; used for schedule display only — cron stored in UTC)

**Step 2 — Drive System**
- `drive.type`: `clutch` / `hydrostatic` / `differential` / `direct_electric`
- if `clutch`: `drive.gears` (integer)
- `drive.max_speed_kmh` (float)
- `drive.turn_radius_m` (float)
- `drive.speed_control`: `brake_pedal` / `throttle` / `electronic`

**Step 3 — Cutting Deck**
- `deck.width_inches` (float)
- `deck.engagement`: `pto_lever` / `electric_pto` / `belt`
- `deck.height_adjustable` (bool)

**Step 4 — Hardware Installed (all optional)**
- `cameras.count`: `0` / `1` / `2` / `5` / `custom`
  - if `custom`: configure each (`name`, `position`, `fov`)
- `sensors.gps`: `none` / `standard` / `rtk`
  - if `rtk`: `rtk.ntrip_host`, `rtk.ntrip_port`, `rtk.ntrip_mountpoint`, `rtk.ntrip_user`, `rtk.ntrip_password`
- `sensors.imu`: bool
- `sensors.obstacle`: `none` / `ultrasonic` / `lidar` / `camera_based`
- `sensors.fuel`: bool
- `sensors.temperature`: bool
- `sensors.rpm`: bool
- `sensors.operator_presence`: `none` / `seat_sensor` / `handle_grip`
- `pico_bridge.port` (default `/dev/ttyACM0`)
- `pico_bridge.baud_rate` (default `115200`)

**Step 5 — Power**
- `power.type`: `gas` / `electric`
- if `electric`: `power.nominal_voltage_v`, `power.battery_cells`, `power.min_voltage_v`
- if `gas`: `power.min_battery_v` (for electronics/starter)

**Step 6 — Safety Floors (collapsible "advanced")**
- `safety_floors.min_obstacle_clearance_m` (default 0.20, range 0.10–1.0)
- `safety_floors.imu_tilt_cutoff_deg` (default 15.0, range 10.0–25.0)
- `safety_floors.watchdog_timeout_ms` (default 500, range 250–2000)
- `safety_floors.min_battery_v_cutoff` (defaults from power config, editable)
- `safety_floors.operator_presence_required_for_auto` (default true if presence configured)

These are **minimums** — programs can be set stricter, never looser.

**Step 7 — Home Position**
- Map view (Leaflet + satellite tiles) centered on a default (or last-known GPS if available).
- User clicks to set `home_position.lat`, `home_position.lng`.
- User sets `home_position.heading_deg` (the direction the mower faces when docked).

**Step 8 — Confirm & Save**
- Summary screen of all fields.
- On save: server writes the full record to `vector_units`, increments `config_version`, returns success.
- Device receives the new config on its next long-poll cycle (~100ms), pulls the config, transitions `SETUP_PENDING` → `IDLE`.
- Fleet page shows unit as online.

### 4.3 Post-setup editing

All wizard fields are editable from `/fleet/units/:id` → Settings tab. Edits PATCH the unit record, bump `config_version`, and push to the device. Hardware changes (sensor added/removed) apply on next session start; safety floor tightenings apply immediately.

### 4.4 Reset / re-pair

A unit can be reset by:
- Frontend: `/fleet/units/:id` → "Reset Unit" button. Server marks unit unclaimed, clears `unit_token`, deletes from `vector_units` (with cascade), returns the device to `UNCLAIMED` on next reach.
- Device: physical reset (hold a GPIO button for 10s, or `sudo river-vector-reset` SSH command).

### 4.5 Service mode (no known WiFi)

If a freshly flashed device has no known WiFi networks in bootstrap and is unable to connect to anything, it enters **service mode**:
- Brings up its own WiFi AP `RiverVector-<unit_id_short>` with default PSK `rivervector` (printable on device sticker eventually).
- Hosts a tiny setup page at `http://192.168.4.1/setup` to enter WiFi credentials.
- Once a WiFi network is configured, exits service mode and proceeds to §4.1.

For now (Voyager), the bootstrap will be pre-populated with the home WiFi and phone hotspot before first boot, so service mode is a fallback only.

---

## 5. Data Models

All tables prefixed `vector_` to namespace them within the existing RiverSong DB.

### 5.1 `vector_units`

```sql
CREATE TABLE vector_units (
    unit_id              TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    platform             TEXT NOT NULL,                    -- riding|robot|push
    unit_token           TEXT NOT NULL,                    -- issued at claim
    firmware_version     TEXT,
    timezone             TEXT NOT NULL DEFAULT 'UTC',
    online               INTEGER NOT NULL DEFAULT 0,       -- bool
    last_seen            DATETIME,
    last_ip              TEXT,
    connectivity_tier    TEXT,                             -- internet|lan|offline|meshtastic_only
    registered_at        DATETIME NOT NULL,
    claimed_at           DATETIME NOT NULL,
    hardware             TEXT NOT NULL,                    -- JSON HardwareConfig
    safety_floors        TEXT NOT NULL,                    -- JSON SafetyFloors
    home_position        TEXT NOT NULL,                    -- JSON {lat,lng,heading_deg}
    operating_mode       TEXT,                             -- last known
    session_state        TEXT,                             -- last known
    active_faults        TEXT,                             -- JSON list
    notes                TEXT
);
CREATE INDEX idx_units_online ON vector_units(online);
```

### 5.2 `vector_config_revisions`

Single monotonic counter per unit. Bumped on any UPDATE affecting the unit's config (including changes to assigned program or any of the program's zones).

```sql
CREATE TABLE vector_config_revisions (
    unit_id     TEXT PRIMARY KEY REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    revision    INTEGER NOT NULL DEFAULT 1,
    updated_at  DATETIME NOT NULL
);
```

### 5.3 `vector_zones`

```sql
CREATE TABLE vector_zones (
    zone_id          TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    created_by       TEXT NOT NULL,                       -- user_id
    created_at       DATETIME NOT NULL,
    updated_at       DATETIME NOT NULL,
    boundary         TEXT NOT NULL,                       -- JSON [{lat,lng}, ...]
    no_go_areas      TEXT NOT NULL DEFAULT '[]',          -- JSON [[{lat,lng},...], ...]
    area_sqm         REAL,                                -- computed on save
    capture_method   TEXT NOT NULL,                       -- drawn|taught
    notes            TEXT
);
```

### 5.4 `vector_programs`

```sql
CREATE TABLE vector_programs (
    program_id            TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    zone_ids              TEXT NOT NULL,                  -- JSON ordered list of zone_ids
    pattern               TEXT NOT NULL,                  -- stripes|spiral|perimeter_first|checkerboard
    direction_deg         REAL NOT NULL DEFAULT 0,
    overlap_pct           REAL NOT NULL DEFAULT 10,
    obstacle_clearance_m  REAL NOT NULL,                  -- must be >= unit's safety_floor
    edge_distance_m       REAL NOT NULL DEFAULT 0.15,
    speed_profile         TEXT NOT NULL DEFAULT 'normal', -- slow|normal|fast
    assigned_unit_id      TEXT REFERENCES vector_units(unit_id) ON DELETE SET NULL,
    created_at            DATETIME NOT NULL,
    updated_at            DATETIME NOT NULL
);
CREATE INDEX idx_programs_assigned ON vector_programs(assigned_unit_id);
```

Server-side validation: cannot create or update a program with `obstacle_clearance_m < assigned_unit.safety_floors.min_obstacle_clearance_m`.

### 5.5 `vector_schedules`

```sql
CREATE TABLE vector_schedules (
    schedule_id          TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    program_id           TEXT NOT NULL REFERENCES vector_programs(program_id) ON DELETE CASCADE,
    cron_utc             TEXT NOT NULL,                   -- 5-field cron, UTC
    timezone_display     TEXT NOT NULL DEFAULT 'UTC',
    enabled              INTEGER NOT NULL DEFAULT 1,
    missed_run_policy    TEXT NOT NULL DEFAULT 'skip',    -- skip|run_once_on_recovery
    last_run             DATETIME,
    next_run             DATETIME,
    created_at           DATETIME NOT NULL
);
CREATE INDEX idx_schedules_next_run ON vector_schedules(next_run, enabled);
```

### 5.6 `vector_sessions`

```sql
CREATE TABLE vector_sessions (
    session_id           TEXT PRIMARY KEY,
    unit_id              TEXT NOT NULL REFERENCES vector_units(unit_id),
    program_id           TEXT REFERENCES vector_programs(program_id),
    zone_ids_snapshot    TEXT,                            -- JSON snapshot
    config_version       INTEGER NOT NULL,
    started_at           DATETIME NOT NULL,
    ended_at             DATETIME,
    status               TEXT NOT NULL,                   -- active|completed|aborted|failed
    abort_reason         TEXT,
    area_mowed_sqm       REAL,
    battery_used_pct     REAL,
    fuel_used_pct        REAL,
    faults_during        TEXT,                            -- JSON list
    triggered_by         TEXT                             -- user_id|schedule_id|system
);
CREATE INDEX idx_sessions_unit_time ON vector_sessions(unit_id, started_at DESC);
```

### 5.7 `vector_commands`

```sql
CREATE TABLE vector_commands (
    command_id           TEXT PRIMARY KEY,                -- UUIDv4
    unit_id              TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    issued_by            TEXT NOT NULL,                   -- user_id|'scheduler'|'system'
    issued_at            DATETIME NOT NULL,
    idempotency_key      TEXT,                            -- dedup within 60s window
    action               TEXT NOT NULL,
    params               TEXT NOT NULL DEFAULT '{}',      -- JSON
    status               TEXT NOT NULL DEFAULT 'pending', -- pending|dispatched|acknowledged|completed|failed|expired
    dispatched_at        DATETIME,
    acknowledged_at      DATETIME,
    completed_at         DATETIME,
    result               TEXT,                            -- JSON
    ttl_seconds          INTEGER NOT NULL DEFAULT 30
);
CREATE INDEX idx_commands_pending ON vector_commands(unit_id, status, issued_at);
CREATE UNIQUE INDEX idx_commands_idem ON vector_commands(unit_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

### 5.8 `vector_telemetry`

```sql
CREATE TABLE vector_telemetry (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id           TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    session_id        TEXT REFERENCES vector_sessions(session_id),
    timestamp         DATETIME NOT NULL,
    lat               REAL,
    lng               REAL,
    heading_deg       REAL,
    speed_kmh         REAL,
    battery_v         REAL,
    battery_pct       REAL,
    fuel_pct          REAL,
    engine_rpm        INTEGER,
    temp_c            REAL,
    operating_mode    TEXT,
    progress_pct      REAL,
    active_faults     TEXT,                              -- JSON
    connectivity_tier TEXT
);
CREATE INDEX idx_telemetry_unit_time ON vector_telemetry(unit_id, timestamp DESC);
```

**Retention:** 7 days at full fidelity. Downsample to one row per 5 minutes from day 8–90. Drop after 90 days. Implemented by `vector_pruner` task in scheduler daemon, runs hourly. Override with env `VECTOR_TELEMETRY_RETENTION_DAYS` (default 90).

### 5.9 `vector_alerts`

```sql
CREATE TABLE vector_alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id           TEXT NOT NULL REFERENCES vector_units(unit_id) ON DELETE CASCADE,
    session_id        TEXT REFERENCES vector_sessions(session_id),
    timestamp         DATETIME NOT NULL,
    level             TEXT NOT NULL,                     -- info|warning|critical
    title             TEXT NOT NULL,
    message           TEXT,
    fault_code        TEXT,
    acknowledged      INTEGER NOT NULL DEFAULT 0,
    acknowledged_at   DATETIME,
    acknowledged_by   TEXT
);
CREATE INDEX idx_alerts_unit_time ON vector_alerts(unit_id, timestamp DESC);
CREATE INDEX idx_alerts_unack ON vector_alerts(unit_id, acknowledged);
```

`critical`-level alerts trigger Web Push via `providers/push/sender.py` to all subscribed users with `operator` or `admin` role.

### 5.10 `vector_session_events`

```sql
CREATE TABLE vector_session_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES vector_sessions(session_id) ON DELETE CASCADE,
    unit_id      TEXT NOT NULL,
    timestamp    DATETIME NOT NULL,
    event        TEXT NOT NULL,
    data         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_session ON vector_session_events(session_id, timestamp);
```

Event types: `session_started`, `row_complete`, `row_skipped`, `obstacle_avoided`, `path_replanned`, `zone_complete`, `partial_completion`, `session_done`, `fault_abort`, `estop`, `returned_home`.

---

## 6. API Contract

All routes mount under `/api/vector/`. New router file: `api/routes/vector_fleet.py`.

### 6.1 Device-facing (`X-Unit-Token` required after claim)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/register` | Boot announcement. Creates unit record if `UNCLAIMED`; updates `last_seen`/`firmware_version`/`connectivity_tier` if claimed. |
| `POST` | `/units/{unit_id}/claim/verify-response` | Device → server response during claim handshake. (See §4.1.) |
| `GET` | `/config/{unit_id}` | Full operational config bundle. Includes `config_version`. |
| `GET` | `/command/stream/{unit_id}` | **Long-poll**: holds open up to 30s, returns next pending command or empty. Includes `config_version` in response header `X-Config-Version`. |
| `POST` | `/command/{command_id}/ack` | Device acknowledges receipt. Status → `acknowledged`. |
| `POST` | `/command/{command_id}/complete` | Device reports completion or failure. |
| `POST` | `/status` | Mode/state transition. |
| `POST` | `/telemetry` | Telemetry snapshot. Batch up to 50 per call (offline replay). |
| `POST` | `/alert` | Alert/fault push. |
| `POST` | `/event` | Session lifecycle event. |
| `POST` | `/session/start` | Device announces session start. Server creates `vector_sessions` row, returns `session_id`. |
| `POST` | `/session/end` | Device announces session end with totals. |
| `POST` | `/zones/teach` | Device pushes accumulated boundary waypoints during teach mode. Multi-call. |

### 6.2 Discovery (no auth — LAN-only mDNS proxy)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/units/discovered` | Returns list of mDNS-discovered units the server can see on the LAN. UI polls this during pairing. |

### 6.3 UI-facing (JWT required, role gated — see §16)

**Units**
| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/units` | List all units + live state | viewer+ |
| `GET` | `/units/{id}` | Unit detail | viewer+ |
| `POST` | `/units/{id}/claim` | Claim a discovered unit | admin |
| `PATCH` | `/units/{id}` | Update name / hardware / safety floors / home position | admin |
| `DELETE` | `/units/{id}` | Remove unit | admin |
| `POST` | `/units/{id}/rotate-token` | Issue a new unit token | admin |
| `POST` | `/units/{id}/command` | Send a command | operator+ |
| `GET` | `/units/{id}/telemetry` | Telemetry history (paginated: `?from=&to=&limit=`) | viewer+ |
| `GET` | `/units/{id}/alerts` | Alert history | viewer+ |
| `POST` | `/units/{id}/alerts/{alert_id}/ack` | Acknowledge alert | operator+ |
| `GET` | `/units/{id}/events` | Session event history | viewer+ |
| `GET` | `/units/{id}/sessions` | Session history | viewer+ |
| `GET` | `/units/{id}/camera/{camera_name}/snapshot` | Latest JPEG snapshot (cached, max 5s old) | viewer+ |
| `GET` | `/units/{id}/stream` | **SSE** — live telemetry + status + alerts | viewer+ |

**Zones**
| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/zones` | List | viewer+ |
| `POST` | `/zones` | Create | operator+ |
| `GET` | `/zones/{id}` | Get | viewer+ |
| `PATCH` | `/zones/{id}` | Update | operator+ |
| `DELETE` | `/zones/{id}` | Delete | operator+ |

**Programs**
| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/programs` | List | viewer+ |
| `POST` | `/programs` | Create | operator+ |
| `GET` | `/programs/{id}` | Get | viewer+ |
| `PATCH` | `/programs/{id}` | Update | operator+ |
| `DELETE` | `/programs/{id}` | Delete | operator+ |
| `POST` | `/programs/{id}/run` | Run now (creates pending command) | operator+ |

**Schedules**
| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/schedules` | List | viewer+ |
| `POST` | `/schedules` | Create | operator+ |
| `PATCH` | `/schedules/{id}` | Update / enable / disable | operator+ |
| `DELETE` | `/schedules/{id}` | Delete | operator+ |

**Sessions**
| Method | Path | Purpose | Role |
|---|---|---|---|
| `GET` | `/sessions` | List (paginated, filters by unit/program/date) | viewer+ |
| `GET` | `/sessions/{id}` | Detail + events + telemetry sampled | viewer+ |

### 6.4 Critical endpoint payloads

#### `GET /api/vector/config/{unit_id}` — response

```json
{
  "unit_id": "RV-A1B2C3D4-9F2E",
  "name": "Voyager",
  "config_version": 42,
  "hardware": { /* HardwareConfig — see §5.1 */ },
  "safety_floors": { /* SafetyFloors */ },
  "home_position": {"lat": 35.1234, "lng": -84.5678, "heading_deg": 180},
  "assigned_program": {
    "program_id": "prog_front_weekly",
    "name": "Front Yard — Weekly",
    "pattern": "stripes",
    "direction_deg": 45,
    "overlap_pct": 10,
    "obstacle_clearance_m": 0.30,
    "edge_distance_m": 0.15,
    "speed_profile": "normal",
    "zones": [
      {
        "zone_id": "zone_front",
        "name": "Front Yard",
        "boundary": [{"lat": 35.123, "lng": -84.567}, ...],
        "no_go_areas": [],
        "area_sqm": 412.5
      }
    ]
  },
  "absolute_floors": {
    "min_obstacle_clearance_m": 0.10,
    "min_imu_tilt_cutoff_deg": 10.0,
    "max_imu_tilt_cutoff_deg": 25.0,
    "min_watchdog_timeout_ms": 250,
    "max_watchdog_timeout_ms": 2000
  }
}
```

`absolute_floors` is included so the device can validate (defense in depth — the device has its own hardcoded values too).

#### `GET /api/vector/command/stream/{unit_id}` — long-poll behavior

- Hold open up to **30 seconds**.
- If a `pending` command exists for the unit, mark it `dispatched` and return immediately with the command body.
- If no command arrives within 30s, return `204 No Content`.
- Response always includes `X-Config-Version: <int>` header.
- Device immediately reopens connection after any response.

Response body when command exists:
```json
{
  "command_id": "cmd-uuid-here",
  "action": "mow_start",
  "params": {"program_id": "prog_front_weekly"},
  "issued_at": "2026-05-30T14:00:00Z",
  "ttl_seconds": 30
}
```

#### `POST /api/vector/units/{id}/command` — payload

```json
{
  "action": "mow_start" | "mow_stop" | "return_home" | "estop" | "estop_reset"
          | "manual.drive" | "manual.steer" | "manual.brake" | "manual.blades"
          | "teach.start" | "teach.waypoint" | "teach.end"
          | "config.refresh",
  "params": { /* action-specific */ },
  "idempotency_key": "optional-string"
}
```

Server response:
```json
{
  "command_id": "cmd-uuid",
  "status": "pending",
  "ttl_expires_at": "2026-05-30T14:00:30Z"
}
```

UI then watches `/api/vector/units/{id}/stream` SSE for status transitions (`dispatched` → `acknowledged` → `completed`).

#### `GET /api/vector/units/{id}/stream` — SSE format

```
event: telemetry
data: {"timestamp":"...","lat":...,"lng":...,"battery_pct":...}

event: status
data: {"operating_mode":"AUTO","session_state":"mowing"}

event: alert
data: {"level":"warning","title":"...","message":"..."}

event: command_update
data: {"command_id":"...","status":"acknowledged"}

event: heartbeat
data: {}
```

Heartbeat every 15 seconds to keep the connection alive through proxies.

---

## 7. Control Channel — Long-Poll Detail

This is the most important new pattern. Implementation must follow this exactly.

**Device side (`connectivity/command_stream.py`):**

```
while running:
    try:
        response = session.get(
            f"{base_url}/api/vector/command/stream/{unit_id}",
            timeout=35,        # 30s server hold + 5s margin
            headers={"X-Unit-Token": token},
        )
        if response.status_code == 200:
            cmd = response.json()
            ack_command(cmd["command_id"])         # POST /ack immediately
            command_queue.put(cmd)                 # main loop drains
        elif response.status_code == 204:
            pass                                   # no command, reopen
        elif response.status_code in (401, 403):
            log_error("auth failed, entering UNCLAIMED")
            transition_to_unclaimed()
            break
        else:
            backoff_and_retry()

        check_config_version(response.headers.get("X-Config-Version"))

    except requests.Timeout:
        pass                                       # normal, reopen
    except requests.ConnectionError:
        connectivity_tier = detect_tier()          # internet|lan|offline
        if connectivity_tier == "offline":
            sleep(5)                               # back off
        else:
            sleep(1)
```

**Server side (`api/routes/vector_fleet.py::command_stream`):**

```python
async def command_stream(unit_id: str, ...) -> Response:
    # 1. Auth
    verify_token(unit_id, request.headers["X-Unit-Token"])

    # 2. Check for pending command (already exists)
    cmd = db.fetch_oldest_pending(unit_id)
    if cmd:
        db.mark_dispatched(cmd.command_id)
        return JSONResponse(cmd.to_dict(), headers={"X-Config-Version": str(get_revision(unit_id))})

    # 3. Wait up to 30s for one to arrive (asyncio Event per unit)
    event = command_events[unit_id]
    try:
        await asyncio.wait_for(event.wait(), timeout=30)
        cmd = db.fetch_oldest_pending(unit_id)
        if cmd:
            db.mark_dispatched(cmd.command_id)
            return JSONResponse(cmd.to_dict(), headers={"X-Config-Version": str(get_revision(unit_id))})
    except asyncio.TimeoutError:
        pass

    # 4. Nothing arrived
    return Response(status_code=204, headers={"X-Config-Version": str(get_revision(unit_id))})
```

When a command is enqueued via `POST /units/{id}/command`, the server sets the corresponding asyncio Event to wake up the held long-poll.

---

## 8. Telemetry Cadence

Device telemetry thread (`connectivity/telemetry_thread.py`) pushes per state:

| State | Telemetry Push |
|---|---|
| `UNCLAIMED` / `CLAIMING` | none |
| `SETUP_PENDING` | none |
| `IDLE` | every 30s |
| `MANUAL` | every 15s |
| `AUTO` | every 5s |
| `RETURNING_HOME` | every 5s |
| `FAULT` | every 1s |
| `ESTOP` | every 1s |
| `OFFLINE_REPLAY` | queue locally, batch-replay 50/call when online |

Telemetry queue: in-memory deque, max 500 entries. On overflow, drop oldest.

Telemetry is collected from `SensorManager.snapshot` (existing class). Fields missing from the snapshot (no sensor present) are sent as `null`, not omitted.

---

## 9. Safety Floors and Enforcement

Three layers, evaluated in this order on any setting that touches the device:

1. **Absolute floors (hardcoded on device, also returned in config response):**

   | Parameter | Min | Max |
   |---|---|---|
   | `min_obstacle_clearance_m` | 0.10 | — |
   | `imu_tilt_cutoff_deg` | 10.0 | 25.0 |
   | `watchdog_timeout_ms` | 250 | 2000 |

   Server validates on save of `safety_floors`. Device validates on receipt. If a value is outside bounds, **the device uses the nearest valid bound** and raises a warning alert.

2. **Per-unit safety_floors (stored in `vector_units.safety_floors`):**
   - Set by admin during wizard or via Settings.
   - Bounded by absolute floors.
   - Tightening (e.g., clearance from 0.20m → 0.30m) applies **immediately**, including mid-session.
   - Loosening (e.g., 0.30m → 0.20m) applies **on next session start only**.

3. **Per-program values (stored in `vector_programs.obstacle_clearance_m`, etc.):**
   - Must be `>=` unit's safety_floor for that parameter.
   - Server-side validation on save: rejects with 400 if violation.
   - Device defensive check: if a program-level value loosens a safety_floor, the safety_floor wins.

**E-stop:**
- **Hardware E-stop button** on the machine cuts power to actuators directly. Software cannot override.
- **Remote E-stop** via `action: "estop"` command. Best-effort, sub-100ms over long-poll. Reported in UI but **not** documented as a safety mechanism.
- **Watchdog timeout** also triggers e-stop (existing behavior).
- **IMU tilt** beyond cutoff triggers e-stop.

**Operator presence:**
- If `sensors.operator_presence != "none"` and `safety_floors.operator_presence_required_for_auto == true`, AUTO mode requires presence signal. Loss of signal during AUTO triggers `mow_stop` (graceful, not e-stop).
- Cannot be disabled remotely once configured.

---

## 10. Commands

### 10.1 Program-level (high-level)

| Action | Params | Description |
|---|---|---|
| `mow_start` | `{"program_id": "..."}` | Start the named program. If already mowing, returns failure. |
| `mow_stop` | `{}` | Graceful stop. Current row finished, blade disengaged, idle. |
| `return_home` | `{}` | Abort session if active, navigate to home position. |
| `estop` | `{}` | Immediate halt. Sets ESTOP state. |
| `estop_reset` | `{}` | Reset from ESTOP (requires no active faults). |
| `config.refresh` | `{}` | Force re-pull of config from server. |

### 10.2 Manual / teleop (only valid in MANUAL state)

| Action | Params | Description |
|---|---|---|
| `manual.drive` | `{"direction": "forward\|reverse", "throttle": 0.0–1.0, "duration_ms": 100–5000}` | Drive for a fixed duration. |
| `manual.steer` | `{"angle_deg": -45..45, "duration_ms": 100–5000}` | Steer for a fixed duration. |
| `manual.brake` | `{"force": 0.0–1.0, "duration_ms": 100–5000}` | Apply brake. |
| `manual.blades` | `{"engage": true\|false}` | Engage/disengage cutting deck. Requires presence. |

Manual commands require `operating_mode == MANUAL` and `operator_presence == satisfied` (if presence configured). They have a max `duration_ms` of 5 seconds — for sustained control, the UI sends repeated commands at ~2 Hz, providing natural watchdog behavior.

### 10.3 Boundary teach mode

| Action | Params | Description |
|---|---|---|
| `teach.start` | `{"zone_name": "..."}` | Enter TEACH state. Begin GPS waypoint capture at 1 Hz. |
| `teach.waypoint` | `{}` | Manually record a single waypoint (in addition to auto-capture). |
| `teach.end` | `{"save": true\|false}` | Exit TEACH state. If `save=true`, server creates a new zone from captured polygon. |

During teach mode, the device pushes accumulated waypoints to `POST /api/vector/zones/teach` every 5s. On `teach.end` with `save=true`, the device finalizes and the server creates `vector_zones` row with `capture_method: "taught"`.

---

## 11. Sessions

A session is the period from `mow_start` to its termination (completion, abort, or fault).

**Lifecycle:**
1. User (or scheduler) issues `mow_start` command.
2. Device receives via long-poll, acks.
3. Device calls `POST /api/vector/session/start` with `{program_id, started_at, config_version}`.
4. Server creates `vector_sessions` row, returns `session_id`.
5. Device tags all subsequent telemetry, events, alerts with `session_id`.
6. On session end, device calls `POST /api/vector/session/end` with `{session_id, status, area_mowed_sqm, ...}`.
7. Server updates row, fires `session_done` event.

**Coordinate system:**
On session start, the device establishes a **local ENU frame** with origin = first boundary waypoint of the first zone in the program. All path planning, obstacle distances, and progress calculations happen in this Cartesian frame (meters). Lat/lng → ENU conversion uses `pyproj`.

**Path adaptation:**
The device's path planner (`navigation/path_planner.py`) handles all live adaptation:
- Obstacle detection → temporary deviation, log `obstacle_avoided` event with original path segment + actual path.
- Persistent obstacle blocking a row → log `row_skipped`, continue with next row.
- Multiple rows blocked → log `partial_completion`, return home, end session with `status: completed` and a non-zero "skipped area" metric.
- GPS loss → graceful stop, raise alert.

**Mid-session config changes:**
- Safety floor **tightenings** apply immediately (device re-checks `config_version` on every long-poll heartbeat).
- Everything else applies on next session start.

---

## 12. Schedules

### 12.1 Storage

Cron expressions stored in UTC. `timezone_display` field used by frontend to render in user-friendly local time.

### 12.2 Scheduler daemon

New daemon: `daemons/vector_scheduler/scheduler.py`. Runs every 60s. Loop:

```python
def tick():
    now = datetime.utcnow()
    due = db.query("""
        SELECT * FROM vector_schedules
        WHERE enabled = 1 AND next_run <= ?
        ORDER BY next_run ASC
    """, (now,))

    for s in due:
        with db.transaction():                  # SQLite write lock prevents double-fire
            # Re-read to confirm still due (avoid race with another tick)
            s_fresh = db.fetch_one("SELECT * FROM vector_schedules WHERE schedule_id=?", s.schedule_id)
            if s_fresh.next_run > now:
                continue

            # Fire program
            issue_command(
                unit_id=program.assigned_unit_id,
                action="mow_start",
                params={"program_id": s.program_id},
                issued_by=f"schedule:{s.schedule_id}",
            )

            # Advance next_run
            db.update_schedule(
                s.schedule_id,
                last_run=now,
                next_run=croniter(s.cron_utc, now).get_next(datetime),
            )
```

**Missed run policy:** If daemon was down and a schedule's `next_run` is in the past:
- `skip` (default): set `next_run` to next future occurrence, do NOT fire missed runs.
- `run_once_on_recovery`: fire once if any runs were missed, advance to next future occurrence.

**Idempotency:** Schedule-issued commands use `idempotency_key = "schedule:{schedule_id}:{utc_timestamp_to_minute}"` — re-firing the same tick by accident is harmless.

---

## 13. River Vector Code Changes (Claude's work)

Performed in this order:

### 13.1 Bootstrap rework
- Move `units/voyager.json` → `/etc/river-vector/bootstrap.json` (deployment script).
- Keep `units/example.json` in repo as a template.
- Bootstrap schema: `{unit_id, claim_state, unit_token, wifi_networks[], river_song: {url_primary, url_fallback}}`.
- New module `core/bootstrap.py` to load/save bootstrap.

### 13.2 `core/identity.py` (new)
- Generates `unit_id` on first boot (deterministic from RPi serial + random suffix).
- Generates 6-digit `claim_code`.
- Manages `UNCLAIMED` / `CLAIMING` / claimed transitions.
- Writes/reads claim state in bootstrap.

### 13.3 `connectivity/mdns_advertise.py` (new)
- Broadcasts `_rivervector._tcp.local` during `CLAIMING`.
- Stops broadcasting once claimed.

### 13.4 `connectivity/claim_server.py` (new)
- Small HTTP server on port 8765, only during `CLAIMING`.
- Endpoint `POST /verify-claim`: accepts claim code, validates, returns confirmation. Server uses this to complete the claim handshake.

### 13.5 `connectivity/config_sync.py` (new)
- On boot (after claim): calls `GET /api/vector/config/{unit_id}`.
- Validates response.
- Writes to `/var/lib/river-vector/config_cache.json`.
- Exposes `get_config()`, `get_revision()`.
- Triggered to re-pull when long-poll response has a newer `X-Config-Version`.

### 13.6 `connectivity/command_stream.py` (new)
- Long-poll loop per §7.
- Posts ack immediately on receipt.
- Pushes commands onto an internal queue for the main loop.

### 13.7 `connectivity/telemetry_thread.py` (new)
- Timer-based thread, cadence per §8.
- Builds snapshot from `SensorManager`, posts to `/api/vector/telemetry`.
- On failure, queues in deque (max 500), batches when online.

### 13.8 `connectivity/api_client.py` (refactor)
- Use `X-Unit-Token` header from bootstrap.
- Add `register()` payload simplified: `{unit_id, firmware_version, boot_time, ip_address, connectivity_tier, auto_detected_hardware}`. No more `unit_config` — that comes from server now.
- Add `session_start()`, `session_end()`, `command_ack()`, `command_complete()`.

### 13.9 `core/hardware_factory.py` (refactor)
- Reads from `config_sync.get_config()["hardware"]` instead of `UnitProfile.from_file()`.
- All hardware components gated by presence flags:
  - `cameras.count == 0` → `CameraManager` in permanent sim mode.
  - `sensors.gps == "none"` → no GPSInterface; autonomous mode disabled.
  - `sensors.imu == false` → no tilt safety (warn at boot).
- A `HardwareCapabilities` dataclass surfaces what the unit can/can't do (drives feature gating in autonomy code).

### 13.10 `core/main.py` (refactor)
- New boot sequence:
  ```
  load_bootstrap()
  identity = Identity()
  connect_wifi(bootstrap.wifi_networks)
  wait_for_ntp_sync(timeout=30)

  if not identity.claimed:
      run_claim_flow()              # mDNS + claim_server + UNCLAIMED→SETUP_PENDING

  register_with_river_song()
  config = config_sync.pull()       # or cached on fail
  hardware = HardwareFactory.build(config)
  start_telemetry_thread()
  start_command_stream()
  start_main_loop()                 # autonomy + state machine
  ```

### 13.11 `safety/interlocks.py` (refactor)
- On session start, read `safety_floors` from current config.
- Enforce as hard minimums regardless of program values.
- Add `OperatingMode.TEACH` for boundary teach mode.

### 13.12 `autonomy/manual_control.py` (new)
- Handles `manual.*` commands.
- Enforces `MANUAL` state + presence requirements.
- Watchdog: if no manual command in 1s, brake to stop.

### 13.13 `autonomy/teach_mode.py` (new)
- Captures GPS waypoints at 1Hz during TEACH state.
- Buffers up to 5000 waypoints (a ~80-minute walk at 1m/s).
- Pushes to server every 5s via `POST /api/vector/zones/teach`.
- On `teach.end`, finalizes polygon (auto-closes if needed), posts final batch.

### 13.14 Filesystem paths (deployment)
- Bootstrap: `/etc/river-vector/bootstrap.json` (0600 root)
- Config cache: `/var/lib/river-vector/config_cache.json` (0600 river-vector)
- Logs: `/var/log/river-vector/`
- Claim code (transient): `/var/lib/river-vector/claim_code.txt` (0600)

A `scripts/install.sh` provisions these on first install.

### 13.15 Tests
- Add `tests/test_config_sync.py` — cache hit/miss, schema validation, version comparison.
- Add `tests/test_command_stream.py` — long-poll loop, reconnect, auth failure.
- Add `tests/test_safety_floors.py` — absolute floors enforced when server sends invalid values.
- Existing tests continue to pass.

### 13.16 README updates
- New "Provisioning a new mower" section.
- Bootstrap format documented.
- Claim flow documented.

---

## 14. River Song Implementation (Antigravity's work)

Performed in this order:

### 14.1 DB schema
- All tables in §5 added to `providers/memory/sqlite_store.py`.
- Idempotent migrations from existing partial `vector_units` / `vector_alerts` (created in earlier work).
- Indexes per §5.

### 14.2 Route file `api/routes/vector_fleet.py`
- Replace existing partial implementation.
- Implement all device-facing endpoints (§6.1), discovery (§6.2), and UI-facing endpoints (§6.3).
- Implement long-poll endpoint per §7.
- Implement SSE endpoint per §6.4.
- Token verification middleware for device endpoints.
- JWT + role verification middleware for UI endpoints.

### 14.3 mDNS listener daemon
- New module: `daemons/vector_discovery/listener.py`.
- Listens for `_rivervector._tcp.local` broadcasts on LAN.
- Maintains in-memory map of discovered (un-claimed) units.
- Exposed via `GET /api/vector/units/discovered`.

### 14.4 Scheduler daemon
- New module: `daemons/vector_scheduler/scheduler.py` per §12.
- Registered with daemon registry.
- Also runs the telemetry pruner hourly.

### 14.5 Web Push integration
- On `critical` alert insert, call `providers/push/sender.py` to notify subscribed operators/admins.

### 14.6 Frontend pages

All pages live under `frontend/src/pages/fleet/` with routes added to `App.jsx`:

- `/fleet` — Overview (map + unit cards + discovered devices panel)
- `/fleet/units/:id` — Unit detail (live telemetry, controls, settings tabs)
- `/fleet/units/:id/setup` — Setup wizard (multi-step form, post-claim)
- `/fleet/zones` — Zone manager (Leaflet polygon editor)
- `/fleet/programs` — Program builder
- `/fleet/schedules` — Schedule manager
- `/fleet/sessions` — Session history

Six total user-facing pages (Overview, Unit Detail, Setup Wizard, Zones, Programs, Schedules), plus Sessions (which is a tab on Overview or its own page — Antigravity to choose).

**Design constraints:**
- Use existing theme tokens (Universe × Environment × Mood system).
- Fully responsive (mobile breakpoint 768px, tablet 1024px).
- Use Leaflet.js with **Esri World Imagery** tiles (free, no key required) for satellite. Optional Mapbox via `VITE_MAPBOX_TOKEN` env.
- Match component patterns from existing pages (ChatInterface, ProfilePage).
- Live telemetry via SSE (`/api/vector/units/{id}/stream`).
- Toast notifications for critical alerts.
- E-stop button is visually distinct (red, large, requires confirm-press for non-critical states).

### 14.7 Permission gating
Existing `core/auth.py` and role checks. Per §16 matrix.

### 14.8 Tests
- Backend endpoint smoke tests.
- Frontend component tests for setup wizard, map editor.

### 14.9 Documentation
- Add this spec to RiverSongAI repo as `docs/RIVER_VECTOR_INTEGRATION_SPEC.md`.
- Update `docs/INTEGRATIONS.md` with River Vector entry.

---

## 15. Frontend Specifications (detail)

### 15.1 `/fleet` — Overview

**Layout:**
- Top: header "Fleet" + "Add Unit" button (admin only).
- Left ~60%: Leaflet map showing all online units as colored markers (color = mode: green=AUTO, blue=MANUAL, red=ESTOP, amber=FAULT, grey=IDLE).
- Right ~40%: Vertical stack of unit cards. Each card: name, mode badge, battery %, fuel %, last seen, quick-action buttons (Start, Stop, Home, E-stop).
- Bottom panel (collapsible): "Discovered Devices" — un-claimed mDNS units with "Claim" buttons.

**Live updates:** subscribed to `/api/vector/units/stream` (aggregated SSE for all units).

### 15.2 `/fleet/units/:id` — Unit Detail

**Tabs:** Live · History · Settings · Camera (if cameras > 0)

**Live tab:**
- Top: mode badge + session state + connectivity tier indicator.
- Telemetry grid: GPS (lat/lng + accuracy), battery (v + %), fuel %, RPM, temp, speed, heading, progress %.
- Map: zoom-in on this unit, showing its position and (if AUTO) the planned path + actual path.
- Alert feed (last 20, with ack buttons).
- Event timeline (current session).
- Control panel: Start Program (dropdown of assigned program + others), Stop, Return Home, E-stop, Manual Mode toggle.
- In Manual Mode: directional control pad (forward/back/left/right + brake + blade toggle). Active only while mouse/touch held (watchdog).

**History tab:**
- Sessions list (date, program, duration, area, status).
- Click session → modal with event timeline + telemetry chart.

**Settings tab:**
- Edit hardware config (re-run wizard or inline edits).
- Edit safety floors.
- Edit home position (map click).
- Rotate token.
- Reset unit.

**Camera tab (if cameras > 0):**
- Grid of camera snapshots, auto-refreshing every 5s.

### 15.3 `/fleet/units/:id/setup` — Wizard

Multi-step form per §4.2. Save persists progress per-step so refresh doesn't lose state.

### 15.4 `/fleet/zones` — Zone Manager

- Map with existing zones drawn as polygons (filled, semi-transparent, hover-highlight).
- Toolbar: Draw Zone, Draw No-Go Area, Edit, Delete.
- Click polygon to select; selected polygon shows its name, area, capture method.
- "Teach Boundary" button: prompts to select a unit, then issues `teach.start` command — UI shows live capture as the user drives.

### 15.5 `/fleet/programs` — Program Builder

- List view: program name, zone list, assigned unit, last run.
- Create/edit modal:
  - Name
  - Zones (drag-to-reorder, multi-select)
  - Pattern (radio: stripes/spiral/perimeter_first/checkerboard)
  - Direction degrees (with visual compass)
  - Overlap %, edge distance, clearance
  - Speed profile
  - Assigned unit
- Validation: clearance >= unit's safety floor.

### 15.6 `/fleet/schedules` — Schedule Manager

- List view: name, program, cron (rendered in local time), next run, last run, enabled toggle.
- Create/edit modal: program selector, cron picker (with presets: "Every Tuesday at 7am", "Daily at 6pm", "Weekdays at noon"), timezone selector (default user's timezone), missed-run policy.

### 15.7 `/fleet/sessions` — Session History

Filterable table: date range, unit, program, status. Click row for detail.

---

## 16. Permissions Matrix

RiverSong roles: `admin`, `operator`, `viewer`, `child`. River Vector permission requirements:

| Action | admin | operator | viewer | child |
|---|---|---|---|---|
| View fleet status | ✅ | ✅ | ✅ | ❌ |
| View telemetry / sessions | ✅ | ✅ | ✅ | ❌ |
| Start / stop program | ✅ | ✅ | ❌ | ❌ |
| E-stop | ✅ | ✅ | ❌ | ❌ |
| Manual control | ✅ | ✅ | ❌ | ❌ |
| Teach boundary | ✅ | ✅ | ❌ | ❌ |
| Acknowledge alerts | ✅ | ✅ | ❌ | ❌ |
| Edit zones | ✅ | ✅ | ❌ | ❌ |
| Edit programs | ✅ | ✅ | ❌ | ❌ |
| Edit schedules | ✅ | ✅ | ❌ | ❌ |
| Edit unit hardware/safety | ✅ | ❌ | ❌ | ❌ |
| Claim / remove unit | ✅ | ❌ | ❌ | ❌ |
| Rotate token | ✅ | ❌ | ❌ | ❌ |

---

## 17. Failure Modes & Recovery

| Failure | Detection | Behavior |
|---|---|---|
| River Song unreachable on boot | HTTP timeout on `/register` | Try LAN fallback; if both fail, retry every 60s. State stays in `SETUP_PENDING` until success. |
| River Song unreachable mid-session | Long-poll connection error | Continue session using cached config. Queue telemetry locally. State becomes `OFFLINE_REPLAY`. Reconnect with exponential backoff. |
| Config cache missing on boot + River Song unreachable | File not found | Stay in `SETUP_PENDING`. Retry registration every 60s. Alert via Meshtastic if configured. |
| Long-poll connection drops repeatedly | 5 consecutive errors within 60s | Switch to fallback URL. If both fail, transition to `OFFLINE_REPLAY`. |
| Auth failure (401/403) | Response status | Log critical, transition to `UNCLAIMED`. Requires re-claim. |
| Config version mismatch detected mid-session | `X-Config-Version` header in long-poll response | If safety floor changed, immediately re-pull and apply. Otherwise defer until session end. |
| Telemetry queue full (500) | deque overflow | Drop oldest. Log warning. Increment dropped-telemetry counter (exposed in next telemetry push). |
| GPS lost during AUTO | GPSManager fault | Graceful stop, `path_lost` event, raise alert. Session status: `failed`. |
| Operator presence lost during AUTO | Presence interlock fires | Graceful stop (not e-stop). Session pause. Resume requires re-engage + UI confirm. |
| IMU tilt exceeded | Sensor reading > cutoff | Hard e-stop. Engine kill via Pico. Alert. |
| Watchdog timeout | No kick within timeout | Hard e-stop. Alert. |
| Clock not synced | NTP query fails | Fault `CLOCK_NOT_SYNCED`. Stay in `SETUP_PENDING`. Operator notified. |
| Battery below cutoff | Sensor reading < `safety_floors.min_battery_v_cutoff` | Graceful stop, `return_home`, alert. |

---

## 18. Observability

### 18.1 Device-side logging

- Structured logs via `logging` to `/var/log/river-vector/river-vector.log`.
- Rotation: 50MB max, keep 5 files.
- Log levels: DEBUG (file only), INFO+ (also to journald).
- Critical events also pushed to River Song as alerts.

### 18.2 Server-side logging

- Standard RiverSong logging.
- Vector-specific log channel: `logger = logging.getLogger("river_vector")`.

### 18.3 Metrics

Telemetry already provides device-side observability. Additional server-side metrics:
- Long-poll connections currently held (gauge)
- Commands pending (gauge)
- Telemetry rows received per minute (counter)
- Auth failures per unit (counter)

These surface in the existing RiverSong admin/analytics dashboard.

---

## 19. Scaling Considerations

**Today (1 unit, Voyager):**
- Single SQLite DB fine.
- Single FastAPI process fine.
- Long-poll connections: 1.
- Telemetry rate: peak 0.2/s.

**Near term (1–5 units):**
- Still fine. Monitor `vector_telemetry` row count; if >5M, trigger archive.
- Long-poll connections: up to 5 held simultaneously. FastAPI async handles trivially.

**Future (10+ units, commercial):**
- Migrate telemetry to a partitioned table or TimescaleDB.
- Per-unit asyncio.Event becomes a dict; OK to ~1000 units.
- Consider WebSocket multiplexing if per-unit connections become an issue.
- Add Redis for command queue + SSE pub/sub if multi-process deployment is needed.

**Documented now as known scaling cliff, not implemented:**
- Per-region servers for very-large-fleet commercial deployment.
- mTLS instead of unit_token bearer auth.

---

## 20. Out of Scope (this version)

These are tracked but deferred:
- OTA firmware updates from River Song.
- Live camera streaming (only snapshots in v1).
- Voice control integration ("River, start mowing the front yard") — exists in River Song chat already.
- Multi-tenant fleet (one River Song serving many separate operators).
- Mower-to-mower direct communication (e.g., zone handoff coordination).
- Weather-aware scheduling (skip runs if rain forecast).
- Predictive maintenance / fault prediction.

---

## Appendix A — Constants & Hard Floors (device-side)

```python
# core/constants.py — DEVICE-SIDE absolute limits.
# Cannot be exceeded by ANY server-pushed configuration.

ABSOLUTE_MIN_OBSTACLE_CLEARANCE_M = 0.10
ABSOLUTE_MIN_IMU_TILT_CUTOFF_DEG = 10.0
ABSOLUTE_MAX_IMU_TILT_CUTOFF_DEG = 25.0
ABSOLUTE_MIN_WATCHDOG_TIMEOUT_MS = 250
ABSOLUTE_MAX_WATCHDOG_TIMEOUT_MS = 2000

LONG_POLL_TIMEOUT_S = 30
LONG_POLL_CLIENT_MARGIN_S = 5
TELEMETRY_QUEUE_MAX = 500
CONFIG_CACHE_PATH = "/var/lib/river-vector/config_cache.json"
BOOTSTRAP_PATH = "/etc/river-vector/bootstrap.json"
CLAIM_CODE_PATH = "/var/lib/river-vector/claim_code.txt"
LOG_PATH = "/var/log/river-vector/river-vector.log"
CLAIM_SERVER_PORT = 8765
MDNS_SERVICE_TYPE = "_rivervector._tcp.local."
PROTOCOL_VERSION = 1
```

---

## Appendix B — Example Payloads

### Register (device → server, on boot)
```json
POST /api/vector/register
X-Unit-Token: <token-if-claimed>
{
  "unit_id": "RV-A1B2C3D4-9F2E",
  "firmware_version": "0.2.0",
  "boot_time": "2026-05-30T14:00:00Z",
  "ip_address": "192.168.1.115",
  "connectivity_tier": "internet",
  "auto_detected_hardware": {
    "pico_present": true,
    "cameras_detected": 5,
    "gps_module": "u-blox NEO-M9N"
  }
}
```

### Telemetry push (batched)
```json
POST /api/vector/telemetry
X-Unit-Token: ...
{
  "unit_id": "RV-A1B2C3D4-9F2E",
  "snapshots": [
    {
      "timestamp": "2026-05-30T14:05:00Z",
      "session_id": "sess-...",
      "lat": 35.123456,
      "lng": -84.567890,
      "heading_deg": 87.3,
      "speed_kmh": 4.2,
      "battery_v": 12.4,
      "battery_pct": 78,
      "fuel_pct": 65,
      "engine_rpm": 2800,
      "temp_c": 78,
      "operating_mode": "AUTO",
      "progress_pct": 34.2,
      "active_faults": [],
      "connectivity_tier": "internet"
    }
  ]
}
```

### Command issued (UI → server)
```json
POST /api/vector/units/RV-A1B2C3D4-9F2E/command
Authorization: Bearer <jwt>
{
  "action": "mow_start",
  "params": {"program_id": "prog_front_weekly"},
  "idempotency_key": "ui-2026-05-30T14:00:00Z"
}
```

### Long-poll command delivery
```json
GET /api/vector/command/stream/RV-A1B2C3D4-9F2E
X-Unit-Token: ...

(server holds 0-30s, then:)
200 OK
X-Config-Version: 42
{
  "command_id": "cmd-3f1a-...",
  "action": "mow_start",
  "params": {"program_id": "prog_front_weekly"},
  "issued_at": "2026-05-30T14:00:00Z",
  "ttl_seconds": 30
}
```

---

## Appendix C — Implementation Order

**Phase 1 — Device foundations (Claude)**
1. Bootstrap rework (§13.1) + filesystem paths (§13.14).
2. Identity module (§13.2).
3. WiFi network manager (uses pre-agreed SSID list).
4. Auth header in api_client (§13.8).

**Phase 2 — Device connectivity (Claude)**
5. config_sync module (§13.5).
6. command_stream module (§13.6).
7. telemetry_thread module (§13.7).
8. main.py refactor (§13.10).

**Phase 3 — Device autonomy adapters (Claude)**
9. hardware_factory refactor (§13.9).
10. interlocks refactor (§13.11).
11. manual_control module (§13.12).
12. teach_mode module (§13.13).

**Phase 4 — Device claim flow (Claude)**
13. mdns_advertise (§13.3).
14. claim_server (§13.4).

**Phase 5 — Device tests + docs (Claude)**
15. Tests (§13.15).
16. README updates (§13.16).
17. **REVIEW POINT**: Claude confirms all device work matches spec; opens for review.

**Phase 6 — Handoff prep**
18. Spec committed to RiverSongAI repo as `docs/RIVER_VECTOR_INTEGRATION_SPEC.md`.
19. Antigravity prompt generated (separate document referencing this spec).

**Phase 7 — Server implementation (Antigravity)**
20. DB schema (§14.1).
21. Route file (§14.2).
22. mDNS listener (§14.3).
23. Scheduler daemon (§14.4).
24. Web Push integration (§14.5).
25. Frontend pages (§14.6).
26. Permission gating (§14.7).
27. Tests + docs (§14.8, §14.9).

**Phase 8 — Integration test (Claude + Antigravity)**
28. Live integration test: real Voyager registers with live River Song. Setup wizard runs. Test commands fire over long-poll. Telemetry visible in UI. Boundary teach mode tested. E-stop tested.

---

**End of specification.**
