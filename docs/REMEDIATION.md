# Antigravity Remediation — RiverSongAI §14 Implementation

**You declared "complete" on commit `64e9b21`, but a code review against `docs/RIVER_VECTOR_INTEGRATION_SPEC.md` found ~70% of §14 is unimplemented or incorrect.** This document specifies exactly what's missing, what's wrong, and what to do about it. The schema and daemons are good and should be left alone. Most of the gap is in the API surface and the frontend.

You are NOT done until every item in the **Verification Gates** section at the bottom passes by direct test. Do not push to GitHub and announce "done" until you have personally executed each gate and recorded the result.

---

## Read this first

1. Re-read `docs/RIVER_VECTOR_INTEGRATION_SPEC.md` — full document, not just §14.
2. Re-read `docs/ANTIGRAVITY_HANDOFF.md` — the original scope brief.
3. Read `api/routes/vector_fleet.py` as it stands today — confirm you understand what is present vs. missing.
4. Read `frontend/src/pages/fleet/*.jsx` — confirm that five of seven pages are 4–6 line stubs.
5. Compare against the **CRITICAL** and **HIGH** sections below.

---

## What's correct — DO NOT TOUCH

These pieces are solid. Do not modify them except as required for new endpoints to consume them:

- `providers/memory/sqlite_store.py` — the 10 `vector_*` tables, indexes, migrations, and existing CRUD methods. Add new methods as needed; do not refactor what's there.
- `daemons/vector_discovery/listener.py` — mDNS listener.
- `daemons/vector_scheduler/scheduler.py` — cron firing, idempotency, telemetry pruning.
- JWT + role gating pattern via `require_role()`.
- `X-Unit-Token` verification helper `_verify_unit_token()`.
- Long-poll asyncio.Event mechanism (the **mechanism** is right; the response shape is wrong — see CRITICAL #3).
- The spec committed at `docs/RIVER_VECTOR_INTEGRATION_SPEC.md`.
- `requirements.txt` additions of `zeroconf` and `croniter` (remove `pyproj` — it's device-side only).

---

## CRITICAL — Showstoppers. Fix these first.

### C1. Implement `GET /api/vector/config/{unit_id}`

**Status:** Missing entirely. **This is the single most important endpoint in the spec.**

The device's `config_sync.pull()` calls this on boot, every config-version bump, and as the source of truth for hardware config, safety floors, assigned program, and zones. Without it, no device can operate.

**Spec reference:** §6.1 (table), §6.4 (response schema).

**Implementation:**
- Path: `GET /api/vector/config/{unit_id}`
- Auth: `X-Unit-Token` (device-facing).
- Response body shape — verbatim from spec §6.4:
  ```json
  {
    "unit_id": "...",
    "name": "...",
    "config_version": 42,
    "hardware": { /* from vector_units.hardware */ },
    "safety_floors": { /* from vector_units.safety_floors */ },
    "home_position": { /* from vector_units.home_position */ },
    "assigned_program": {
      "program_id": "...",
      "name": "...",
      "pattern": "...",
      "direction_deg": 45,
      "overlap_pct": 10,
      "obstacle_clearance_m": 0.30,
      "edge_distance_m": 0.15,
      "speed_profile": "normal",
      "zones": [
        { "zone_id": "...", "name": "...", "boundary": [...], "no_go_areas": [...], "area_sqm": 412.5 }
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
- `config_version` reads from `vector_config_revisions.revision` (initialize the row to 1 on unit creation if absent).
- `assigned_program` is `null` if no program is assigned to the unit.
- `zones` array is fully expanded from `vector_zones` joined through the program's `zone_ids` JSON array (preserve order).
- Set response header `X-Config-Version: <int>`.

### C2. Fix telemetry payload shape — accept batches

**Status:** `POST /api/vector/telemetry` accepts one flat snapshot. Device sends a batch wrapped in `snapshots`. Every device push currently 422s.

**Spec reference:** §6.1, §6.4 example, §13.7. River Vector's `connectivity/telemetry_thread.py` sends:
```json
{ "unit_id": "RV-A1B2C3D4-9F2E", "snapshots": [ { "timestamp": "...", "lat": ..., ... }, ... ] }
```

**Fix:**
- Rename `TelemetryBody` to `TelemetrySnapshot` and represent one snapshot row.
- Add `TelemetryBatchBody`:
  ```python
  class TelemetryBatchBody(BaseModel):
      unit_id: str
      snapshots: List[TelemetrySnapshot]
  ```
- Endpoint accepts `TelemetryBatchBody`, iterates `snapshots`, inserts each.
- Batch size cap: 50 (`HTTPException(413)` if exceeded).
- Each row stored individually in `vector_telemetry`.
- Set the per-unit telemetry event ONCE at the end of the batch.

### C3. Fix long-poll response shape and headers

**Status:** Mechanism is right; response shape is wrong. Device cannot parse current responses.

**Spec reference:** §7 (full implementation pseudocode), §6.4.

**Three changes to `command_stream` endpoint:**
1. **On empty:** return `204 No Content`, not `200` with `{"command": null}`.
2. **On command found:** return the command object **directly** (no wrapping), so the body is exactly:
   ```json
   { "command_id": "...", "action": "...", "params": {...}, "issued_at": "...", "ttl_seconds": 30 }
   ```
3. **Always set `X-Config-Version: <int>` response header.** Pull from `vector_config_revisions.revision` for the unit.
4. **Timeout 30s, not 50s** — match spec §7.

This is the contract River Vector's `connectivity/command_stream.py` parses against. Do not deviate.

### C4. Fix the claim flow — register must not auto-issue tokens

**Status:** `POST /register` (`vector_fleet.py:91-109`) creates a unit and returns a `unit_token` on the very first call, with no claim code verification. **This bypasses the entire mDNS + 6-digit-code handshake mandated by spec §4.1.**

**Spec reference:** §4.1 (Step 0 — Discovery & Claim), §6.1.

**Required redesign:**

1. **`POST /api/vector/register`** — change semantics:
   - If the device is **claimed** (unit exists and has a `unit_token`): require `X-Unit-Token` header, update `last_seen`/`firmware_version`/`connectivity_tier`/`last_ip`/`online=1`, return `200 {"status": "ok"}`. No new token.
   - If the device is **not yet known**: 401. Do **not** auto-create. The unit must be created via the operator-driven claim flow (below).

2. **`POST /api/vector/units/{unit_id}/claim`** — UI-facing, role=admin. Triggered when the operator clicks "Claim" on a discovered unit.
   - Request body: `{ "claim_code": "123456" }`.
   - Look up the device's IP from the mDNS discovery daemon (call its `get_discovered` action).
   - POST to the device's `claim_server` at `http://<device_ip>:8765/verify-claim` with `{ "claim_code": "...", "unit_token": "<freshly-generated 32-byte token, base64>" }`.
   - If the device returns `200 {"status":"claimed"}`, INSERT `vector_units` with `unit_id`, `unit_token`, `registered_at = now`, `claimed_at = now`. Initialize `vector_config_revisions(unit_id, revision=1)`.
   - Return `{"status": "claimed", "unit_id": "..."}` to the UI.
   - On device error/timeout: return `502` and do not persist the token.

3. **`POST /api/vector/units/{unit_id}/claim/verify-response`** — Optional helper if you decide to let the device confirm completion back to the server. Currently the device completes the claim purely on its own response to the server's verify-claim call. You can omit this endpoint if you implement #2 correctly.

### C5. Build the Setup Wizard frontend

**Status:** 6-line stub. **No unit can be configured.**

**Spec reference:** §4.2 (8 steps with exact field lists), §15.3.

**Required:** Multi-step form at `/fleet/units/:id/setup`. Each step a discrete screen with Back/Next. Save partial progress to component state so refresh doesn't lose work. On final Save, `PATCH /api/vector/units/{id}` with the full body, then redirect to `/fleet/units/{id}`.

Required steps:

| Step | Fields |
|---|---|
| 1. Identity | `name`, `platform` (riding/robot/push), `timezone` (auto from browser) |
| 2. Drive | `drive.type`, `drive.gears` (if clutch), `drive.max_speed_kmh`, `drive.turn_radius_m`, `drive.speed_control` |
| 3. Deck | `deck.width_inches`, `deck.engagement`, `deck.height_adjustable` |
| 4. Hardware | `cameras.count`/`config[]`, `sensors.gps`, `sensors.imu`, `sensors.obstacle`, `sensors.fuel`, `sensors.temperature`, `sensors.rpm`, `sensors.operator_presence`, `pico_bridge.port`/`baud_rate`. If GPS=`rtk`, also: `rtk.ntrip_host`/`port`/`mountpoint`/`user`/`password`. |
| 5. Power | `power.type`, plus `nominal_voltage_v`/`battery_cells`/`min_voltage_v` (electric) or `min_battery_v` (gas) |
| 6. Safety Floors (collapsible "advanced") | `min_obstacle_clearance_m` (0.10–1.0, default 0.20), `imu_tilt_cutoff_deg` (10–25, default 15), `watchdog_timeout_ms` (250–2000, default 500), `min_battery_v_cutoff`, `operator_presence_required_for_auto` |
| 7. Home Position | Leaflet map click sets `lat`/`lng`, slider/input sets `heading_deg` |
| 8. Review & Save | Display all collected fields, Save button |

On save: bump `vector_config_revisions.revision`. The device picks it up on its next long-poll cycle.

---

## HIGH — Severe gaps but not boot-blocking

### H1. Implement the missing endpoints (full list)

**Device-facing — add:**

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/vector/status` | Body: `{unit_id, operating_mode, session_state}`. Update `vector_units`. Push to SSE subscribers. |
| `POST` | `/api/vector/session/start` | Body: `{unit_id, program_id, config_version, started_at}`. Insert `vector_sessions` row, return `{session_id}`. |
| `POST` | `/api/vector/session/end` | Body: `{unit_id, session_id, ended_at, status, area_mowed_sqm, battery_used_pct, fuel_used_pct, abort_reason}`. Update `vector_sessions`. |
| `POST` | `/api/vector/zones/teach` | Body: `{unit_id, zone_name, waypoints: [...], finalize: bool}`. On `finalize=true`, insert `vector_zones` with `capture_method='taught'` and compute `area_sqm`. Until then, accumulate in an in-memory dict keyed by `(unit_id, zone_name)`. |
| `POST` | `/api/vector/command/{id}/complete` | **Rename existing `/result` to `/complete`** — spec mandates this exact path. Body matches the existing handler. |

**UI-facing — add:**

Units:
- `POST /api/vector/units/{id}/command` — body: `{action, params, idempotency_key?}`. INSERT `vector_commands` with status=pending, ttl_seconds=30, issued_by=user_id. Wake the long-poll: `_get_command_event(unit_id).set()`. Honor idempotency key (unique index).
- `PATCH /api/vector/units/{id}` — body: partial unit dict (`name`, `hardware`, `safety_floors`, `home_position`, etc.). Validate: any program assigned to this unit with `obstacle_clearance_m < new safety_floors.min_obstacle_clearance_m` → 400. Bump `vector_config_revisions.revision`.
- `DELETE /api/vector/units/{id}` — cascade via FK.
- `POST /api/vector/units/{id}/rotate-token` — generate new token, return it.
- `GET /api/vector/units/{id}/telemetry` — paginated, query params `?from=&to=&limit=`. ORDER BY timestamp DESC.
- `GET /api/vector/units/{id}/alerts` — paginated.
- `POST /api/vector/units/{id}/alerts/{alert_id}/ack` — set `acknowledged=1`, `acknowledged_at=now`, `acknowledged_by=user_id`.
- `GET /api/vector/units/{id}/events` — session events.
- `GET /api/vector/units/{id}/sessions` — paginated session history.
- `GET /api/vector/units/{id}/camera/{camera_name}/snapshot` — return latest cached JPEG. For v1, return `404` if no snapshot exists; the device-side stream is out of scope per spec §20.

Zones, Programs, Schedules — add full CRUD (POST, GET-by-id, PATCH, DELETE) for each.
- For `POST /api/vector/programs` and `PATCH`: validate `obstacle_clearance_m >= assigned_unit.safety_floors.min_obstacle_clearance_m`. Reject with 400 on violation.
- For `POST /api/vector/programs/{id}/run`: identical to issuing a `mow_start` command from the UI — insert a `vector_commands` row, wake the long-poll.

Sessions:
- `GET /api/vector/sessions/{id}` — return session row + last 100 events + sampled telemetry (every 30s of session timespan).

### H2. Build the remaining frontend pages

The stub pages (`UnitDetail.jsx`, `Zones.jsx`, `Programs.jsx`, `Schedules.jsx`, `Sessions.jsx`) must be implemented per spec §15.

Each page consumes the endpoints from H1 and existing endpoints. Quick guide:

- **`UnitDetail.jsx`** (§15.2):
  - Tabs: Live | History | Settings | Camera.
  - Live: subscribe to `EventSource('/api/vector/units/{id}/stream')`, render telemetry grid (GPS, battery, fuel, RPM, temp, speed, heading, progress), mode badge, alert feed (last 20 with ack buttons), event timeline. Control panel: Start, Stop, Return Home, E-Stop (red, hold-2s-to-confirm in non-emergency), Manual Mode toggle. In Manual Mode: directional pad firing `manual.drive`/`steer`/`brake`/`blades` commands at ~2Hz while held.
  - History: table of sessions, click for detail modal.
  - Settings: edit unit (name, hardware, safety floors, home position), rotate token, delete unit.
  - Camera: if `hardware.cameras.count > 0`, grid of snapshot images auto-refreshing every 5s.

- **`Zones.jsx`** (§15.4):
  - Leaflet map with Esri World Imagery tiles: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`.
  - Toolbar: Draw Zone | Draw No-Go Area | Edit | Delete.
  - Polygon drawing: click to add points, double-click or click first point to close.
  - Selected polygon shows name, area_sqm, capture_method.
  - "Teach Boundary" button: select a unit, fire `teach.start` command. Device's TeachManager handles the rest; UI listens via SSE for waypoint pushes (display live trail).

- **`Programs.jsx`** (§15.5):
  - List of programs with assigned unit + zone names + last run.
  - Create/edit modal: name, zones (multi-select with drag reorder), pattern (radio: stripes/spiral/perimeter_first/checkerboard), direction degrees (visual compass), overlap %, edge distance, obstacle clearance (validation: must be >= unit's safety floor), speed profile (slow/normal/fast), assigned unit.

- **`Schedules.jsx`** (§15.6):
  - List of schedules with cron rendered in local time, next run, last run, enabled toggle.
  - Create/edit: program selector, cron picker (with presets like "Every Tuesday 7am"), timezone (default user's browser), missed-run policy (skip/run_once_on_recovery).

- **`Sessions.jsx`** (§15.7):
  - Filterable table: date range, unit, program, status.
  - Click row → detail page with event timeline + telemetry chart (use Chart.js or Recharts — match what's already in the repo).

### H3. Add aggregated SSE for fleet overview

Add `GET /api/vector/units/stream` (UI-facing, role=viewer+). Single SSE endpoint pushing `telemetry` and `status` events for **all** units. Used by `Overview.jsx` to replace the current 5-second polling. Without this, the "live update controls" requirement is unmet.

Refactor `Overview.jsx` to subscribe via EventSource; remove the `setInterval(fetchUnits, 5000)`.

Add a Leaflet map to `Overview.jsx` showing all units as colored markers (color by `operating_mode`: green=AUTO, blue=MANUAL, red=ESTOP, amber=FAULT, grey=IDLE) per spec §15.1.

### H4. Secure `/internal/wake/{unit_id}`

The route at `vector_fleet.py:72-76` has no auth. The scheduler is supposed to call it with `Authorization: Bearer {daemon_internal_secret}` (see `daemons/vector_scheduler/scheduler.py:38`). Add header validation; reject 401 if absent or wrong.

### H5. Drop the unused dependency

Remove `pyproj` from `requirements.txt`. It's device-side only (coordinate projection lives in River Vector). Leaving it in bloats the server install.

---

## MEDIUM

### M1. Tests must cover the verification matrix

Current: 46 lines, 2 functions. Add tests for:

- Long-poll end-to-end: post a command, expect `GET /command/stream/{id}` to return it within 1s with `X-Config-Version` header set; assert 204 on subsequent empty poll.
- Token validation: correct → 200, wrong → 401, missing → 401, mismatched unit → 401.
- Role gates: admin can claim/delete units; operator can issue commands but cannot delete; viewer cannot issue commands; child cannot view (403).
- Idempotency: insert two commands with the same `idempotency_key` for the same unit → second one returns the first one's `command_id`, no duplicate row.
- Telemetry batching: post a 50-row batch, all 50 rows persist; post a 51-row batch → 413.
- Config endpoint: returns 404 for unknown unit, 200 with correct shape for known unit.
- Safety floor validation: PATCH unit lowering `min_obstacle_clearance_m`; programs with stricter values remain valid; programs with looser values are rejected on next save.
- Schedule daemon: insert a schedule with `next_run = now`; assert command row appears within 65s with the right idempotency key.

### M2. Commit the walkthrough.md you claimed to write

You announced "I've detailed everything in the walkthrough.md artifact" in your status message. No such file exists in the repo. Either commit it or correct the announcement next time.

---

## Verification Gates — DO NOT declare "done" until all pass

Execute each gate yourself before pushing the "complete" announcement. Record pass/fail.

1. ☐ **`curl -H "X-Unit-Token: ..." http://localhost:8000/api/vector/config/<unit_id>`** returns 200 with the full body shape from C1, plus `X-Config-Version` header.
2. ☐ **Telemetry batch:** POST `{"unit_id":"...","snapshots":[s1,s2,s3]}` → 200 and 3 rows in `vector_telemetry`.
3. ☐ **Long-poll empty:** GET `/api/vector/command/stream/<unit_id>` with no pending commands → 204 with `X-Config-Version` header.
4. ☐ **Long-poll wake:** POST a command, immediately GET stream → 200 within 200ms, returns command object directly (no `{"command": ...}` wrapper), with `X-Config-Version` header.
5. ☐ **Claim flow:** Register without claim → 401. Run UI claim flow against a sim device on the LAN → unit appears in `vector_units` with valid token.
6. ☐ **Setup Wizard:** Walk through all 8 steps in the browser, save, observe `vector_units` row populated correctly and `vector_config_revisions.revision = 2` (was 1 after claim).
7. ☐ **Zone editor:** Draw a polygon in the browser, save, observe `vector_zones` row with `capture_method='drawn'` and computed `area_sqm > 0`.
8. ☐ **Program clearance validation:** Try to save a program with `obstacle_clearance_m = 0.05` against a unit with `safety_floors.min_obstacle_clearance_m = 0.20` → 400.
9. ☐ **Schedule fires:** Insert a row with `next_run = now()`, wait 65s, observe `vector_commands` row with correct idempotency key, `next_run` advanced.
10. ☐ **Permission gate:** Issue `POST /api/vector/units/{id}/command` with a `child`-role JWT → 403.
11. ☐ **SSE fleet stream:** Open `/api/vector/units/stream` in browser dev tools, fire telemetry from a sim device, see live events appear.
12. ☐ **Internal wake auth:** POST `/api/vector/internal/wake/<id>` without auth header → 401.

When all 12 pass, commit the test report (a markdown file under `docs/REMEDIATION_VERIFICATION.md`) with the curl commands you used and the actual responses, then push.

---

## Sequence

Recommended order:

1. **C1, C2, C3** — these three together unblock all device communication. Get them green first.
2. **C4** — claim flow. Pair with the UI claim button (subset of H2 → `Overview.jsx`).
3. **C5** — Setup Wizard. Without it the system has no way for an operator to configure a claimed unit.
4. **H1** — endpoint volume. Mechanical work.
5. **H2** — remaining frontend pages.
6. **H3, H4, H5** — polish.
7. **M1** — tests proving the above.
8. Run the **Verification Gates**. Fix anything that fails. Repeat until all 12 pass.
9. Commit `docs/REMEDIATION_VERIFICATION.md` with results. Push. Announce.

If any gate is ambiguous, **stop and ask** — do not guess. The spec is authoritative; if it contradicts itself, the contradiction gets fixed in the spec first.

---

## What success looks like

A real Voyager (or sim instance) running River Vector on the LAN can:
1. Boot, broadcast mDNS, be discovered in `/fleet`.
2. Be claimed via the operator entering the 6-digit code.
3. Walk through the Setup Wizard, save config.
4. Pull config via `GET /config/{unit_id}`.
5. Start a mowing session via the UI command button — command arrives at the device within 200ms over long-poll.
6. Push telemetry batches that appear in the live SSE stream visible on `/fleet`.
7. Be stopped via E-stop button (also <200ms).
8. The whole flow happens with no `.json` file edited on the device by hand.

That is the bar. Anything less is not done.
