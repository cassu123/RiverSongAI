"""
tests/test_vortex_calls_cast_face.py

Intercom and video calls, casting, and face match.

The three share a theme: this server decides and relays, and the interesting
assertions are about what it refuses to do. It does not carry call media, it
does not reimplement the Cast protocol, and it does not return a face match it
did not make.
"""

import asyncio
import itertools
import random

import pytest
from fastapi.testclient import TestClient

from core.auth import create_access_token
from main import app

client = TestClient(app)

OWNER = "calls-test-owner"

_code_counter = itertools.count(random.randint(1, 89_999_999))


def _code() -> str:
    return f"{next(_code_counter) % 100_000_000:08d}"


_room_counter = itertools.count(random.randint(1, 1_000_000))


def _room(prefix: str) -> str:
    """
    A room name unique to this run.

    Units persist in the test database, and a room resolves to whichever unit
    is in it — so a fixed name would resolve to last run's unit, not the one
    the test just paired.
    """
    return f"{prefix} {next(_room_counter)}"


@pytest.fixture(scope="module")
def headers():
    return {"Authorization": f"Bearer {create_access_token(OWNER, 'c@t.local', 'admin')}"}


@pytest.fixture(autouse=True)
def _clean():
    from core.vortex_calls import get_call_registry
    from core.vortex_calls_ws import reset as reset_sockets
    from core.vortex_security import pairing_limiter

    async def _reset():
        await get_call_registry().reset()
        await reset_sockets()
        await pairing_limiter.reset()

    asyncio.run(_reset())
    yield
    asyncio.run(_reset())


def _pair(headers, room, *, video_calls=False):
    code = _code()
    metadata = {"has_display": True}
    if video_calls:
        metadata["camera"] = {"fitted": True,
                              "purposes": {"video_calls": True}}
    r = client.post("/api/vortex/pair/request",
                    json={"code": code, "metadata": metadata})
    assert r.status_code == 200, r.text
    r = client.post("/api/vortex/pair/approve",
                    json={"code": code, "name": room.title(), "room": room},
                    headers=headers)
    assert r.status_code == 200, r.text
    unit_id = r.json()["unit_id"]
    token = client.get(f"/api/vortex/pair/status?code={code}").json()["unit_token"]
    return unit_id, {"X-Unit-Token": token}


# ---------------------------------------------------------------------------
# Calls — addressing
# ---------------------------------------------------------------------------

def test_a_unit_and_a_phone_are_the_same_kind_of_address():
    """
    Kitchen-to-bedroom and phone-to-kitchen must be one code path, not two.
    """
    from core.vortex_calls import participant_id, split_participant

    assert participant_id(unit_id="vx-1") == "unit:vx-1"
    assert participant_id(user_id="u-1") == "user:u-1"
    assert split_participant("unit:vx-1") == ("unit", "vx-1")
    assert split_participant("user:u-1") == ("user", "u-1")

    with pytest.raises(ValueError):
        participant_id()


def test_calling_yourself_is_refused():
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        call, error = await registry.start(
            caller="unit:a", callee="unit:a", owner_user_id=OWNER)
        return call, error

    call, error = asyncio.run(_run())
    assert call is None and "same device" in error


def test_a_busy_participant_is_not_rung_again():
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        first, _ = await registry.start(caller="unit:a", callee="unit:b",
                                        owner_user_id=OWNER)
        second, error = await registry.start(caller="unit:c", callee="unit:b",
                                             owner_user_id=OWNER)
        await registry.reset()
        return first, second, error

    first, second, error = asyncio.run(_run())
    assert first is not None
    assert second is None and "already on a call" in error


# ---------------------------------------------------------------------------
# Calls — lifecycle and relay
# ---------------------------------------------------------------------------

def test_the_server_relays_signalling_without_reading_it():
    """
    SDP and ICE are between the peers. This forwards the payload verbatim —
    it does not parse, rewrite or store the session description.
    """
    from core.vortex_calls import CallRegistry

    delivered = []

    async def _run():
        registry = CallRegistry()

        async def _capture(address, frame):
            delivered.append((address, frame))
            return True

        registry._deliver = _capture  # noqa: SLF001 - test seam

        call, _ = await registry.start(caller="unit:a", callee="unit:b",
                                       owner_user_id=OWNER)
        await registry.answer(call.id, "unit:b")

        sdp = {"type": "call_offer", "sdp": "v=0\r\no=- 1 1 IN IP4 10.0.0.5"}
        ok, error = await registry.relay(call.id, "unit:a", sdp)
        await registry.reset()
        return ok, error

    ok, error = asyncio.run(_run())
    assert ok and not error

    to_b = [f for addr, f in delivered if addr == "unit:b"]
    offer = next(f for f in to_b if f.get("type") == "call_offer")
    assert offer["sdp"] == "v=0\r\no=- 1 1 IN IP4 10.0.0.5"
    assert offer["from"] == "unit:a"


def test_a_third_party_cannot_signal_into_a_call():
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        call, _ = await registry.start(caller="unit:a", callee="unit:b",
                                       owner_user_id=OWNER)
        result = await registry.relay(call.id, "unit:intruder",
                                      {"type": "call_ice", "candidate": "x"})
        await registry.reset()
        return result

    ok, error = asyncio.run(_run())
    assert not ok and "isn't yours" in error


def test_only_the_callee_can_answer():
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        call, _ = await registry.start(caller="unit:a", callee="unit:b",
                                       owner_user_id=OWNER)
        wrong, error = await registry.answer(call.id, "unit:a")
        right, _ = await registry.answer(call.id, "unit:b")
        state = right.state if right else None
        await registry.reset()
        return wrong, error, state

    wrong, error, state = asyncio.run(_run())
    assert wrong is None and "isn't for this device" in error
    assert state == "active"


def test_both_ends_are_told_when_a_call_ends():
    """
    The end that did not hang up has to release its camera — and on a unit
    that camera light is an interlock the user can see.
    """
    from core.vortex_calls import CallRegistry

    delivered = []

    async def _run():
        registry = CallRegistry()

        async def _capture(address, frame):
            delivered.append((address, frame.get("type")))
            return True

        registry._deliver = _capture  # noqa: SLF001 - test seam
        call, _ = await registry.start(caller="unit:a", callee="unit:b",
                                       owner_user_id=OWNER)
        await registry.answer(call.id, "unit:b")
        await registry.end(call.id, reason="hung_up", by="unit:a")
        await registry.reset()

    asyncio.run(_run())
    ends = [addr for addr, kind in delivered if kind == "call_end"]
    assert set(ends) == {"unit:a", "unit:b"}


def test_signalling_for_a_disconnected_peer_is_buffered():
    """
    A phone that accepted a push and is still opening its socket must get the
    offer that was already waiting, not a call that silently failed.
    """
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        # Nothing is connected, so every delivery buffers.
        call, _ = await registry.start(caller="unit:a", callee="user:u1",
                                       owner_user_id=OWNER)
        drained = await registry.drain_pending("user:u1")
        again = await registry.drain_pending("user:u1")
        await registry.reset()
        return drained, again

    drained, again = asyncio.run(_run())
    assert any(f["type"] == "call_invite" for f in drained)
    # Drained once, not replayed forever.
    assert again == []


def test_a_peer_going_away_ends_its_call():
    from core.vortex_calls import CallRegistry

    async def _run():
        registry = CallRegistry()
        call, _ = await registry.start(caller="unit:a", callee="unit:b",
                                       owner_user_id=OWNER)
        await registry.end_all_for("unit:b", reason="peer_gone")
        state, reason = call.state, call.end_reason
        await registry.reset()
        return state, reason

    state, reason = asyncio.run(_run())
    assert state == "ended" and reason == "peer_gone"


# ---------------------------------------------------------------------------
# Calls — consent
# ---------------------------------------------------------------------------

def test_video_downgrades_to_audio_without_consent(headers):
    """
    A unit without the `video_calls` purpose gets an audio call, not a
    refusal and not a request it would refuse. Downgrading respects the
    consent boundary; asking anyway would be routing around it.
    """
    from core.vortex_calls import negotiate_mode, participant_id

    silent_id, _ = _pair(headers, _room("study"))                       # no camera
    seeing_id, _ = _pair(headers, _room("den"), video_calls=True)

    async def _run():
        without = await negotiate_mode(
            "video", participant_id(unit_id=seeing_id),
            participant_id(unit_id=silent_id))
        both = await negotiate_mode(
            "video", participant_id(unit_id=seeing_id),
            participant_id(user_id=OWNER))
        return without, both

    (mode, note), (both_mode, _) = asyncio.run(_run())
    assert mode == "audio"
    assert "aren't switched on" in note and "study" in note
    # A consenting unit calling a phone stays video.
    assert both_mode == "video"


def test_audio_intercom_needs_no_camera_at_all(headers):
    from core.vortex_calls import negotiate_mode

    async def _run():
        return await negotiate_mode("audio", "unit:a", "unit:b")

    mode, note = asyncio.run(_run())
    assert mode == "audio" and note == ""


# ---------------------------------------------------------------------------
# Calls — HTTP surface
# ---------------------------------------------------------------------------

def test_calls_require_authentication():
    assert client.post("/api/vortex/calls",
                       json={"to": "kitchen"}).status_code == 401
    assert client.get("/api/vortex/calls/targets").status_code == 401


def test_a_phone_can_ring_a_room(headers):
    """The phone app and a hub are two addresses of the same kind."""
    room = _room("hallway")
    unit_id, _ = _pair(headers, room)

    r = client.post("/api/vortex/calls",
                    json={"to": room, "mode": "audio"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["caller"] == f"user:{OWNER}"
    assert body["callee"] == f"unit:{unit_id}"
    assert body["state"] == "ringing"
    assert body["is_caller"] is True
    assert "ice_servers" in body


def test_ringing_an_unknown_room_is_a_404(headers):
    r = client.post("/api/vortex/calls",
                    json={"to": "dungeon"}, headers=headers)
    assert r.status_code == 404


def test_a_ringing_call_takes_over_the_callee_screen(headers):
    """
    `critical`: an intercom is time-limited and somebody is waiting. A card
    that sits politely below the clock is a call nobody answers.
    """
    from core.vortex_surfaces import get_surface_publisher

    room = _room("porch")
    unit_id, _ = _pair(headers, room)
    r = client.post("/api/vortex/calls", json={"to": room}, headers=headers)
    call_id = r.json()["call_id"]

    card = asyncio.run(get_surface_publisher().find(f"call:{call_id}"))
    assert card is not None
    assert card.priority == "critical"
    assert card.speech and "phone" in card.speech
    labels = {a["label"] for a in card.actions}
    assert labels == {"Answer", "Decline"}


def test_answering_from_the_card_connects_the_call(headers):
    """However someone picks up, one code path decides whether they may."""
    from core.vortex_actions import run_surface_action
    from core.vortex_calls import get_call_registry

    room = _room("landing")
    unit_id, _ = _pair(headers, room)
    call_id = client.post("/api/vortex/calls", json={"to": room},
                          headers=headers).json()["call_id"]

    result = asyncio.run(run_surface_action(
        surface_id=f"call:{call_id}", intent=f"call.answer.{call_id}",
        unit_id=unit_id, user_id=OWNER))
    assert result["status"] == "ok"
    assert get_call_registry().get(call_id).state == "active"


def test_declining_from_the_card_ends_the_call(headers):
    from core.vortex_actions import run_surface_action
    from core.vortex_calls import get_call_registry

    room = _room("utility")
    unit_id, _ = _pair(headers, room)
    call_id = client.post("/api/vortex/calls", json={"to": room},
                          headers=headers).json()["call_id"]

    result = asyncio.run(run_surface_action(
        surface_id=f"call:{call_id}", intent=f"call.decline.{call_id}",
        unit_id=unit_id, user_id=OWNER))
    assert result["status"] == "ok"
    call = get_call_registry().get(call_id)
    assert call.state == "ended" and call.end_reason == "declined"


def test_ice_servers_default_to_lan_only(monkeypatch):
    """
    Nothing is defaulted to a public STUN server — that would quietly send
    every household's IP to a third party to solve a problem two devices on
    the same switch do not have.
    """
    import core.vortex_calls as calls
    from config.settings import get_settings

    assert calls.ice_servers() == []

    settings = get_settings()
    monkeypatch.setattr(settings, "vortex_ice_servers",
                        '[{"urls": "stun:stun.example.org:3478"}]',
                        raising=False)
    assert calls.ice_servers() == [{"urls": "stun:stun.example.org:3478"}]

    # Malformed config degrades to LAN-only rather than breaking every call.
    monkeypatch.setattr(settings, "vortex_ice_servers", "not json",
                        raising=False)
    assert calls.ice_servers() == []


# ---------------------------------------------------------------------------
# Casting
# ---------------------------------------------------------------------------

def test_cast_target_resolution(monkeypatch):
    """
    Exact ids beat names, names beat partials, and an ambiguous partial
    prefers a real screen over a hub rather than picking the first match.
    """
    import core.vortex_cast as cast_module

    targets = [
        {"kind": "media_player", "id": "media_player.living_room_tv",
         "name": "Living Room TV"},
        {"kind": "media_player", "id": "media_player.bedroom_tv",
         "name": "Bedroom TV"},
        {"kind": "unit", "id": "vx-lr", "name": "living room",
         "room": "living room"},
    ]

    async def _targets(user_id):
        return targets

    monkeypatch.setattr(cast_module, "list_targets", _targets)

    async def resolve(query):
        return await cast_module.resolve_target(query, OWNER)

    assert asyncio.run(resolve("media_player.bedroom_tv"))["id"] == \
        "media_player.bedroom_tv"
    assert asyncio.run(resolve("Living Room TV"))["id"] == \
        "media_player.living_room_tv"
    # "living room" matches both the TV and the hub; the screen wins.
    assert asyncio.run(resolve("living room"))["kind"] == "media_player"
    # "TV" matches two screens and neither is a safe guess.
    assert asyncio.run(resolve("TV")) is None
    assert asyncio.run(resolve("dungeon")) is None


def test_casting_calls_home_assistant_not_a_cast_library(monkeypatch):
    """
    HA already runs pychromecast and already has every target discovered.
    Casting is a `media_player.play_media` call, not a second implementation
    of the Cast protocol on this box.
    """
    import core.vortex_cast as cast_module

    calls = []

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def call_service(self, domain, service, **kwargs):
            calls.append((domain, service, kwargs))

    monkeypatch.setattr(
        "providers.smart_home.home_assistant.build_ha_client", lambda: _Client())

    target = {"kind": "media_player", "id": "media_player.living_room_tv",
              "name": "Living Room TV"}

    result = asyncio.run(cast_module.cast(
        user_id=OWNER, target=target, url="https://stream.example/x.m3u8",
        content_type="video", title="Blue Planet"))

    assert result["status"] == "ok"
    domain, service, kwargs = calls[0]
    assert (domain, service) == ("media_player", "play_media")
    assert kwargs["entity_id"] == "media_player.living_room_tv"
    assert kwargs["media_content_id"] == "https://stream.example/x.m3u8"
    assert kwargs["media_content_type"] == "video"
    assert "Blue Planet" in result["message"]


def test_casting_nothing_is_refused():
    import core.vortex_cast as cast_module

    result = asyncio.run(cast_module.cast(
        user_id=OWNER,
        target={"kind": "media_player", "id": "media_player.tv", "name": "TV"},
        url=""))
    assert result["status"] == "error"


def test_casting_to_a_unit_queues_a_poll_command(headers):
    """
    Casting is slow and offline-tolerant, which is what the existing
    /commands poll is for — a unit briefly offline still gets it.
    """
    import core.vortex_cast as cast_module

    room = _room("loft")
    unit_id, device = _pair(headers, room)
    target = {"kind": "unit", "id": unit_id, "name": room, "room": room}

    result = asyncio.run(cast_module.cast(
        user_id=OWNER, target=target, url="https://stream.example/y",
        title="Something"))
    assert result["status"] == "ok" and result["command_id"]

    queued = client.get(f"/api/vortex/commands?unit_id={unit_id}",
                        headers=device)
    assert queued.status_code == 200
    body = queued.json()
    assert body["command"] == "cast"
    assert body["params"]["url"] == "https://stream.example/y"
    assert body["params"]["target"] == room


def test_cast_voice_parsing():
    from core.intent_router import _CAST_PATTERN, _STOP_CAST_PATTERN

    match = _CAST_PATTERN.match("cast Blue Planet to the living room TV")
    assert match.group("what") == "Blue Planet"
    assert match.group("where") == "living room TV"

    assert _STOP_CAST_PATTERN.search("stop casting to the bedroom") \
        .group("where") == "bedroom"
    assert _CAST_PATTERN.match("play some jazz") is None


# ---------------------------------------------------------------------------
# Face match
# ---------------------------------------------------------------------------

def test_face_endpoints_require_auth():
    assert client.get("/api/face-id/me").status_code == 401
    assert client.get("/api/face-id/status").status_code == 401
    assert client.delete("/api/face-id/me").status_code == 401


def test_face_status_explains_itself(headers):
    """
    "Face match is unavailable because the models have not been fetched" is a
    sentence someone can act on. A disabled button with no reason is not.
    """
    r = client.get("/api/face-id/status", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["available"], bool)
    if not body["available"]:
        assert body["reason"], "unavailable must always come with a reason"
        assert "fetch_face_models" in body["reason"] or "OpenCV" in body["reason"]


def test_not_enrolled_is_a_clean_answer(headers):
    r = client.get("/api/face-id/me", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"enrolled": False, "sample_count": 0,
                        "enrolled_at": None, "last_updated": None}


def test_enrolling_a_tiny_file_is_rejected(headers):
    r = client.post("/api/face-id/enroll",
                    files={"file": ("f.jpg", b"tiny", "image/jpeg")},
                    headers=headers)
    assert r.status_code == 400


def test_missing_models_are_a_503_not_a_no_match(headers):
    """
    A missing model must never read as "that isn't you" — the two lead a
    person to very different conclusions about their own house.
    """
    from providers.face_id.face_id_provider import (
        FaceModelsUnavailable, get_face_id_provider,
    )

    provider = get_face_id_provider()
    availability = asyncio.run(provider.availability())
    if availability["available"]:
        pytest.skip("face models are installed in this environment")

    with pytest.raises(FaceModelsUnavailable):
        asyncio.run(provider.identify(b"\xff\xd8\xff" + b"0" * 2048))

    r = client.post("/api/face-id/enroll",
                    files={"file": ("f.jpg", b"\xff\xd8\xff" + b"0" * 2048,
                                    "image/jpeg")},
                    headers=headers)
    assert r.status_code == 503
    assert "fetch_face_models" in r.json()["detail"]


def test_the_vortex_backend_returns_none_rather_than_a_weak_match(monkeypatch):
    """
    The provider decides the match against its own calibrated threshold, and
    the Vortex hook honours that decision rather than re-thresholding a cosine
    score whose scale it does not know.
    """
    import providers.face_id.face_id_provider as face

    async def _below(image, threshold=None):
        return {"matched": False, "reason": "below_threshold",
                "confidence": 0.30}

    async def _above(image, threshold=None):
        return {"matched": True, "user_id": "u-1", "confidence": 0.71}

    provider = face.get_face_id_provider()

    monkeypatch.setattr(provider, "identify", _below)
    assert asyncio.run(face.match(b"x", OWNER)) is None

    monkeypatch.setattr(provider, "identify", _above)
    result = asyncio.run(face.match(b"x", OWNER))
    assert result == {"user_id": "u-1", "confidence": 0.71, "matched": True}


def test_a_face_match_is_a_factor_not_an_authorisation():
    """
    Invariant 2 does not consult face recognition. However confident the
    match, a unit still cannot open a lock.
    """
    from core.intent_router import (
        ORIGIN_VORTEX_UNIT, RequestOrigin, evaluate_device_request,
    )

    unit = RequestOrigin(kind=ORIGIN_VORTEX_UNIT, unit_id="vx-1")
    decision = evaluate_device_request(action="unlock",
                                       entity_id="lock.front_door",
                                       origin=unit)
    assert decision.denied and decision.reason == "vortex_hard_deny"
