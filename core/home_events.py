import asyncio
import logging
from typing import Callable, Coroutine, Dict, List, Any

logger = logging.getLogger(__name__)

# Callback takes (entity_id: str, new_state: dict, old_state: dict)
EventCallback = Callable[[str, dict, dict], Coroutine[Any, Any, None]]

class HomeEventBus:
    def __init__(self):
        self._subscribers: List[EventCallback] = []

    def subscribe(self, cb: EventCallback):
        self._subscribers.append(cb)

    def unsubscribe(self, cb: EventCallback):
        if cb in self._subscribers:
            self._subscribers.remove(cb)

    async def emit(self, entity_id: str, new_state: dict, old_state: dict):
        for cb in self._subscribers:
            try:
                await cb(entity_id, new_state, old_state)
            except Exception as e:
                logger.error(f"Error in home event subscriber: {e}")

_bus = HomeEventBus()

def get_home_bus() -> HomeEventBus:
    return _bus
