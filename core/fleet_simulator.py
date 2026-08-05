"""
core/fleet_simulator.py

In-process device simulator for the generic fleet programs (Horizon, Kova,
Sentinel, Vortex, Vexa). Lets an admin spin up a fake unit from the UI and
watch it come online, stream live telemetry, and obey queued commands —
end-to-end working without physical hardware.

Each simulated unit runs as one asyncio task that, every ~2 seconds:
  1. drains pending commands from fleet_commands and applies them to its state
  2. advances its physics one tick and inserts a telemetry snapshot
  3. refreshes last_seen / online
  4. emits a low-battery alert once when it crosses the threshold

The per-program behaviour lives in PROFILES. Each profile is three pure
functions — init() -> state, step(state) -> snapshot, command(state, cmd,
params) -> None — so they can be unit-tested directly without the loop.

DB writes go straight through SQLiteStore (no HTTP hop). For testing against a
real network instead, use scripts/fleet_sim.py, which drives the HTTP device
endpoints with the same PROFILES.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from datetime import datetime, timezone
from typing import Any, Callable, Dict

from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

_TICK_SECONDS = 2.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _drift(value: float, target: float, rate: float) -> float:
    """Move value toward target by at most `rate`."""
    if value < target:
        return min(target, value + rate)
    if value > target:
        return max(target, value - rate)
    return value


# ---------------------------------------------------------------------------
# Per-program profiles
# ---------------------------------------------------------------------------
# A profile is a dict: {"init": fn, "step": fn, "command": fn}.
#   init() -> dict (mutable state)
#   step(state) -> dict (telemetry snapshot; also mutates state)
#   command(state, command: str, params: dict) -> None (mutates state)

# ----- Horizon (drones) -----

def _horizon_init() -> Dict[str, Any]:
    return {"altitude_m": 0.0, "target_alt": 0.0, "battery_pct": 100.0,
            "mode": "idle", "lat": 40.0581, "lng": -82.9988, "speed_mps": 0.0}


def _horizon_step(s: Dict[str, Any]) -> Dict[str, Any]:
    s["altitude_m"] = round(_drift(s["altitude_m"], s["target_alt"], 4.0), 1)
    flying = s["mode"] in ("flying", "orbit", "returning", "landing")
    s["speed_mps"] = round(random.uniform(3, 8), 1) if s["mode"] in ("flying", "orbit") else 0.0
    if s["mode"] in ("returning", "landing") and s["altitude_m"] <= 0:
        s["mode"] = "idle"
    if s["mode"] == "orbit":
        s["lat"] += random.uniform(-0.0002, 0.0002)
        s["lng"] += random.uniform(-0.0002, 0.0002)
    s["battery_pct"] = round(max(0.0, s["battery_pct"] - (0.4 if flying else 0.05)), 1)
    return {"altitude_m": s["altitude_m"], "battery_pct": s["battery_pct"],
            "mode": s["mode"], "speed_mps": s["speed_mps"],
            "lat": round(s["lat"], 5), "lng": round(s["lng"], 5)}


def _horizon_command(s: Dict[str, Any], cmd: str, params: Dict[str, Any]) -> None:
    if cmd == "takeoff":
        s["target_alt"] = float(params.get("altitude", 30)); s["mode"] = "flying"
    elif cmd in ("land",):
        s["target_alt"] = 0.0; s["mode"] = "landing"
    elif cmd in ("rth", "return_home"):
        s["target_alt"] = 0.0; s["mode"] = "returning"
    elif cmd == "orbit":
        s["mode"] = "orbit"
    elif cmd in ("estop", "hold"):
        s["target_alt"] = s["altitude_m"]; s["mode"] = "hold"


# ----- Vexa (autonomous vehicles) -----

def _vexa_init() -> Dict[str, Any]:
    return {"speed_kph": 0.0, "target_speed": 0.0, "battery_pct": 100.0,
            "locked": True, "gear": "P", "mode": "parked",
            "lat": 40.0581, "lng": -82.9988, "odometer_km": 1284.0}


def _vexa_step(s: Dict[str, Any]) -> Dict[str, Any]:
    s["speed_kph"] = round(_drift(s["speed_kph"], s["target_speed"], 8.0), 1)
    moving = s["speed_kph"] > 0.1
    s["gear"] = "D" if moving else "P"
    if moving:
        s["odometer_km"] = round(s["odometer_km"] + s["speed_kph"] * _TICK_SECONDS / 3600, 3)
        s["lat"] += random.uniform(-0.0003, 0.0003)
        s["lng"] += random.uniform(-0.0003, 0.0003)
    elif s["mode"] in ("returning",) and s["target_speed"] == 0:
        s["mode"] = "parked"
    s["battery_pct"] = round(max(0.0, s["battery_pct"] - (0.3 if moving else 0.02)), 1)
    return {"speed_kph": s["speed_kph"], "battery_pct": s["battery_pct"],
            "locked": s["locked"], "gear": s["gear"], "mode": s["mode"],
            "lat": round(s["lat"], 5), "lng": round(s["lng"], 5),
            "odometer_km": s["odometer_km"]}


def _vexa_command(s: Dict[str, Any], cmd: str, params: Dict[str, Any]) -> None:
    if cmd == "lock":
        s["locked"] = True
    elif cmd == "unlock":
        s["locked"] = False
    elif cmd == "summon":
        s["target_speed"] = float(params.get("speed", 30)); s["mode"] = "summoning"; s["locked"] = False
    elif cmd in ("return", "return_home"):
        s["target_speed"] = float(params.get("speed", 30)); s["mode"] = "returning"
    elif cmd == "stop":
        s["target_speed"] = 0.0; s["mode"] = "parked"


# ----- Kova (chore robots) -----

_KOVA_ROOMS = ["living_room", "kitchen", "hallway", "bedroom", "office"]


def _kova_init() -> Dict[str, Any]:
    return {"battery_pct": 100.0, "current_chore": "idle", "room": "dock",
            "docked": True, "progress_pct": 0}


def _kova_step(s: Dict[str, Any]) -> Dict[str, Any]:
    if not s["docked"] and s["current_chore"] not in ("idle", "paused"):
        s["progress_pct"] = min(100, s["progress_pct"] + 6)
        s["battery_pct"] = round(max(0.0, s["battery_pct"] - 0.4), 1)
        if s["progress_pct"] >= 100:
            s["current_chore"] = "idle"; s["docked"] = True; s["room"] = "dock"
    else:
        # charging on dock
        if s["docked"]:
            s["battery_pct"] = round(min(100.0, s["battery_pct"] + 0.5), 1)
    return {"battery_pct": s["battery_pct"], "current_chore": s["current_chore"],
            "room": s["room"], "docked": s["docked"], "progress_pct": s["progress_pct"]}


def _kova_command(s: Dict[str, Any], cmd: str, params: Dict[str, Any]) -> None:
    if cmd == "start_chore":
        s["current_chore"] = params.get("chore", "vacuum")
        s["room"] = params.get("room", random.choice(_KOVA_ROOMS))
        s["docked"] = False; s["progress_pct"] = 0
    elif cmd == "pause":
        s["current_chore"] = "paused"
    elif cmd == "resume":
        if s["current_chore"] == "paused":
            s["current_chore"] = params.get("chore", "vacuum")
    elif cmd == "dock":
        s["current_chore"] = "idle"; s["docked"] = True; s["room"] = "dock"; s["progress_pct"] = 0


# ----- Vortex (home hubs) -----

def _vortex_init() -> Dict[str, Any]:
    return {"cpu_pct": 12.0, "mem_pct": 41.0, "connected_devices": 7,
            "casting": False, "cast_target": None, "uptime_s": 0}


def _vortex_step(s: Dict[str, Any]) -> Dict[str, Any]:
    s["uptime_s"] += int(_TICK_SECONDS)
    base = 30 if s["casting"] else 12
    s["cpu_pct"] = round(min(100.0, max(4.0, base + random.uniform(-6, 18))), 1)
    s["mem_pct"] = round(_drift(s["mem_pct"], 55 if s["casting"] else 41,
                                random.uniform(0, 3)), 1)
    return {"cpu_pct": s["cpu_pct"], "mem_pct": s["mem_pct"],
            "connected_devices": s["connected_devices"], "casting": s["casting"],
            "cast_target": s["cast_target"], "uptime_s": s["uptime_s"]}


def _vortex_command(s: Dict[str, Any], cmd: str, params: Dict[str, Any]) -> None:
    if cmd == "cast":
        s["casting"] = True; s["cast_target"] = params.get("target", "Living Room TV")
    elif cmd in ("stop_cast", "stop"):
        s["casting"] = False; s["cast_target"] = None
    elif cmd == "restart":
        s["uptime_s"] = 0; s["casting"] = False; s["cast_target"] = None
    elif cmd == "run_scene":
        s["connected_devices"] = max(0, int(params.get("devices", s["connected_devices"])))


# ----- Sentinel (patrol robot dogs) -----

def _sentinel_init() -> Dict[str, Any]:
    return {"battery_pct": 100.0, "posture": "stand", "patrolling": False,
            "waypoint": 0, "lat": 40.0581, "lng": -82.9988}


def _sentinel_step(s: Dict[str, Any]) -> Dict[str, Any]:
    if s["patrolling"]:
        s["waypoint"] = (s["waypoint"] + 1) % 8
        s["lat"] += random.uniform(-0.0001, 0.0001)
        s["lng"] += random.uniform(-0.0001, 0.0001)
        s["battery_pct"] = round(max(0.0, s["battery_pct"] - 0.3), 1)
    else:
        s["battery_pct"] = round(max(0.0, s["battery_pct"] - 0.03), 1)
    return {"battery_pct": s["battery_pct"], "posture": s["posture"],
            "patrolling": s["patrolling"], "waypoint": s["waypoint"],
            "lat": round(s["lat"], 5), "lng": round(s["lng"], 5)}


def _sentinel_command(s: Dict[str, Any], cmd: str, params: Dict[str, Any]) -> None:
    if cmd == "patrol":
        s["patrolling"] = True; s["posture"] = "walk"
    elif cmd in ("return", "return_home"):
        s["patrolling"] = False; s["posture"] = "stand"
    elif cmd == "sit":
        s["posture"] = "sit"; s["patrolling"] = False
    elif cmd == "stand":
        s["posture"] = "stand"
    elif cmd in ("estop", "down"):
        s["patrolling"] = False; s["posture"] = "down"


PROFILES: Dict[str, Dict[str, Callable]] = {
    "horizon": {"init": _horizon_init, "step": _horizon_step, "command": _horizon_command},
    "vexa": {"init": _vexa_init, "step": _vexa_step, "command": _vexa_command},
    "kova": {"init": _kova_init, "step": _kova_step, "command": _kova_command},
    "vortex": {"init": _vortex_init, "step": _vortex_step, "command": _vortex_command},
    "sentinel": {"init": _sentinel_init, "step": _sentinel_step, "command": _sentinel_command},
}


def _profile_for(program: str) -> Dict[str, Callable]:
    # Unknown programs get a minimal generic heartbeat profile.
    return PROFILES.get(program, {
        "init": lambda: {"battery_pct": 100.0, "status": "ok"},
        "step": lambda s: {"battery_pct": round(max(0.0, s["battery_pct"] - 0.05), 1),
                           "status": s["status"]},
        "command": lambda s, c, p: s.__setitem__("status", c or "ok"),
    })


# ---------------------------------------------------------------------------
# Simulated unit task + registry
# ---------------------------------------------------------------------------

class SimUnit:
    def __init__(self, program: str, unit_id: str) -> None:
        self.program = program
        self.unit_id = unit_id
        self.profile = _profile_for(program)
        self.state = self.profile["init"]()
        self._low_warned = False
        self.task: asyncio.Task | None = None

    async def _run(self) -> None:
        store = SQLiteStore()
        try:
            while True:
                # 1. Apply any pending commands and mark them completed.
                pending = await store.execute_read_async(
                    "SELECT command_id, payload FROM fleet_commands "
                    "WHERE program=? AND unit_id=? AND status='pending' "
                    "ORDER BY issued_at ASC",
                    (self.program, self.unit_id),
                )
                for row in pending:
                    try:
                        payload = json.loads(row["payload"])
                        self.profile["command"](
                            self.state, payload.get("command", ""),
                            payload.get("params") or {})
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("sim command error: %s", exc)
                    await store.execute_write_async(
                        "UPDATE fleet_commands SET status='completed', updated_at=? "
                        "WHERE command_id=?",
                        (_now(), row["command_id"]),
                    )

                # 2. Advance physics + record telemetry.
                snap = self.profile["step"](self.state)
                ts = _now()
                snap["timestamp"] = ts
                await store.execute_write_async(
                    "INSERT INTO fleet_telemetry (program, unit_id, timestamp, payload) "
                    "VALUES (?, ?, ?, ?)",
                    (self.program, self.unit_id, ts, json.dumps(snap)),
                )
                await store.execute_write_async(
                    "UPDATE fleet_units SET online=1, last_seen=? "
                    "WHERE program=? AND unit_id=?",
                    (ts, self.program, self.unit_id),
                )

                # 3. One-shot low-battery alert.
                batt = self.state.get("battery_pct", 100)
                if batt is not None and batt < 20 and not self._low_warned:
                    self._low_warned = True
                    await store.execute_write_async(
                        "INSERT INTO fleet_alerts (program, unit_id, timestamp, level, message) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (self.program, self.unit_id, _now(), "warning",
                         f"Battery low ({batt}%) — returning to base recommended"),
                    )

                await asyncio.sleep(_TICK_SECONDS)
        except asyncio.CancelledError:
            # Mark offline on stop so the UI reflects reality.
            try:
                await store.execute_write_async(
                    "UPDATE fleet_units SET online=0 WHERE program=? AND unit_id=?",
                    (self.program, self.unit_id),
                )
            except Exception:  # noqa: BLE001
                pass
            raise


_sims: Dict[str, SimUnit] = {}


async def start_sim(program: str, unit_id: str) -> None:
    """Start (or restart) a simulated unit task."""
    await stop_sim(unit_id)
    sim = SimUnit(program, unit_id)
    sim.task = asyncio.create_task(sim._run())
    _sims[unit_id] = sim
    logger.info("Simulator started: %s/%s", program, unit_id)


async def stop_sim(unit_id: str) -> bool:
    """Stop a simulated unit if running. Returns True if one was stopped."""
    sim = _sims.pop(unit_id, None)
    if not sim or not sim.task:
        return False
    sim.task.cancel()
    try:
        await sim.task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass
    logger.info("Simulator stopped: %s", unit_id)
    return True


def list_sims() -> Dict[str, str]:
    """Map of running unit_id -> program."""
    return {uid: sim.program for uid, sim in _sims.items()}


async def stop_all() -> None:
    for unit_id in list(_sims.keys()):
        await stop_sim(unit_id)
