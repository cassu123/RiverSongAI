# Pixhawk Integration Plan — RiverSongAI × River-Vector × River-Horizon

**Date:** 2026-06-05
**Status:** Plan only — no code written. Awaiting approval before implementation.
**Scope:** Cross-repo. Touches `RiverSongAI` (the brain) and `river-vector` (the mower runtime). `river-horizon` is in scope as a *reference implementation* that already does this end-to-end for drones — we mostly mirror its patterns.

---

## 1. Can we use Pixhawk?

**Yes — and we partially already are.** Pixhawk is an open hardware standard for autopilots, with multiple commercial boards (Cube Orange/+, Pixhawk 6C/6X, Holybro Durandal, Matek H743, etc.) running one of two firmware stacks: **PX4** or **ArduPilot**. For ground vehicles the relevant firmware is **ArduRover** (the ArduPilot variant). It supports skid-steer, Ackermann, walking, and boat hulls, has built-in support for RTK-GPS, EKF3 sensor fusion, mission waypoints, geofence, RC failsafe, and battery failsafe.

The companion-computer protocol is **MAVLink 2** over UART/UDP/TCP. River Song already speaks it:

| Where it already exists | What it does |
|---|---|
| `requirements.txt` | `pymavlink>=2.4.41 # MAVLink telemetry for ArduRover` |
| `daemons/mechanic/mechanic.py` | Async MAVLink loop, parses HEARTBEAT / GPS_RAW_INT / SYS_STATUS / VFR_HUD / MISSION_CURRENT / MISSION_COUNT; sends arm/disarm + set_mode |
| `config/settings.py` | `mavlink_serial_port`, `mavlink_baud_rate`, `mechanic_enabled` |
| `api/routes/rover.py` | `/api/rover/telemetry` + `/api/rover/command` legacy single-rover bridge |
| `river-horizon/flight/mavlink_bridge.py` | Full Pixhawk 6C + pymavlink integration for drones — already shipped |

`river-vector` has **zero** MAVLink references today. Every drive driver (`clutch_drive`, `differential_drive`, `direct_electric_drive`, `hydrostatic_drive`) talks UART to a Pi Pico that handles motor PWM, steering servos, brake servos, gear shifts. GPS is its own `hardware/gps.py::GPSInterface` (NMEA / UBlox / sim).

So the question is not "can we" but **"on which units, and replacing what."**

## 2. Three integration patterns — pick per unit

There are three viable patterns, and they should be **selectable per-unit at setup time** rather than declared globally. The unit-config record already supports `drive_type` as a freely-selected string, so a `"pixhawk_ardurover"` value is additive.

### Pattern A — Pico-only (status quo for Voyager-1, Scout, Ryobi push)
- Pi 5 → UART → Pi Pico → motor drivers / servos.
- River Vector autonomy state machine drives `DriveCommand` straight to a Pico-backed driver.
- GPS via NMEA from a standalone receiver.
- **Strength:** zero new hardware cost; the four drive drivers already exist.
- **Weakness:** no EKF, no RTK, no built-in RC failsafe, no mission engine — every autonomy primitive lives in our Python.

### Pattern B — Pixhawk-as-low-level-autopilot (RECOMMENDED for new builds + Voyager-2)
- Pi 5 → UART → **Pixhawk running ArduRover** → motor outputs.
- River Vector autonomy state machine still owns the **high-level** state (`UNCLAIMED` / `CLAIMING` / `IDLE` / `AUTO` / `TEACH` / `OFFLINE_REPLAY`).
- The Pixhawk owns the **low-level** primitives: PID, EKF, RC override, hardware failsafe, mission waypoint execution.
- Our new driver class `MavlinkDrive(AbstractDriveSystem)` translates `DriveCommand` → MAVLink `MANUAL_CONTROL` / `SET_POSITION_TARGET_LOCAL_NED` / `COMMAND_LONG` (set_mode GUIDED / AUTO / HOLD / RTL).
- GPS arrives via Pixhawk → `GPS_RAW_INT` → wrapped into our `GPSFix` so the rest of navigation/* doesn't change.
- **Strength:** inherits ArduRover's safety floor — RC stick override always works, geofence enforced by autopilot, motor failsafe is hardware-level not Python-level. RTK becomes one-config-line.
- **Weakness:** ~$200 for a Pixhawk 6C + ~$30 for a power module + wiring. We now own a second control surface.

### Pattern C — Pixhawk-direct, no Pico (smallest BOM)
- Pi 5 → UART → Pixhawk → motors. No Pico at all.
- Sensors (ultrasonics, battery, fuel, seat occupancy) move onto Pixhawk auxiliary GPIO / ADC pins.
- **Strength:** one autopilot to maintain, smallest BOM.
- **Weakness:** Pixhawk aux pins are limited; clutch/gear-shift on Voyager-1 is awkward to do without the Pico's bespoke firmware. Pattern C is fine for **purpose-built** robots (Scout-class), not for **retrofitted ICE** mowers (Voyager-1 class).

**Per-unit recommendation:**
- Voyager-1 (existing retrofit, has Pico already): **Pattern A** — leave it alone.
- Voyager-2 (next build): **Pattern B**.
- Scout (new robot platform): **Pattern B or C**, builder's call.
- Ryobi push (electric, simple): **Pattern A** — Pico is sufficient and cheaper.
- Horizon drones: already Pattern B equivalent, leave alone.

## 3. What changes — RiverSongAI side

The brain barely changes. Almost all work lands in `river-vector`. The brain's job is to (a) let the operator pick the drive backend in the setup wizard, (b) accept the same normalized telemetry from every unit, and (c) keep the legacy `/api/rover/*` path working for the existing single-mower until Voyager-1 retires.

| File | Change | Why |
|---|---|---|
| `config/settings.py` | New flag `pixhawk_vector_enabled: bool = False` (default OFF). | Per project guardrails: every new capability flag-gated. |
| `api/routes/vector_fleet.py` | Extend the `drive` field validation on the unit config schema to accept `"mavlink"` alongside the existing four drive types. No new endpoint. | The wizard already POSTs unit config; we're just allowing one more enum value. |
| `frontend/src/pages/fleet/SetupWizard.jsx` | Add `"Pixhawk / ArduRover"` as a fifth drive-system option, with sub-fields for `serial_port` (default `/dev/ttyACM0`) and `baud` (default `115200`). | UX only — no logic change. |
| `frontend/src/pages/fleet/UnitDetail.jsx` | Add a read-only **Autopilot** card that surfaces `firmware_string`, `firmware_version`, `flight_mode`, `gps_fix_type`, `satellites_visible` when the unit reports them. | Lets the operator confirm the Pixhawk is healthy without ssh-ing in. Pixhawk-units only — hide the card otherwise. |
| `daemons/mechanic/mechanic.py` | **No change.** Keep serving the legacy single-rover endpoint until Voyager-1 retires. | Anti-regression. |
| `api/routes/rover.py` | **No change.** Same reason. |
| `docs/CHRONOS.md` or new `docs/PIXHAWK_INTEGRATION_PLAN.md` | This file. | Canonical doc. |
| `tests/test_vector_fleet.py` | Add cases for the new drive-type enum value + the new `autopilot` telemetry block being optional. | Coverage. |

**No new route, no schema migration, no chrome change.** The brain stays additive.

## 4. What changes — river-vector side

This is where the real work lives. The architecture already has the seams; we slot Pixhawk in behind the existing abstractions.

### 4.1 New driver
`hardware/drivers/mavlink_drive.py` implementing `AbstractDriveSystem`:
- `__init__(port, baud, fallback_to_sim=True)` opens a `pymavlink.mavutil.mavlink_connection`, waits for `HEARTBEAT` with a timeout, sets `target_system` / `target_component`.
- `apply(cmd: DriveCommand)`:
  - In **GUIDED** mode, send `SET_POSITION_TARGET_LOCAL_NED` with velocity-only mask using `cmd.throttle_pct → vx`, `cmd.steering_pct → yaw_rate`. Brake = explicit velocity-zero.
  - In **MANUAL** mode (operator joystick passthrough), send `MANUAL_CONTROL` with the same channels.
- `emergency_stop()`:
  - Send `COMMAND_LONG` (id 400) disarm — hardware-level cutoff, not a Python loop.
  - Also push the deck-down + relay-cut commands through the existing Pico bridge if a Pico is also present (Pattern B has both; Pattern C does not).
- `max_speed_kmh`: read from `MAVProxy`-style param `WP_SPEED` once, cache.
- `current_gear`: always 0 (ArduRover has no gears).
- `is_stopped`: derived from `VFR_HUD.groundspeed < 0.1`.

The driver also exposes a `telemetry_snapshot()` method returning a `GPSFix` + battery + mode + heading + speed + mission progress, sourced from the same MAVLink message stream the legacy `mechanic` daemon already parses. **We can lift `_handle_mavlink_msg` from `daemons/mechanic/mechanic.py` almost verbatim** as the reference implementation.

### 4.2 GPS bridge
`hardware/gps_mavlink.py` — a `GPSInterface` subclass that reads `GPS_RAW_INT` from the same shared MAVLink connection (no second serial port). When Pattern B is selected, the operator's `gps_type` config gets implicitly set to `"mavlink"` and standalone GPS hardware is skipped.

### 4.3 Mode mapping
`autonomy/mode_manager.py` already has its own `OperatingMode` enum (`IDLE` / `AUTO` / `MANUAL` / `RETURNING_HOME` / `ESTOP` / `FAULT` / `TEACH` / `OFFLINE_REPLAY`). It must stay authoritative — it's the user-visible state in the River Song UI and the surface that survives a server outage. The MavlinkDrive maps these to ArduRover modes:

| River Vector mode | ArduRover mode |
|---|---|
| `IDLE` | `HOLD` |
| `AUTO` | `AUTO` (if a mission is uploaded) or `GUIDED` (if we're steering velocity directly) |
| `MANUAL` | `MANUAL` |
| `RETURNING_HOME` | `RTL` |
| `ESTOP` | disarm (no Pixhawk mode change needed) |
| `TEACH` | `MANUAL` with our boundary teach overlay reading GPS_RAW_INT |
| `OFFLINE_REPLAY` | unchanged — autopilot keeps last mode |

### 4.4 Safety floor (non-negotiable per River Vector spec)
ArduRover's failsafe is the **second** line of defense, not the only one. Vector's existing `safety/interlocks.py` and `safety/estop.py` keep running. Specifically:
- The hardware E-Stop button **must** still cut motor power independently of MAVLink. ArduRover's disarm is a backup, not the primary cut.
- Pitch / roll limits enforced by Vector's `safety/interlocks.py` MUST still be evaluated against the local IMU snapshot. We treat Pixhawk's `ATTITUDE` message as another input feeding `SensorSnapshot.pitch_deg` / `roll_deg`, but we still apply the floor on our side.
- Geofence is defined in ArduRover's `FENCE_*` params AND in Vector's `navigation/boundary.py`. Both fire; the strictest wins.

### 4.5 Config schema additions
Add to the unit-config bundle the server pushes via `GET /api/vector/config/{unit_id}`:
```json
{
  "drive": {
    "type": "mavlink",
    "mavlink": {
      "port": "/dev/ttyACM0",
      "baud": 115200,
      "min_voltage_v": 22.0,
      "geofence_radius_m": 80,
      "wp_speed_ms": 1.5,
      "use_rtk_required": false
    }
  },
  "gps": { "type": "mavlink" }
}
```
Existing units with `"drive": {"type": "clutch", ...}` keep working unchanged.

### 4.6 Tests
Mirror the pattern in `tests/test_hardware_*` already in river-vector — heavy use of fake bridges. A `FakeMavlinkConnection` that yields scripted messages lets us cover:
- HEARTBEAT → mode parsing
- GPS_RAW_INT → GPSFix population
- SYS_STATUS → battery snapshot
- VFR_HUD → is_stopped behavior
- ESTOP → COMMAND_LONG(400, 0) emitted
- Mode mapping table round-trip
- Reconnection on serial drop (mirrors `mechanic._mavlink_loop`'s outer try/reconnect)

## 5. Sequencing — 3 milestones

### M1 — Spike on the bench (no fleet change)
Goal: prove `MavlinkDrive` works end-to-end against a real Pixhawk on a bench rig, with no River Song server involvement.

- Lift `daemons/mechanic/mechanic.py`'s `_handle_mavlink_msg` into a standalone `hardware/drivers/mavlink_drive.py` inside `river-vector`.
- Wire it to a Pixhawk 6C running ArduRover SITL (software-in-the-loop) — no real motors needed.
- Verify HEARTBEAT, GPS, arm/disarm, GUIDED-mode velocity command.
- Output: working driver + 1 integration test using SITL.
- Risk: ~1 weekend. Pixhawk 6C + SITL is the cheapest validation path.

### M2 — Vector full integration (still flag-gated)
- Add the `"mavlink"` drive-type enum to RiverSongAI's vector_fleet route schema.
- Add Pixhawk option to the SetupWizard.
- Add the Autopilot card to UnitDetail.
- Add Pattern B config schema parsing in river-vector's `core/hardware_factory.py`.
- Wire `gps_mavlink.py` so a Pattern B unit reports GPS through the same MAVLink connection.
- Wire mode-mapping into `mode_manager.py`.
- Settings flag `pixhawk_vector_enabled` flips ON only after M2's verification gate.
- Output: a Voyager-2 prototype claims and operates with Pixhawk-as-driver. Voyager-1 (Pattern A) is untouched.

### M3 — Voyager-1 retirement window (optional, future)
- Once Voyager-2 has a season of operating, decide whether Voyager-1 gets retrofitted to Pattern B or kept on its Pico.
- When Voyager-1 retires from Pattern A, **only then** delete `daemons/mechanic/mechanic.py` and `api/routes/rover.py`. Until then, both stacks coexist (they don't conflict — different units, different routes).
- Output: the legacy single-rover path is sunset cleanly.

## 6. Risks & open questions

1. **Two state machines.** Vector's `OperatingMode` and ArduRover's flight mode can disagree. The mapping table in §4.3 must be the single source of truth, and every transition has to set both sides atomically. There's a real risk of "Vector thinks AUTO, ArduRover thinks MANUAL" if a command drops. Mitigation: every mode change validates against `HEARTBEAT.custom_mode` on the next tick; mismatch trips FAULT.
2. **Drive resolution loss.** `MANUAL_CONTROL` quantizes throttle/steering to int16 (-1000..+1000) which is finer than our 0–100 percent, so no loss. **However** `GUIDED` velocity-target uses m/s, so steering as yaw_rate (rad/s) needs a per-platform calibration (`steering_pct=100 → yaw_rate ?`). This calibration becomes a setup-wizard step.
3. **Clutch transmission incompatibility.** Pattern B can't drive a Voyager-1 clutch — the clutch firmware lives on the Pico. If we ever retrofit Voyager-1 to Pixhawk we'd lose the clutch unless we run **both** Pixhawk (for steering + throttle) and Pico (for clutch + gear shift), in which case `MavlinkDrive.apply` would also fan out to the Pico for the gear-shift channel. Decision deferred to M3.
4. **RTK requirement.** ArduRover's `AUTO` mission mode is mediocre without RTK GPS (<10cm accuracy). A plain u-blox NEO-M9N gives ~1m accuracy, which is fine for boundary-following but jittery for stripe patterns. Recommendation: budget for an RTK base station (Ardusimple SimpleRTK2B kit, ~$300) before declaring "Pattern B autonomy production-ready."
5. **MCP exposure.** Per the merge plan's safety-excluded list, `control_device`, `create_commerce_sale`, `trigger_n8n_workflow` are excluded from MCP. Any new "send MAVLink command" tool MUST land on the same exclusion list — autopilot commands are at least as sensitive as rover commands. Adding to `mcp_server.py::EXPOSED_TOOL_NAMES` exclusion needs to happen alongside the route.
6. **Horizon convergence.** `river-horizon` has already solved most of this for drones (its `flight/mavlink_bridge.py`, `safety/geofence.py`, `safety/signal_watchdog.py`). It is **tempting** to factor a shared `river-mavlink` package both Vector and Horizon depend on. **Don't do this yet.** Cross-repo Python deps add release coordination cost we don't need. Instead: copy the patterns, let both repos evolve independently for at least one season, then extract a shared lib *if* the duplication actually hurts.

## 7. Cost picture (per unit, retail USD, mid-2026)

| Pattern | New hardware over baseline | Notes |
|---|---|---|
| A (Pico) | $0 | Already built. |
| B (Pixhawk + Pico) | ~$240 | Pixhawk 6C ($200) + power module ($30) + wiring ($10). Pico stays. |
| B+RTK | ~$540 | Add SimpleRTK2B base+rover kit (~$300) if RTK accuracy is required. |
| C (Pixhawk only) | ~$240 | Same hardware as B; saves Pico cost on new builds (~$25). |

## 8. What we are explicitly NOT doing in this plan

- **No ROS / MAVROS.** That stack adds an OS-level dep tree (Ubuntu 22.04 + ros-humble) River Song doesn't want. `pymavlink` direct is the right abstraction level for our needs.
- **No QGroundControl as a runtime dep.** QGC is a manual tuning tool, not part of our deployment surface. It can be used by the operator at calibration time.
- **No swap of Horizon's existing implementation.** Horizon's `mavlink_bridge.py` is already correct for drones; this plan does not refactor it.
- **No Vector-side replacement of Pico-based drivers.** All four existing drive types stay supported. Pattern A remains a first-class deployment option.
- **No new MCP tool that issues autopilot commands** in the same patch series. That's a separate decision, with the same safety-excluded list considerations as the rover/commerce/n8n tools.

## 9. Approval checklist before any code is written

- [ ] User picks initial target platform (Voyager-2 build vs. Scout vs. retrofit Voyager-1).
- [ ] User confirms whether RTK GPS is in budget for M2 or deferred.
- [ ] User confirms Pattern B (recommended) vs. Pattern C for the chosen platform.
- [ ] User confirms `pixhawk_vector_enabled` flag default stays OFF until M2 verification gate is green.
- [ ] User confirms legacy `/api/rover/*` + `mechanic` daemon stay live until M3.
