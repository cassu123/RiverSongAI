"""
core/vortex_calls_ws.py

The phone app's end of the intercom.

Vortex units already hold an authenticated socket at `/api/vortex/ws`, so
their signalling rides on that. The phone app and the browser need an
equivalent, and this is it — the registry addresses both the same way
(`unit:<id>` / `user:<id>`) and does not care which is on the other end.

A user may have several of these open at once: phone, tablet, a browser tab.
All of them ring, and the first to answer takes the call. That is what an
intercom does — you pick up wherever you are.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Set

from core.vortex_security import LoopLock

logger = logging.getLogger(__name__)

# user_id -> the sockets that user currently has open
_sockets: Dict[str, Set[Any]] = {}
_lock = LoopLock()


async def register(user_id: str, websocket: Any) -> None:
    async with _lock:
        _sockets.setdefault(user_id, set()).add(websocket)
    logger.info("Call channel open for user %s (%d device(s)).",
                user_id, len(_sockets.get(user_id, ())))


async def unregister(user_id: str, websocket: Any) -> bool:
    """
    Drop one socket. Returns True when that was the user's last one.

    The caller uses that to decide whether to end an in-progress call: closing
    one of three tabs should not hang up on anybody.
    """
    async with _lock:
        bucket = _sockets.get(user_id)
        if not bucket:
            return False
        bucket.discard(websocket)
        if bucket:
            return False
        _sockets.pop(user_id, None)
    logger.info("Call channel closed for user %s.", user_id)
    return True


def is_connected(user_id: str) -> bool:
    return bool(_sockets.get(user_id))


def connected_users() -> List[str]:
    return list(_sockets)


async def send_to_user(user_id: str, frame: Dict[str, Any]) -> bool:
    """
    Deliver a frame to every device this user has open.

    Returns True if it reached at least one. Fan-out rather than pick-one:
    the phone in a pocket and the tablet on the counter should both ring, and
    a `call_end` has to reach the ones that did not answer or they keep
    ringing at an empty call.
    """
    sockets = list(_sockets.get(user_id, ()))
    if not sockets:
        return False

    delivered = 0
    dead: List[Any] = []
    for socket in sockets:
        try:
            await socket.send_json(frame)
            delivered += 1
        except Exception:
            dead.append(socket)

    for socket in dead:
        await unregister(user_id, socket)
    return delivered > 0


async def reset() -> None:
    """Drop every socket. Test helper."""
    async with _lock:
        _sockets.clear()
