# providers/smart_home/homeassistant.py
from __future__ import annotations
import logging
import os
import time
import json
import asyncio
from typing import Any, Callable
import httpx

logger = logging.getLogger(__name__)

_BASE = os.getenv("HOME_ASSISTANT_URL", "http://localhost:8123")
_TOKEN = os.getenv("HOME_ASSISTANT_TOKEN", "")
_CACHE_TTL = 30
_cache: dict[str, tuple[Any, float]] = {}


def _client() -> httpx.AsyncClient:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {_TOKEN}"
    }
    return httpx.AsyncClient(base_url=_BASE.rstrip(
        "/") + "/api", headers=headers, timeout=10)


async def _get(path: str, params: dict | None = None) -> Any:
    if not _TOKEN:
        logger.debug("HASS token missing, returning None")
        return None
    key = f"GET {path} {params}"
    if (hit := _cache.get(key)) and time.monotonic() < hit[1]:
        return hit[0]
    async with _client() as c:
        try:
            r = await c.get(path, params=params or {})
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            logger.warning("HASS %s failed: %s", path, exc)
            return None
    _cache[key] = (data, time.monotonic() + _CACHE_TTL)
    return data


async def states() -> list[dict]:
    """Retrieve all entity states."""
    return await _get("/states") or []


async def service_call(domain: str, service: str,
                       entity_id: str, **kwargs) -> bool:
    """Call a service for a specific entity."""
    if not _TOKEN:
        return False
    async with _client() as c:
        try:
            payload = {"entity_id": entity_id, **kwargs}
            r = await c.post(f"/services/{domain}/{service}", json=payload)
            r.raise_for_status()
            return True
        except Exception as exc:
            logger.warning(
                "HASS service call %s.%s failed: %s",
                domain,
                service,
                exc)
            return False


async def subscribe_events(callback: Callable[[dict], Any]):
    """
    Subscribe to HA events via WebSocket.
    This is a long-running task.
    """
    if not _TOKEN:
        logger.warning("HASS token missing, cannot subscribe to events")
        return

    ws_url = _BASE.replace("http", "ws").rstrip("/") + "/api/websocket"

    import websockets
    async for websocket in websockets.connect(ws_url):
        try:
            # 1. Auth
            await websocket.recv()
            await websocket.send(json.dumps({
                "type": "auth",
                "access_token": _TOKEN
            }))

            auth_resp = json.loads(await websocket.recv())
            if auth_resp.get("type") != "auth_ok":
                logger.error("HASS WS auth failed: %s", auth_resp)
                return

            # 2. Subscribe
            await websocket.send(json.dumps({
                "id": 1,
                "type": "subscribe_events",
                "event_type": "state_changed"
            }))

            # 3. Listen
            async for message in websocket:
                data = json.loads(message)
                if data.get("type") == "event":
                    await callback(data["event"])

        except websockets.ConnectionClosed:
            continue
        except Exception as exc:
            logger.error("HASS WS error: %s", exc)
            await asyncio.sleep(5)
