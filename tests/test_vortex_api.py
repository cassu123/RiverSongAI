"""
tests/test_vortex_api.py

River Vortex server half: pairing, the WebSocket, the replica, surfaces and
the permission model that sits under all of them.

The assertions that matter most here are the negative ones. A unit must not be
able to unlock a door, a pairing code must not be brute-forceable, and a
plaintext unit token must not survive in the database — those are the
invariants the device layer is built assuming.
"""

import asyncio
import base64
import io
import itertools
import math
import random
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def user_headers():
    token = create_access_token("vortex-owner", "owner@test.local", "admin")
    return {"Authorization": f"Bearer {token}"}


_code_counter = itertools.count(random.randint(1, 89_999_999))


def _code() -> str:
    """A fresh 8-digit pairing code. Codes are single-use by design, so a
    fixed one would only work on the first run against a given database."""
    return f"{next(_code_counter) % 100_000_000:08d}"


@pytest.fixture(autouse=True)
def _clean_limiters():
    """Pairing lockout is process-wide; keep tests from leaking into each other."""
    from core.vortex_security import confirmations, pairing_limiter

    async def _reset():
        await pairing_limiter.reset()
        await confirmations.clear()

    asyncio.run(_reset())
    yield


def _pair(code: str, headers, **approve):
    """Run a full pair request → approve → status handshake."""
    r = client.post("/api/vortex/pair/request",
                    json={"code": code, "metadata": {"model": "pi5",
                                                     "has_display": True}})
    assert r.status_code == 200, r.text
    r = client.post("/api/vortex/pair/approve",
                    json={"code": code, "name": "Kitchen", **approve},
                    headers=headers)
    assert r.status_code == 200, r.text
    unit_id = r.json()["unit_id"]
    r = client.get(f"/api/vortex/pair/status?code={code}")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    return unit_id, r.json()["unit_token"]


# ---------------------------------------------------------------------------
# Task 5 — security
# ---------------------------------------------------------------------------

def test_unit_tokens_are_hashed_at_rest(user_headers):
    unit_id, token = _pair(_code(), user_headers)

    async def _stored():
        from providers.memory.sqlite_store import SQLiteStore
        row = await SQLiteStore().execute_read_one_async(
            "SELECT unit_token FROM fleet_units WHERE program='vortex' AND unit_id=?",
            (unit_id,),
        )
        return row["unit_token"]

    stored = asyncio.run(_stored())
    assert stored != token
    assert stored.startswith("sha256:")
    # The plaintext token still authenticates.
    assert client.post("/api/vortex/heartbeat", json={"unit_id": unit_id},
                       headers={"X-Unit-Token": token}).status_code == 200


def test_token_comparison_is_constant_time():
    from core.vortex_security import (hash_unit_token, mint_unit_token,
                                      verify_unit_token)
    token = mint_unit_token()
    stored = hash_unit_token(token)
    assert verify_unit_token(token, stored)
    # Flip the last character rather than forcing it to "0" — a token ending
    # in "0" would otherwise be "corrupted" into itself one run in sixteen.
    wrong = token[:-1] + ("1" if token[-1] == "0" else "0")
    assert wrong != token
    assert not verify_unit_token(wrong, stored)
    assert not verify_unit_token("", stored)
    assert not verify_unit_token(token, None)
    # A legacy plaintext row still validates, so a rolling upgrade works.
    assert verify_unit_token(token, token)


def test_unit_cannot_unlock_a_door():
    from core.intent_router import (ORIGIN_VORTEX_UNIT, RequestOrigin,
                                    evaluate_device_request)
    unit = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="vx-test",
                         room="kitchen")

    # Naming conventions must not decide whether a safety rule applies. Word
    # boundaries miss "garage_door" (`_` is a word character) and miss
    # "GarageDoor" (no separator at all); either miss silently downgrades a
    # hard deny to a confirmation prompt.
    for action, entity in (("unlock", "lock.front_door"),
                           ("lock", "lock.back_door"),
                           ("open", "cover.garage_door"),
                           ("close", "cover.garage-door"),
                           ("open", "cover.GarageDoor"),
                           ("open", "cover.garagedoor"),
                           ("open", "cover.side_gate"),
                           ("turn_on", "switch.garage_opener"),
                           ("disarm", "alarm_control_panel.house"),
                           ("turn_off", "alarm_control_panel.downstairs")):
        decision = evaluate_device_request(action=action, entity_id=entity,
                                           origin=unit)
        assert decision.denied, f"{action} {entity} should be hard-denied"
        assert decision.reason == "vortex_hard_deny"

    # ...but a network gateway is not a way into the house.
    assert evaluate_device_request(action="turn_on",
                                   entity_id="switch.network_gateway",
                                   origin=unit).allowed

    # The same requests from a user session are untouched.
    assert evaluate_device_request(action="unlock",
                                   entity_id="lock.front_door").allowed


def test_unit_can_still_control_ordinary_devices():
    from core.intent_router import (ORIGIN_VORTEX_UNIT, RequestOrigin,
                                    evaluate_device_request)
    unit = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="vx-test")
    assert evaluate_device_request(action="turn_on", entity_id="light.kitchen",
                                   origin=unit).allowed
    assert evaluate_device_request(action="set_brightness",
                                   entity_id="light.kitchen",
                                   origin=unit).allowed


def test_medium_risk_needs_confirmation_and_a_screen():
    from core.intent_router import (ORIGIN_VORTEX_UNIT, RequestOrigin,
                                    evaluate_device_request)
    screened = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="a",
                             has_display=True)
    screenless = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="b",
                               has_display=False)

    assert evaluate_device_request(action="open", entity_id="cover.blinds",
                                   origin=screened).needs_confirmation
    # A spoken second factor is not an option, so a screenless unit is refused.
    denied = evaluate_device_request(action="open", entity_id="cover.blinds",
                                     origin=screenless)
    assert denied.denied and denied.reason == "second_factor_impossible"


def test_tapped_lock_is_refused_over_http(user_headers):
    unit_id, token = _pair(_code(), user_headers)
    r = client.post("/api/vortex/devices/toggle",
                    json={"unit_id": unit_id, "entity_id": "lock.front_door"},
                    headers={"X-Unit-Token": token})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Task 4 — pairing
# ---------------------------------------------------------------------------

def test_pairing_end_to_end(user_headers):
    unit_id, token = _pair(_code(), user_headers, room="kitchen")
    assert unit_id and len(token) == 64

    # A device credential that works.
    assert client.post("/api/vortex/register",
                       json={"unit_id": unit_id, "metadata": {"fw": "1.0"}},
                       headers={"X-Unit-Token": token}).status_code == 200

    # The owner is recorded server-side, not asserted by the unit.
    r = client.get("/api/vortex/profiles", headers=user_headers)
    assert r.status_code == 200
    rooms = {u["unit_id"]: u["room"] for u in r.json()["units"]}
    assert rooms.get(unit_id) == "kitchen"


def test_token_is_handed_over_exactly_once(user_headers):
    code = _code()
    _pair(code, user_headers)
    # The second poll must not return the token again.
    r = client.get(f"/api/vortex/pair/status?code={code}")
    assert r.status_code == 200
    assert r.json()["status"] == "claimed"
    assert "unit_token" not in r.json()


def test_a_code_alone_mints_nothing():
    code = _code()
    client.post("/api/vortex/pair/request", json={"code": code, "metadata": {}})
    r = client.get(f"/api/vortex/pair/status?code={code}")
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    assert "unit_token" not in r.json()


def test_approve_requires_a_logged_in_user():
    code = _code()
    client.post("/api/vortex/pair/request", json={"code": code})
    assert client.post("/api/vortex/pair/approve",
                       json={"code": code}).status_code == 401


def test_brute_forcing_pair_status_gets_locked_out():
    # 8 digits is 10^8; without a lockout it is enumerable.
    base = random.randint(0, 8_999_999)
    codes = [f"{(base + i) % 100_000_000:08d}" for i in range(12)]
    statuses = [client.get(f"/api/vortex/pair/status?code={c}").status_code
                for c in codes]
    assert 429 in statuses, "hammering pair/status must lock out"


def test_pair_request_rejects_malformed_codes():
    for bad in ("1234", "abcdefgh", "123456789"):
        r = client.post("/api/vortex/pair/request", json={"code": bad})
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Task 1 — the WebSocket
# ---------------------------------------------------------------------------

def test_ws_refuses_unknown_unit_before_accept():
    with pytest.raises(Exception):
        with client.websocket_connect("/api/vortex/ws?unit_id=does-not-exist"):
            pass


def test_ws_requires_a_valid_auth_frame_first(user_headers):
    unit_id, token = _pair(_code(), user_headers)

    with client.websocket_connect(f"/api/vortex/ws?unit_id={unit_id}") as ws:
        ws.send_json({"type": "auth", "unit_id": unit_id, "token": "wrong"})
        with pytest.raises(Exception):
            ws.receive_json()

    with client.websocket_connect(f"/api/vortex/ws?unit_id={unit_id}") as ws:
        # A non-auth first frame is refused too.
        ws.send_json({"type": "state", "state": "idle"})
        with pytest.raises(Exception):
            ws.receive_json()


def test_ws_authenticates_and_pushes_presence(user_headers):
    unit_id, token = _pair(_code(), user_headers, room="study")

    with client.websocket_connect(f"/api/vortex/ws?unit_id={unit_id}") as ws:
        ws.send_json({"type": "auth", "unit_id": unit_id, "token": token})
        hello = ws.receive_json()
        assert hello["type"] == "auth_ok"
        assert hello["unit_id"] == unit_id
        assert hello["room"] == "study"

        presence = ws.receive_json()
        assert presence["type"] == "presence"
        assert presence["state"] == "idle"

        ws.send_json({"type": "ping"})
        # The replica/surface replay tasks may interleave; find the pong.
        for _ in range(6):
            frame = ws.receive_json()
            if frame["type"] == "pong":
                break
        else:
            pytest.fail("no pong received")


def test_presence_vocabulary_is_fixed():
    from core.vortex_hub import PRESENCE_STATES, VortexHub

    assert PRESENCE_STATES == {"idle", "listening", "thinking", "speaking",
                               "acting", "error"}

    class _Socket:
        def __init__(self):
            self.sent = []

        async def send_json(self, frame):
            self.sent.append(frame)

    async def _run():
        hub = VortexHub()
        socket = _Socket()
        await hub.register("u1", socket)
        assert await hub.presence("u1", "speaking", amplitude=0.5)
        # An unknown state is refused rather than sent to a renderer that
        # would silently drop it.
        assert not await hub.presence("u1", "dancing")
        return socket.sent

    sent = asyncio.run(_run())
    assert len(sent) == 1 and sent[0]["state"] == "speaking"


# ---------------------------------------------------------------------------
# Task 9 / Task 1 — the amplitude envelope
# ---------------------------------------------------------------------------

def _tone_wav(seconds=1.0, rate=22050, ramp=True):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        frames = bytearray()
        total = int(rate * seconds)
        for i in range(total):
            envelope = (i / total) if ramp else 1.0
            value = int(30000 * envelope * math.sin(i * 0.05))
            frames += struct.pack("<h", max(-32768, min(32767, value)))
        handle.writeframes(bytes(frames))
    return buffer.getvalue()


def test_amplitude_envelope_tracks_the_audio():
    from core.vortex_hub import AMPLITUDE_HZ, amplitude_envelope

    envelope = amplitude_envelope(_tone_wav(seconds=2.0))
    assert abs(len(envelope) - 2 * AMPLITUDE_HZ) <= 2
    assert all(0.0 <= v <= 1.0 for v in envelope)
    # A ramp in the audio must show up as a ramp in the envelope.
    assert envelope[-1] > envelope[0]


def test_amplitude_envelope_is_empty_for_unusable_audio():
    from core.vortex_hub import amplitude_envelope

    assert amplitude_envelope(b"") == []
    assert amplitude_envelope(b"not a wav file at all") == []
    # Silence produces no envelope rather than a flat line of zeros.
    silent = io.BytesIO()
    with wave.open(silent, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 16000)
    assert amplitude_envelope(silent.getvalue()) == []


# ---------------------------------------------------------------------------
# Task 6 — surfaces
# ---------------------------------------------------------------------------

def test_surface_validation_rejects_undrawable_cards():
    from core.vortex_surfaces import SurfaceError, build_surface

    with pytest.raises(SurfaceError):
        build_surface({"kind": "note"})                    # no id
    with pytest.raises(SurfaceError):
        build_surface({"id": "x", "kind": "carousel"})     # unknown kind
    with pytest.raises(SurfaceError):
        build_surface({"id": "x", "priority": "urgent"})   # invented priority

    card = build_surface({"id": "bins", "kind": "note", "priority": "normal",
                          "title": "Bins go out tonight",
                          "items": [str(i) for i in range(20)],
                          "actions": [{"label": str(i)} for i in range(6)]})
    assert len(card.items) == 8      # renderer caps the list at 8
    assert len(card.actions) == 3    # and the actions at 3


def test_same_id_replaces_and_never_stacks():
    from core.vortex_surfaces import SurfacePublisher

    async def _run():
        publisher = SurfacePublisher()
        for body in ("open 10 minutes", "open 40 minutes"):
            await publisher.publish(
                {"id": "garage", "kind": "alert", "priority": "normal",
                 "title": "Garage door open", "body": body,
                 "speech": body},
                unit_ids=["unit-a"],
            )
        cards = await publisher.list_for_unit("unit-a")
        assert len(cards) == 1
        assert cards[0]["body"] == "open 40 minutes"

        await publisher.withdraw("garage", ["unit-a"])
        assert await publisher.list_for_unit("unit-a") == []

    asyncio.run(_run())


def test_room_targeting_puts_the_card_in_one_room_only(user_headers):
    kitchen_id, _ = _pair(_code(), user_headers, room="kitchen")
    bedroom_id, _ = _pair(_code(), user_headers, room="bedroom")

    async def _run():
        from core.vortex_surfaces import SurfacePublisher

        publisher = SurfacePublisher()
        result = await publisher.publish(
            {"id": "shopping-list", "kind": "list", "priority": "ambient",
             "title": "Shopping list", "items": ["Milk"], "speech": "Milk"},
            room="kitchen",
        )
        assert kitchen_id in result["targets"]
        assert bedroom_id not in result["targets"]

    asyncio.run(_run())


def test_screenless_units_never_get_a_silent_card():
    from core.vortex_hub import VortexHub
    from core.vortex_surfaces import SurfacePublisher, derive_speech, build_surface

    class _Socket:
        def __init__(self):
            self.sent = []

        async def send_json(self, frame):
            self.sent.append(frame)

    async def _run():
        import core.vortex_hub as hub_module

        hub = VortexHub()
        original, hub_module._hub = hub_module._hub, hub
        try:
            socket = _Socket()
            await hub.register("speaker", socket, has_display=False)
            publisher = SurfacePublisher()
            await publisher.publish(
                {"id": "bins", "kind": "note", "priority": "normal",
                 "title": "Bins go out tonight"},   # deliberately no speech
                unit_ids=["speaker"],
            )
            return socket.sent
        finally:
            hub_module._hub = original

    sent = asyncio.run(_run())
    card = next(f for f in sent if f["type"] == "surface")
    assert card["speech"] == "Bins go out tonight"

    assert derive_speech(build_surface(
        {"id": "t", "kind": "stat", "title": "Outside", "value": "4",
         "unit": "°C"})) == "Outside. 4°C"


def test_surface_action_requires_a_unit_token(user_headers):
    unit_id, _ = _pair(_code(), user_headers)
    r = client.post("/api/vortex/v1/surface-action",
                    json={"surface_id": "garage", "intent": "cover.close.garage",
                          "unit_id": unit_id})
    assert r.status_code == 401


def test_surface_action_re_runs_the_hard_deny(user_headers):
    unit_id, token = _pair(_code(), user_headers)
    # A card on a wall panel is a prompt, not an authorisation: tapping
    # "Close it" on a garage card is still refused.
    r = client.post("/api/vortex/v1/surface-action",
                    json={"surface_id": "garage",
                          "intent": "cover.close.garage_door",
                          "unit_id": unit_id},
                    headers={"X-Unit-Token": token})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Task 2 / 1b / 7 — the replica
# ---------------------------------------------------------------------------

def test_replica_requires_a_unit_token(user_headers):
    unit_id, _ = _pair(_code(), user_headers)
    assert client.get(f"/api/vortex/replica?unit_id={unit_id}").status_code == 401


def test_replica_carries_the_wake_word_and_the_unit_block(user_headers):
    unit_id, token = _pair(_code(), user_headers, room="hall")
    r = client.get(f"/api/vortex/replica?unit_id={unit_id}",
                   headers={"X-Unit-Token": token})
    assert r.status_code == 200
    body = r.json()
    assert body["full"] is True
    assert "version" in body
    assert body["wake_word"]["engine"] == "openwakeword"
    assert body["unit"]["unit_id"] == unit_id
    assert body["unit"]["room"] == "hall"


def test_replica_since_returns_only_what_changed(user_headers):
    unit_id, token = _pair(_code(), user_headers)
    headers = {"X-Unit-Token": token}

    first = client.get(f"/api/vortex/replica?unit_id={unit_id}",
                       headers=headers).json()
    version = first["version"]

    second = client.get(
        f"/api/vortex/replica?unit_id={unit_id}&since={version}",
        headers=headers).json()
    assert second["full"] is False
    assert second["version"] == version
    # Nothing changed between the two calls, so no section comes back.
    assert not any(key in second for key in
                   ("devices", "cameras", "notifications", "wake_word"))

    # A `since` from before a server restart falls back to a full snapshot
    # rather than silently returning nothing.
    ahead = client.get(
        f"/api/vortex/replica?unit_id={unit_id}&since={version + 10_000}",
        headers=headers).json()
    assert ahead["full"] is True


# ---------------------------------------------------------------------------
# Task 3b — music targeting
# ---------------------------------------------------------------------------

def test_room_extraction_from_a_play_request():
    from core.vortex_media import extract_room

    assert extract_room("play something in the living room") == "living room"
    assert extract_room("play jazz on the kitchen speaker") == "kitchen"
    assert extract_room("play Bohemian Rhapsody") is None


def test_music_from_a_unit_targets_a_unit(monkeypatch):
    """A play intent relayed by a unit resolves a URL and pushes it there."""
    import core.vortex_media as media
    from core.intent_router import ORIGIN_VORTEX_UNIT, RequestOrigin, origin_scope

    pushed = {}

    async def _fake_resolve(query):
        return {"url": "https://stream.example/x", "title": "Test Track",
                "artist": "Nobody", "duration_seconds": 100}

    async def _fake_target(*, user_id, requesting_unit, room):
        return requesting_unit or "kitchen-unit"

    async def _fake_play(*, unit_id, track, queue=None):
        pushed["unit_id"] = unit_id
        pushed["track"] = track
        return True

    monkeypatch.setattr(media, "resolve_track", _fake_resolve)
    monkeypatch.setattr(media, "target_unit", _fake_target)
    monkeypatch.setattr(media, "play_on_unit", _fake_play)

    async def _run():
        origin = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="kitchen-unit",
                               room="kitchen")
        with origin_scope(origin):
            return await media.handle_play_request(
                transcript="play something", user_id="u", query="something")

    spoken = asyncio.run(_run())
    assert pushed["unit_id"] == "kitchen-unit"
    assert pushed["track"]["url"] == "https://stream.example/x"
    assert "Test Track" in spoken
    # Nothing was played on this server.
    assert "audio_output_device" not in pushed


def test_music_from_a_user_session_falls_through():
    """A browser request must keep playing locally, unchanged."""
    import core.vortex_media as media

    async def _run():
        return await media.handle_play_request(
            transcript="play something", user_id="u", query="something")

    assert asyncio.run(_run()) is None


# ---------------------------------------------------------------------------
# Task 8 — cameras
# ---------------------------------------------------------------------------

def test_camera_purpose_defaults_to_off():
    from core.vortex_units import camera_purpose_enabled

    assert not camera_purpose_enabled(None, "face_recognition")
    assert not camera_purpose_enabled({"camera": {}}, "presence")
    # Fitted but not consented is still off.
    assert not camera_purpose_enabled(
        {"camera": {"fitted": True, "purposes": {}}}, "presence")
    # A muted camera is off for every purpose regardless of consent.
    assert not camera_purpose_enabled(
        {"camera": {"fitted": True, "muted": True,
                    "purposes": {"presence": True}}}, "presence")
    assert camera_purpose_enabled(
        {"camera": {"fitted": True, "purposes": {"presence": True}}}, "presence")


def test_unconsented_camera_purpose_is_a_distinct_refusal(user_headers):
    unit_id, token = _pair(_code(), user_headers)
    frame = base64.b64encode(b"\xff\xd8\xff" + b"0" * 64).decode()
    r = client.post("/api/vortex/camera/frames",
                    json={"unit_id": unit_id, "purpose": "face_recognition",
                          "frames": [frame]},
                    headers={"X-Unit-Token": token})
    # 409, not 403 or 500: the unit is not misbehaving and this is not a fault
    # to route around — the purpose is simply not enabled.
    assert r.status_code == 409

    r = client.post("/api/vortex/camera/frames",
                    json={"unit_id": unit_id, "purpose": "mind_reading",
                          "frames": [frame]},
                    headers={"X-Unit-Token": token})
    assert r.status_code == 400


def test_missing_detector_is_not_an_empty_room(monkeypatch):
    """
    "Could not look" and "nobody there" must not collapse into each other.

    OpenCV 4.x bundles the Haar cascade this uses; 5.0 removed it and ships
    no model, so on a 5.x install detection is genuinely unavailable. The
    answer then is `unavailable`, never a confident "no one is here".
    """
    import core.vortex_vision as vision

    monkeypatch.setattr(vision, "_resolve_detector", lambda: None)

    async def _run(purpose):
        return await vision.identify_from_frames(
            unit_id="u", owner_user_id="o", purpose=purpose,
            frames=[base64.b64encode(b"\xff\xd8\xff" + b"0" * 64).decode()],
        )

    result = asyncio.run(_run("presence"))
    assert result["status"] == "unavailable"
    assert result["reason"] == "no_detector"
    assert "occupied" not in result

    result = asyncio.run(_run("face_recognition"))
    assert result["status"] == "unavailable"


def test_identification_without_a_backend_says_so(monkeypatch):
    """A face seen but not placed is 'cannot identify', not 'not you'."""
    import core.vortex_vision as vision

    monkeypatch.setattr(vision, "_resolve_detector",
                        lambda: (lambda frame: 1, True))

    async def _detect(image):
        return 1

    monkeypatch.setattr(vision, "_detect_faces", _detect)

    async def _run():
        return await vision.identify_from_frames(
            unit_id="u", owner_user_id="o", purpose="face_recognition",
            frames=[base64.b64encode(b"\xff\xd8\xff" + b"0" * 64).decode()],
        )

    result = asyncio.run(_run())
    assert result["status"] == "unavailable"
    assert result["reason"] == "no_recognition_backend"
    # Crucially not a no_match — nothing was compared against anything.
    assert "user_id" not in result


def test_snapshot_links_are_signed_and_expiring():
    from core.vortex_vision import read_snapshot, snapshot_url

    url = snapshot_url("unit-abc.jpg", 4_000_000_000)
    assert "sig=" in url and "exp=" in url
    signature = url.split("sig=")[1]

    with pytest.raises(PermissionError):
        read_snapshot("unit-abc.jpg", 4_000_000_000, "deadbeef")
    with pytest.raises(PermissionError):
        read_snapshot("unit-abc.jpg", 1, signature)          # expired
    with pytest.raises(PermissionError):
        read_snapshot("../../etc/passwd", 4_000_000_000, signature)
    # Correct signature, unexpired, but the file has aged out of retention.
    with pytest.raises(FileNotFoundError):
        read_snapshot("unit-abc.jpg", 4_000_000_000, signature)
