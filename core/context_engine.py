import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class RoomState:
    persons: int = 0
    activity: str = "idle"
    temperature: Optional[float] = None
    lights_on: bool = False
    last_updated: datetime = field(
        default_factory=lambda: datetime.now(
            timezone.utc))

    def is_stale(self, max_age_minutes: int = 30) -> bool:
        return (datetime.now(timezone.utc) -
                self.last_updated) > timedelta(minutes=max_age_minutes)

    def to_dict(self) -> dict:
        return {
            "persons": self.persons,
            "activity": self.activity,
            "temperature": self.temperature,
            "lights_on": self.lights_on,
            "last_updated": self.last_updated.isoformat(),
            "stale": self.is_stale()
        }


class ContextEngine:
    """
    Maintains a live view of the physical environment.
    Updated by Warden (cameras) and Home Assistant (sensors).
    """

    def __init__(self):
        # room_name -> RoomState
        self._rooms: Dict[str, RoomState] = {}

    async def update_room(
        self,
        room: str,
        persons: int,
        activity: str = "present",
        temperature: Optional[float] = None,
        lights_on: bool = False,
    ):
        if room not in self._rooms:
            self._rooms[room] = RoomState()

        state = self._rooms[room]
        state.persons = persons
        state.activity = activity
        if temperature is not None:
            state.temperature = temperature
        state.lights_on = lights_on
        state.last_updated = datetime.now(timezone.utc)
        logger.debug(
            f"Context updated for room '{room}': {persons} person(s), {activity}")

    async def update_from_ha_sensor(
            self, entity_id: str, state_val: str, attributes: dict):
        """Processes an update from a Home Assistant sensor/entity."""
        room = self._extract_room(entity_id, attributes)
        if not room:
            return

        if room not in self._rooms:
            self._rooms[room] = RoomState()

        rs = self._rooms[room]
        rs.last_updated = datetime.now(timezone.utc)

        if entity_id.startswith("light."):
            # We track the number of lights on via a secondary attribute if needed, 
            # but for now, if any light is on, lights_on = True.
            # To count active lights, we'd need to store the state of all lights.
            # We'll use a hack: if it's on, we set it to True.
            # For a proper active lights count, we need to track individual entities.
            if not hasattr(rs, '_entities'):
                rs._entities = {}
            rs._entities[entity_id] = state_val
            
            # Recalculate lights_on
            rs.lights_on = any(v == "on" for k, v in rs._entities.items() if k.startswith("light."))
            
        elif entity_id.startswith("sensor.") and "temperature" in entity_id:
            try:
                rs.temperature = float(state_val)
            except ValueError:
                pass
        elif "occupancy" in entity_id or "motion" in entity_id or "presence" in entity_id:
            if not hasattr(rs, '_entities'):
                rs._entities = {}
            rs._entities[entity_id] = state_val
            
            is_active = any(v in ("on", "detected", "occupied", "home") for k, v in rs._entities.items() if "occupancy" in k or "motion" in k or "presence" in k)
            rs.activity = "active" if is_active else "idle"

    def _extract_room(self, entity_id: str, attributes: dict) -> Optional[str]:
        """Heuristic to find which room an entity belongs to."""
        # Check area_id or friendly_name if present in attributes
        # Now we can just use the DB area if available, but for now fallback to string matching
        # The best way is for `sync.py` to push the area, or we just rely on string matching
        friendly = attributes.get("friendly_name", "").lower()
        if "living" in friendly or "living" in entity_id:
            return "living_room"
        if "kitchen" in friendly or "kitchen" in entity_id:
            return "kitchen"
        if "bedroom" in friendly or "bedroom" in entity_id:
            return "bedroom"
        if "office" in friendly or "office" in entity_id:
            return "office"
        if "bathroom" in friendly or "bathroom" in entity_id:
            return "bathroom"
        if "garage" in friendly or "garage" in entity_id:
            return "garage"
        return None

    def get_rooms(self) -> Dict[str, dict]:
        # Return aggregate view per room
        res = {}
        for name, r in self._rooms.items():
            active_lights = sum(1 for k, v in getattr(r, '_entities', {}).items() if k.startswith("light.") and v == "on")
            d = r.to_dict()
            d["active_lights"] = active_lights
            res[name] = d
        return res

    def build_context_block(self) -> str:
        """Generates a text block for injection into the system prompt."""
        active_rooms = []
        for name, r in self._rooms.items():
            if r.is_stale():
                continue
            active_lights = sum(1 for k, v in getattr(r, '_entities', {}).items() if k.startswith("light.") and v == "on")
            active_rooms.append(
                f"- {name.replace('_', ' ').title()}: {r.persons} person(s) present, {r.activity}. "
                f"Temp: {r.temperature if r.temperature else '??'}°F. Lights: {'On' if r.lights_on else 'Off'} ({active_lights} active)."
            )
        if not active_rooms:
            return ""

        return "\n\nCURRENT PHYSICAL CONTEXT:\n" + "\n".join(active_rooms)
