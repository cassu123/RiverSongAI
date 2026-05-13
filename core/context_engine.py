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
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def is_stale(self, max_age_minutes: int = 30) -> bool:
        return (datetime.now(timezone.utc) - self.last_updated) > timedelta(minutes=max_age_minutes)

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

    async def update_room(self, room: str, persons: int, activity: str = "present"):
        if room not in self._rooms:
            self._rooms[room] = RoomState()
        
        state = self._rooms[room]
        state.persons = persons
        state.activity = activity
        state.last_updated = datetime.now(timezone.utc)
        logger.debug(f"Context updated for room '{room}': {persons} person(s), {activity}")

    async def update_from_ha_sensor(self, entity_id: str, state_val: str, attributes: dict):
        """Processes an update from a Home Assistant sensor/entity."""
        room = self._extract_room(entity_id, attributes)
        if not room:
            return

        if room not in self._rooms:
            self._rooms[room] = RoomState()
        
        rs = self._rooms[room]
        rs.last_updated = datetime.now(timezone.utc)

        if entity_id.startswith("light."):
            rs.lights_on = state_val == "on"
        elif entity_id.startswith("sensor.") and "temperature" in entity_id:
            try:
                rs.temperature = float(state_val)
            except ValueError:
                pass
        elif "occupancy" in entity_id or "motion" in entity_id:
            rs.activity = "active" if state_val in ("on", "detected", "occupied") else "idle"
        
    def _extract_room(self, entity_id: str, attributes: dict) -> Optional[str]:
        """Heuristic to find which room an entity belongs to."""
        # Check area_id or friendly_name if present in attributes
        friendly = attributes.get("friendly_name", "").lower()
        if "living" in friendly or "living" in entity_id: return "living_room"
        if "kitchen" in friendly or "kitchen" in entity_id: return "kitchen"
        if "bedroom" in friendly or "bedroom" in entity_id: return "bedroom"
        if "office" in friendly or "office" in entity_id: return "office"
        if "bathroom" in friendly or "bathroom" in entity_id: return "bathroom"
        return None

    def get_rooms(self) -> Dict[str, dict]:
        return {name: r.to_dict() for name, r in self._rooms.items()}

    def build_context_block(self) -> str:
        """Generates a text block for injection into the system prompt."""
        active_rooms = [
            f"- {name.replace('_', ' ').title()}: {r.persons} person(s) present, {r.activity}. "
            f"Temp: {r.temperature if r.temperature else '??'}°F. Lights: {'On' if r.lights_on else 'Off'}."
            for name, r in self._rooms.items() if not r.is_stale()
        ]
        if not active_rooms:
            return ""
        
        return "\n\nCURRENT PHYSICAL CONTEXT:\n" + "\n".join(active_rooms)
