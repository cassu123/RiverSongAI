"""
tests/test_vortex_voice_utterances.py

Streamed utterances, the removal of the in-repo Vortex client, and the
retirement of the Willow endpoint.

The utterance tests exist because the previous behaviour was silent: a command
longer than one frame was dropped with a log line and the room got nothing
back. The assertions here are mostly about length — that a ten-second sentence
survives, and that an endless one does not.
"""

import asyncio
import itertools
import random

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)

# 16 kHz, mono, s16le — the agreed streaming format.
BYTES_PER_SECOND = 32_000


def _pcm(seconds: float, value: int = 1) -> bytes:
    """`seconds` of raw PCM, distinguishable per chunk by its fill byte."""
    return bytes([value, 0]) * int(BYTES_PER_SECOND * seconds / 2)


@pytest.fixture(autouse=True)
def _clean_buffers():
    import core.vortex_voice as voice

    async def _reset():
        async with voice._utterance_lock:      # noqa: SLF001 - test seam
            voice._utterances.clear()          # noqa: SLF001

    asyncio.run(_reset())
    yield
    asyncio.run(_reset())


# ---------------------------------------------------------------------------
# A — the four-second ceiling
# ---------------------------------------------------------------------------

def test_a_multi_chunk_utterance_is_joined_not_dropped():
    """
    The bug this replaces: only the final frame survived, so anything past
    about four seconds was discarded and the user got silence.
    """
    import core.vortex_voice as voice

    async def _run():
        # Ten seconds arriving as four frames — none of which is final.
        for i in range(4):
            assert await voice._accumulate("unit-a", _pcm(2.5, i + 1))
        return await voice._take_utterance("unit-a", _pcm(0.5, 9))

    joined = asyncio.run(_run())
    assert joined is not None
    # 4 x 2.5s + 0.5s = 10.5s, all of it present.
    assert len(joined) == int(BYTES_PER_SECOND * 10.5)
    # And in order — the first chunk's fill byte leads.
    assert joined[0] == 1
    assert joined[-2] == 9


def test_a_single_frame_utterance_still_works_untouched():
    """A short command arrives in one final frame and must pass through as-is."""
    import core.vortex_voice as voice

    payload = _pcm(2.0, 7)
    result = asyncio.run(voice._take_utterance("unit-b", payload))
    assert result is payload


def test_a_utterance_is_bounded_by_total_not_by_frame():
    """
    A unit that never sends `final` must not grow the buffer without limit.
    The cap is on the accumulated total; the per-frame cap is a separate,
    smaller thing.
    """
    import core.vortex_voice as voice

    assert voice.MAX_UTTERANCE_BYTES == BYTES_PER_SECOND * voice.MAX_UTTERANCE_SECONDS
    # Comfortably above the device's own 30s recording limit, so a long-but-
    # legitimate command is never what trips it.
    assert voice.MAX_UTTERANCE_SECONDS > 30

    async def _run():
        accepted = 0
        for _ in range(200):                       # 200 x 1s = way past the cap
            if await voice._accumulate("unit-c", _pcm(1.0)):
                accepted += 1
            else:
                break
        return accepted

    accepted = asyncio.run(_run())
    assert accepted == voice.MAX_UTTERANCE_SECONDS


def test_a_an_overflowed_utterance_is_dropped_whole():
    """
    Half a command acted on is worse than one that visibly failed — so the
    final chunk of an overflowed utterance is discarded too, not transcribed
    on its own.
    """
    import core.vortex_voice as voice

    async def _run():
        while await voice._accumulate("unit-d", _pcm(1.0)):
            pass
        return await voice._take_utterance("unit-d", _pcm(0.5))

    assert asyncio.run(_run()) is None


def test_a_buffer_resets_after_each_final():
    """A half-spoken command must not prepend itself to the next one."""
    import core.vortex_voice as voice

    async def _run():
        await voice._accumulate("unit-e", _pcm(1.0, 1))
        first = await voice._take_utterance("unit-e", _pcm(1.0, 2))
        # Next utterance: one frame only, nothing carried over.
        second = await voice._take_utterance("unit-e", _pcm(1.0, 3))
        return first, second

    first, second = asyncio.run(_run())
    assert len(first) == BYTES_PER_SECOND * 2
    assert len(second) == BYTES_PER_SECOND       # not 3 seconds
    assert second[0] == 3


def test_a_disconnect_clears_a_half_spoken_utterance():
    import core.vortex_voice as voice

    async def _run():
        await voice._accumulate("unit-f", _pcm(2.0, 1))
        await voice.clear_utterance("unit-f")
        # The next final frame stands alone.
        return await voice._take_utterance("unit-f", _pcm(1.0, 2))

    result = asyncio.run(_run())
    assert len(result) == BYTES_PER_SECOND


def test_a_wav_chunks_are_unwrapped_before_joining():
    """
    Chunks are raw PCM by protocol, but a unit that wrapped each in a WAV
    header would otherwise produce RIFF...RIFF..., which decodes as only the
    first chunk — audio going quietly missing rather than failing.
    """
    import io
    import wave

    import core.vortex_voice as voice

    def _wav(seconds, value):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16_000)
            handle.writeframes(_pcm(seconds, value))
        return buffer.getvalue()

    async def _run():
        await voice._accumulate("unit-g", _wav(1.0, 1))
        return await voice._take_utterance("unit-g", _wav(1.0, 2))

    joined = asyncio.run(_run())
    assert not joined.startswith(b"RIFF")
    assert len(joined) == BYTES_PER_SECOND * 2   # both chunks, no headers
    assert joined[0] == 1 and joined[-2] == 2


def test_a_frame_cap_is_documented_as_a_frame_cap():
    """The per-frame cap stays; it was only ever wrong as an utterance size."""
    from api.routes.vortex import MAX_AUDIO_CHUNK_BYTES
    import core.vortex_voice as voice

    assert MAX_AUDIO_CHUNK_BYTES == 128 * 1024
    assert voice.MAX_UTTERANCE_BYTES > MAX_AUDIO_CHUNK_BYTES


def test_a_ten_second_command_reaches_the_transcriber_in_full(monkeypatch):
    """
    The brief's acceptance criterion, through the real handler rather than the
    buffer helpers: ten seconds of speech arriving as several frames must be
    handed to the conversation loop whole.

    At 32,000 bytes/sec the old single-frame path capped this at 4.1 seconds —
    "set a timer for ten minutes" fit, "put milk and eggs on the shopping list
    and start the oven timer" did not.
    """
    import core.vortex_voice as voice

    received = {}

    class _FakeLoop:
        async def run_once(self, audio_bytes, on_event):
            received["bytes"] = len(audio_bytes)
            await on_event({"type": "transcript", "text": "ok"})

    async def _fake_get_loop(unit_id, user_id):
        return _FakeLoop()

    class _FakeHub:
        def __init__(self):
            self.states = []

        async def presence(self, unit_id, state, **kwargs):
            self.states.append(state)
            return True

        async def send(self, *a, **k):
            return True

        def is_speaking(self, unit_id):
            return False

    hub = _FakeHub()
    monkeypatch.setattr(voice, "_get_loop", _fake_get_loop)
    monkeypatch.setattr("core.vortex_hub.get_vortex_hub", lambda: hub)

    async def _run():
        # Nine one-second frames, then a final one — ten seconds total.
        for i in range(9):
            await voice.handle_unit_utterance(
                unit_id="unit-e2e", user_id="owner",
                audio=_pcm(1.0, i + 1), final=False)
        await voice.handle_unit_utterance(
            unit_id="unit-e2e", user_id="owner",
            audio=_pcm(1.0, 10), final=True)

    asyncio.run(_run())

    assert "bytes" in received, "the utterance never reached the loop"
    assert received["bytes"] == BYTES_PER_SECOND * 10
    # And the orb showed listening while the frames streamed in.
    assert "listening" in hub.states


# ---------------------------------------------------------------------------
# B — the competing client is gone
# ---------------------------------------------------------------------------

def test_b_the_in_repo_vortex_client_is_gone():
    """
    `clients/vortex/` was a second implementation of the device, inside the
    server repo, authenticating with a shared token and self-asserting
    user_id. The device layer is cassu123/river-vortex.
    """
    import os

    assert not os.path.exists("clients/vortex")
    with pytest.raises(ImportError):
        __import__("clients.vortex.protocol")


# ---------------------------------------------------------------------------
# C — Willow is retired; the identity work it prompted is kept
# ---------------------------------------------------------------------------

_ids = itertools.count(random.randint(1, 1_000_000))


@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token("fleet-admin", "fa@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def test_c_the_willow_route_is_gone():
    """
    No ESP32 hardware exists and none is planned, so the endpoint, its fleet
    program and its shared device token are all removed rather than left
    mounted with no owner.
    """
    from main import app

    paths = [getattr(r, "path", "") for r in app.routes]
    assert not [p for p in paths if p.startswith("/api/willow")]

    from api.routes.fleet import FLEET_PROGRAMS
    assert "willow" not in FLEET_PROGRAMS

    with pytest.raises(ImportError):
        __import__("api.routes.willow")


def test_c_the_shared_device_token_is_gone():
    """One secret across every device meant any device could be any other."""
    from config.settings import get_settings

    assert not hasattr(get_settings(), "willow_device_token")


def test_c_claiming_a_unit_records_its_owner(admin_headers):
    """
    Kept from the Willow work and worth having regardless: a unit acquires an
    identity from whoever claimed it, so it never has to assert one.
    """
    r = client.post("/api/kova/units/claim",
                    json={"name": f"Bot {next(_ids)}"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    unit_id, token = r.json()["unit_id"], r.json()["unit_token"]

    async def _owner():
        from api.routes.fleet import unit_owner
        from providers.memory.sqlite_store import SQLiteStore
        return await unit_owner(SQLiteStore(), "kova", unit_id)

    assert asyncio.run(_owner()) == "fleet-admin"

    # The column is a column, not a metadata key: `register` replaces metadata
    # wholesale, so an owner stored there would be wiped on first reconnect.
    assert client.post("/api/kova/register",
                       json={"unit_id": unit_id, "metadata": {"fw": "2.0"}},
                       headers={"X-Unit-Token": token}).status_code == 200
    assert asyncio.run(_owner()) == "fleet-admin"


def test_c_an_unclaimed_unit_has_no_owner():
    """Absence is reported as absence, not as some fallback account."""
    async def _owner():
        from api.routes.fleet import _ensure_schema, unit_owner
        from providers.memory.sqlite_store import SQLiteStore

        store = SQLiteStore()
        await _ensure_schema(store)
        return await unit_owner(store, "kova", f"never-claimed-{next(_ids)}")

    assert asyncio.run(_owner()) == ""
