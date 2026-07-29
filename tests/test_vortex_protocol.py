"""Unit tests for clients.vortex.protocol.

Covers the wire format against what api/routes/willow.py actually implements.
Audio hardware is not exercised -- these are pure functions over dicts and
bytes, which is the point of keeping them in their own module.
"""

from __future__ import annotations

import base64
import io
import json
import wave

import pytest

from clients.vortex.protocol import (
    MSG_AUDIO,
    MSG_RESPONSE,
    MSG_TRANSCRIPT,
    build_audio_frame,
    build_auth_frame,
    build_ws_url,
    parse_server_message,
    pcm16_to_wav,
)


# ---------------------------------------------------------------------------
# URL building
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "base,expected_scheme",
    [
        ("http://river.local:8000", "ws"),
        ("https://riversongai.com", "wss"),
        ("ws://river.local:8000", "ws"),
        ("wss://riversongai.com", "wss"),
    ],
)
def test_scheme_is_normalised_to_websocket(base, expected_scheme):
    url = build_ws_url(base, "tok")
    assert url.startswith(f"{expected_scheme}://")


def test_default_path_matches_the_server_route():
    url = build_ws_url("http://river.local:8000", "tok")
    assert "/api/willow/ws" in url


def test_trailing_slash_does_not_double_up():
    url = build_ws_url("http://river.local:8000/", "tok")
    assert "//api" not in url.split("://", 1)[1]


def test_explicit_path_is_preserved():
    url = build_ws_url("http://river.local:8000/custom/ws", "tok")
    assert "/custom/ws" in url
    assert "/api/willow/ws" not in url


def test_credentials_land_on_the_query_string():
    url = build_ws_url("http://river.local:8000", "s3cret", "chris")
    assert "token=s3cret" in url
    assert "user_id=chris" in url


def test_user_id_defaults_to_default():
    assert "user_id=default" in build_ws_url("http://h:1", "tok")


def test_special_characters_in_token_are_encoded():
    url = build_ws_url("http://h:1", "a b&c=d")
    assert " " not in url
    assert "a+b%26c%3Dd" in url or "a%20b%26c%3Dd" in url


def test_unsupported_scheme_rejected():
    with pytest.raises(ValueError, match="Unsupported scheme"):
        build_ws_url("ftp://river.local", "tok")


# ---------------------------------------------------------------------------
# Outbound frames
# ---------------------------------------------------------------------------

def test_auth_frame_shape():
    payload = json.loads(build_auth_frame("tok", "chris"))
    assert payload == {"type": "auth", "token": "tok", "user_id": "chris"}


def test_audio_frame_shape_matches_server_expectation():
    payload = json.loads(build_audio_frame(b"RIFFfake"))
    assert payload["type"] == "audio_data"
    assert base64.b64decode(payload["data"]) == b"RIFFfake"


def test_audio_frame_roundtrips_binary_safely():
    raw = bytes(range(256)) * 4
    payload = json.loads(build_audio_frame(raw))
    assert base64.b64decode(payload["data"]) == raw


# ---------------------------------------------------------------------------
# Inbound frames
# ---------------------------------------------------------------------------

def test_transcript_message():
    msg = parse_server_message(
        json.dumps({"type": "transcript", "text": "turn off the lights"}))
    assert msg.kind == MSG_TRANSCRIPT
    assert msg.text == "turn off the lights"


def test_response_message():
    msg = parse_server_message(
        json.dumps({"type": "response", "text": "Done."}))
    assert msg.kind == MSG_RESPONSE
    assert msg.text == "Done."


def test_audio_message_is_decoded():
    encoded = base64.b64encode(b"RIFFdata").decode()
    msg = parse_server_message(
        json.dumps({"type": "audio", "audio": encoded, "format": "wav"}))
    assert msg.kind == MSG_AUDIO
    assert msg.audio == b"RIFFdata"
    assert msg.format == "wav"


def test_audio_format_defaults_to_wav_when_absent():
    """Older servers omitted the field; wav is what Piper and Kokoro emit."""
    encoded = base64.b64encode(b"RIFFdata").decode()
    msg = parse_server_message(json.dumps({"type": "audio", "audio": encoded}))
    assert msg.format == "wav"


def test_mp3_format_is_reported_not_assumed():
    encoded = base64.b64encode(b"ID3").decode()
    msg = parse_server_message(
        json.dumps({"type": "audio", "audio": encoded, "format": "mp3"}))
    assert msg.format == "mp3"


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        "",
        "[1, 2, 3]",
        '"a bare string"',
        json.dumps({"type": "something_new"}),
        json.dumps({"no_type": True}),
        json.dumps({"type": "audio"}),                      # missing payload
        json.dumps({"type": "audio", "audio": 12345}),      # wrong type
        json.dumps({"type": "audio", "audio": "!!!not base64!!!"}),
    ],
)
def test_malformed_frames_never_raise(raw):
    """A garbled frame must not drop a hub's connection."""
    assert parse_server_message(raw).kind == "unknown"


def test_missing_text_becomes_empty_string_not_none():
    msg = parse_server_message(json.dumps({"type": "response"}))
    assert msg.kind == MSG_RESPONSE
    assert msg.text == ""


# ---------------------------------------------------------------------------
# WAV framing
# ---------------------------------------------------------------------------

def test_wav_header_is_readable_by_the_wave_module():
    pcm = b"\x00\x01" * 800
    data = pcm16_to_wav(pcm, sample_rate=16_000)

    with wave.open(io.BytesIO(data), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getsampwidth() == 2
        assert wf.getframerate() == 16_000
        assert wf.readframes(wf.getnframes()) == pcm


def test_wav_starts_with_riff_so_the_server_detects_it():
    """whisper_local and providers/stt/audio.py both branch on this header."""
    assert pcm16_to_wav(b"\x00\x00").startswith(b"RIFF")


@pytest.mark.parametrize("rate", [8_000, 16_000, 44_100, 48_000])
def test_sample_rate_is_recorded_faithfully(rate):
    with wave.open(io.BytesIO(pcm16_to_wav(b"\x00\x00" * 10, rate)), "rb") as wf:
        assert wf.getframerate() == rate


def test_empty_pcm_still_produces_a_valid_wav():
    with wave.open(io.BytesIO(pcm16_to_wav(b"")), "rb") as wf:
        assert wf.getnframes() == 0


def test_stereo_framing():
    pcm = b"\x00\x01\x00\x02" * 100
    with wave.open(io.BytesIO(pcm16_to_wav(pcm, 16_000, channels=2)), "rb") as wf:
        assert wf.getnchannels() == 2
        assert wf.readframes(wf.getnframes()) == pcm


# ---------------------------------------------------------------------------
# Round trip against the server's own encoding
# ---------------------------------------------------------------------------

def test_client_decodes_what_the_server_encodes():
    """
    api/routes/willow.py sends base64.b64encode(wav_bytes).decode() under
    the "audio" key. Mirror that here so a change on either side fails.
    """
    original = pcm16_to_wav(b"\x10\x20" * 500)
    server_frame = json.dumps({
        "type": "audio",
        "audio": base64.b64encode(original).decode("ascii"),
        "format": "wav",
    })
    assert parse_server_message(server_frame).audio == original
