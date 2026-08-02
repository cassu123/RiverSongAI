"""
tests/test_vortex_voice_utterances.py

Streamed utterances, and per-device auth on the Willow socket.

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
# C — Willow authenticates per device
# ---------------------------------------------------------------------------

_ids = itertools.count(random.randint(1, 1_000_000))


@pytest.fixture(scope="module")
def admin_headers():
    token = create_access_token("willow-admin", "wa@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


def _claim(admin_headers):
    r = client.post("/api/willow/units/claim",
                    json={"name": f"Box {next(_ids)}"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json()["unit_id"], r.json()["unit_token"]


def test_c_shared_device_token_is_gone():
    """One secret across every device meant any device could be any other."""
    from config.settings import get_settings

    assert not hasattr(get_settings(), "willow_device_token")


def test_c_willow_units_can_be_claimed(admin_headers):
    unit_id, token = _claim(admin_headers)
    assert unit_id and len(token) == 64

    # Claiming records the owner, which is how the device gets an identity
    # without ever asserting one.
    async def _owner():
        from api.routes.fleet import unit_owner
        from providers.memory.sqlite_store import SQLiteStore
        return await unit_owner(SQLiteStore(), "willow", unit_id)

    assert asyncio.run(_owner()) == "willow-admin"


def test_c_token_is_hashed_at_rest(admin_headers):
    unit_id, token = _claim(admin_headers)

    async def _stored():
        from providers.memory.sqlite_store import SQLiteStore
        row = await SQLiteStore().execute_read_one_async(
            "SELECT unit_token FROM fleet_units WHERE program='willow' AND unit_id=?",
            (unit_id,),
        )
        return row["unit_token"]

    stored = asyncio.run(_stored())
    assert stored != token and stored.startswith("sha256:")


def test_c_unknown_unit_is_refused_before_the_handshake():
    with pytest.raises(Exception):
        with client.websocket_connect("/api/willow/ws?unit_id=no-such-unit"):
            pass


def test_c_a_wrong_token_is_refused(admin_headers):
    unit_id, _ = _claim(admin_headers)
    with client.websocket_connect(f"/api/willow/ws?unit_id={unit_id}") as ws:
        ws.send_json({"type": "auth", "unit_id": unit_id, "token": "wrong"})
        with pytest.raises(Exception):
            ws.receive_json()


def test_c_identity_is_not_accepted_from_the_device(admin_headers):
    """
    A device stating a user_id must not become that user. The owner is
    resolved from the unit record and the claim is ignored.
    """
    unit_id, token = _claim(admin_headers)

    with client.websocket_connect(f"/api/willow/ws?unit_id={unit_id}") as ws:
        ws.send_json({"type": "auth", "unit_id": unit_id, "token": token,
                      "user_id": "somebody-else"})
        hello = ws.receive_json()
        assert hello["type"] == "auth_ok"
        assert hello["unit_id"] == unit_id
        # No user_id echoed back, and nothing the device said was honoured.
        assert hello.get("user_id") != "somebody-else"


def test_c_an_unowned_unit_cannot_connect():
    """
    Acting as a fallback account would be guessing whose memory to use, so a
    unit with no owner is refused instead.
    """
    async def _make_orphan():
        from api.routes.fleet import _ensure_schema, _now
        from core.vortex_security import hash_unit_token, mint_unit_token
        from providers.memory.sqlite_store import SQLiteStore

        store = SQLiteStore()
        await _ensure_schema(store)
        unit_id = f"orphan-{next(_ids)}"
        token = mint_unit_token()
        await store.execute_write_async(
            "INSERT INTO fleet_units (program, unit_id, name, unit_token, "
            "owner_user_id, registered_at) VALUES ('willow', ?, 'Orphan', ?, '', ?)",
            (unit_id, hash_unit_token(token), _now()),
        )
        return unit_id, token

    unit_id, token = asyncio.run(_make_orphan())
    with client.websocket_connect(
            f"/api/willow/ws?unit_id={unit_id}&token={token}") as ws:
        with pytest.raises(Exception):
            ws.receive_json()
