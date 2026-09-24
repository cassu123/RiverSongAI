"""
The voice socket's interrupt stops the whole turn, spoken or typed.

Drives the real /ws/conversation route with a stand-in ConversationLoop whose
turns are slow (as on a small GPU). Before TurnRunner, a typed turn blocked
the socket's receive loop, so an interrupt was only read after the reply had
finished; and a spoken turn kept going past an interrupt sent during
transcription.
"""
import asyncio
import sys
import time
import types

import pytest

# Load only the conversation route. api/routes/__init__.py imports every
# route module and with them every provider SDK; this test needs none of
# them, and not all of them install everywhere.
_ROOT = __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__)))
for _name, _path in (("api.routes", "api/routes"), ("api.routes.ai", "api/routes/ai")):
    if _name not in sys.modules:
        _pkg = types.ModuleType(_name)
        _pkg.__path__ = [__import__("os").path.join(_ROOT, _path)]
        sys.modules[_name] = _pkg

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api.routes.ai.conversation as conversation  # noqa: E402

SLOW = 1.5   # seconds a turn takes if nobody stops it


class SlowLoop:
    """Stands in for ConversationLoop: every turn takes SLOW seconds."""
    finished = []

    def __init__(self, **kwargs):
        self._session_id = None
        self._web_search = False

    async def initialize(self):
        pass

    async def run_startup_briefing(self, on_event):
        pass

    def cancel_generation(self):
        pass

    async def reset_history(self, **kwargs):
        pass

    async def run_text(self, text, on_event, speak=None):
        await on_event({"type": "thinking"})
        await asyncio.sleep(SLOW)
        SlowLoop.finished.append("typed")
        await on_event({"type": "response_complete", "text": "the answer"})
        await on_event({"type": "idle"})

    async def run_once(self, audio_bytes, on_event):
        await on_event({"type": "transcribing"})
        await asyncio.sleep(SLOW)             # still transcribing when stopped
        SlowLoop.finished.append("spoken")
        await on_event({"type": "response_complete", "text": "the answer"})
        await on_event({"type": "idle"})


class NoWake:
    def __init__(self, **kwargs):
        pass


@pytest.fixture
def client(monkeypatch):
    SlowLoop.finished = []
    monkeypatch.setattr(conversation, "ConversationLoop", SlowLoop)
    monkeypatch.setattr(conversation, "WakeWordService", NoWake)
    app = FastAPI()
    app.include_router(conversation.router)
    app.state.ws_tickets = {"t": {"user_id": "u1", "expires_at": time.time() + 60}}
    app.state.active_connections = {}
    return TestClient(app)


def _until(ws, wanted):
    seen = []
    while True:
        msg = ws.receive_json()
        seen.append(msg.get("type"))
        if msg.get("type") == wanted:
            return seen


def test_stop_during_a_typed_reply_stops_it(client):
    with client.websocket_connect("/ws/conversation?ticket=t") as ws:
        _until(ws, "idle")                          # connected and ready
        ws.send_json({"type": "text_input", "text": "hello"})
        _until(ws, "thinking")
        t0 = time.time()
        ws.send_json({"type": "interrupt"})
        seen = _until(ws, "idle")
        waited = time.time() - t0
        time.sleep(SLOW + 0.3)                      # connection still open
        finished = list(SlowLoop.finished)
    assert "response_complete" not in seen          # no answer after the stop
    assert waited < SLOW / 2                        # stopped now, not after the reply
    assert finished == []                           # and the turn never finished


def test_stop_during_transcription_stops_the_spoken_turn(client):
    with client.websocket_connect("/ws/conversation?ticket=t") as ws:
        _until(ws, "idle")
        ws.send_json({"type": "start"})
        _until(ws, "listening")
        ws.send_bytes(b"\x00\x01" * 800)
        _until(ws, "transcribing")
        ws.send_json({"type": "interrupt"})
        seen = _until(ws, "idle")
        time.sleep(SLOW + 0.3)                      # connection still open
        finished = list(SlowLoop.finished)
    assert "response_complete" not in seen
    assert finished == []                           # transcription never went on to answer


def test_a_turn_nobody_stops_still_finishes(client):
    with client.websocket_connect("/ws/conversation?ticket=t") as ws:
        _until(ws, "idle")
        ws.send_json({"type": "text_input", "text": "hello"})
        seen = _until(ws, "response_complete")
    assert "thinking" in seen
    assert SlowLoop.finished == ["typed"]
