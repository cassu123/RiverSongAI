# Context Engine

A live in-memory model of what's happening in the physical environment
— who's in which room, what's active, lights/temperature — used to
inject ambient context into the LLM system prompt.

**File:** `core/context_engine.py`

---

## Status

- ✅ Class implemented; held on `app.state.context_engine` (see
  `main.py`).
- ✅ Manual `update_room()` calls work.
- ✅ Home Assistant sensor ingestion via `update_from_ha_sensor()` with
  room heuristics for `light.*`, `sensor.*_temperature`, occupancy /
  motion sensors.
- ⚠️ Vision-based occupancy updates (Warden YOLO → context) are not
  wired yet (Warden daemon is a stub — see `docs/DAEMONS.md`).

---

## Data model

```python
@dataclass
class RoomState:
    persons: int = 0
    activity: str = "idle"       # "idle" | "present" | "active" | ...
    temperature: float | None    # °F
    lights_on: bool = False
    last_updated: datetime       # auto
```

`RoomState.is_stale(max_age_minutes=30)` returns True when the room
hasn't been updated recently; stale rooms are excluded from the
context block.

---

## Update sources

### Home Assistant sensors

`update_from_ha_sensor(entity_id, state_val, attributes)`:

- `light.<room>_...` → `lights_on = (state == "on")`
- `sensor.<room>_temperature` → `temperature = float(state)`
- entity containing `occupancy` or `motion` → `activity = "active"` if
  state ∈ `{on, detected, occupied}`, else `idle`.

Room is inferred from a heuristic over `entity_id` and the
`friendly_name` attribute (`living_room`, `kitchen`, `bedroom`,
`office`, `bathroom`). Unmatched entities are ignored.

### Manual updates

`update_room(room, persons, activity, temperature, lights_on)` is the
primary API for anything that doesn't fit the HA heuristic — e.g. a
future YOLO-driven occupancy update.

---

## Output for the LLM

`build_context_block() -> str` produces a block like:

```
CURRENT PHYSICAL CONTEXT:
- Living Room: 2 person(s) present, active. Temp: 71.5°F. Lights: On.
- Kitchen: 0 person(s) present, idle. Temp: 68.0°F. Lights: Off.
```

Stale rooms are skipped. The conversation loop prepends this block to
the system prompt when generating responses, giving River Song
situational awareness for replies like *"the living room is warm
enough"* without anyone having to ask explicitly.

If no rooms have recent updates, `build_context_block()` returns the
empty string and no ambient context is injected.

---

## Configuration

No dedicated settings. The engine is always instantiated; its content
depends on whether anything is feeding it (Home Assistant being the
primary source today).
