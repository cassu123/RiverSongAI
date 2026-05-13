import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
import httpx

logger = logging.getLogger(__name__)

class DaemonRegistry:
    """
    Tracks active daemons via their heartbeats.
    Stored on app.state.daemon_registry.
    """
    def __init__(self):
        # name -> {status, last_seen, port}
        self._daemons: Dict[str, Dict[str, Any]] = {}

    def record_heartbeat(self, name: str, port: int, status: str = "alive"):
        """Records a heartbeat from a daemon."""
        self._daemons[name] = {
            "status": status,
            "last_seen": datetime.now(timezone.utc),
            "port": port
        }
        logger.debug(f"Heartbeat recorded for daemon '{name}' on port {port}.")

    def get_all(self) -> Dict[str, Any]:
        """Returns the full registry with 'alive' status calculated."""
        now = datetime.now(timezone.utc)
        result = {}
        for name, data in self._daemons.items():
            entry = data.copy()
            # Convert datetime to ISO string for JSON serialization
            last_seen = entry["last_seen"]
            entry["last_seen"] = last_seen.isoformat()
            # Boolean alive: seen in the last 60 seconds
            entry["alive"] = (now - last_seen) < timedelta(seconds=60)
            result[name] = entry
        return result

    def is_alive(self, name: str, max_age_seconds: int = 60) -> bool:
        """Checks if a specific daemon is currently alive."""
        data = self._daemons.get(name)
        if not data:
            return False
        age = datetime.now(timezone.utc) - data["last_seen"]
        return age < timedelta(seconds=max_age_seconds)

    def get_port(self, name: str) -> Optional[int]:
        """Returns the port for a specific daemon."""
        data = self._daemons.get(name)
        return data["port"] if data else None


async def call_daemon(name: str, action: str, payload: dict = {}) -> dict:
    """
    Module-level helper to call a daemon's internal task endpoint.
    Uses the port from the registry stored in the app state if available.
    """
    from fastapi import FastAPI
    # This assumes we can access the registry. In this context, we need to know the port.
    # Since call_daemon is module-level, we'll try to find the port via the registry.
    # But where does the registry live? It lives in app.state.
    # If this is called from within a FastAPI request, we can get it from request.app.state.
    # If called from a background task, we need the app instance.
    
    # Actually, the prompt says "Looks up port from registry, POSTs...".
    # I'll add a way to pass the registry or app to this if needed, 
    # but for now I'll follow the requested signature.
    # Wait, how does it get the port?
    # Maybe I should use a singleton registry or pass it.
    # Let's re-read: "Looks up port from registry".
    
    # I'll use a hack to find the port if it's not provided, 
    # but usually this will be used where app is available.
    # For now, I'll implement it assuming there's a global app instance 
    # or it's called from where app state is accessible.
    
    # Actually, I'll import get_app from main if Task D is followed.
    try:
        from main import get_app
        app = get_app()
        if not app:
            return {}
        registry = getattr(app.state, "daemon_registry", None)
        if not registry:
            return {}
        port = registry.get_port(name)
        if not port:
            logger.warning(f"Could not find port for daemon '{name}' in registry.")
            return {}

        async with httpx.AsyncClient() as client:
            url = f"http://127.0.0.1:{port}/task"
            resp = await client.post(url, json={"action": action, "payload": payload}, timeout=5.0)
            if resp.status_code == 200:
                return resp.json()
            return {}
    except Exception as e:
        logger.debug(f"Failed to call daemon '{name}': {e}")
        return {}
