"""
clients/vortex/protocol.py

Wire protocol for talking to River Song's /api/willow/ws endpoint.

Kept free of audio hardware and sockets on purpose: everything here is a
pure function over dicts and bytes, so the half of the client that has to be
*correct* can be tested without a microphone, a speaker, or a server.

Protocol, as implemented by api/routes/willow.py:

  Client -> server
    Auth      ?token=<TOKEN>&user_id=<USER> on the URL, or a first text frame
              {"type": "auth", "token": ..., "user_id": ...}
    Audio     {"type": "audio_data", "data": "<base64 wav>"}

  Server -> client
    {"type": "transcript", "text": ...}   what it heard
    {"type": "response",   "text": ...}   what it said
    {"type": "audio", "audio": "<base64>", "format": "wav"|"mp3"}

Note that audio travels as base64 inside JSON, not as binary frames. The
server accepts binary frames but currently discards them.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode, urlsplit, urlunsplit

# Server -> client message types this client understands.
MSG_TRANSCRIPT = "transcript"
MSG_RESPONSE = "response"
MSG_AUDIO = "audio"


@dataclass(frozen=True)
class ServerMessage:
    """
    One decoded message from River Song.

    kind:   "transcript" | "response" | "audio" | "unknown"
    text:   set for transcript and response
    audio:  decoded bytes for audio messages
    format: "wav" or "mp3", audio messages only
    """
    kind: str
    text: Optional[str] = None
    audio: Optional[bytes] = None
    format: Optional[str] = None


def build_ws_url(base_url: str, token: str, user_id: str = "default") -> str:
    """
    Build the authenticated WebSocket URL.

    Accepts an http(s) or ws(s) base and normalises the scheme, so both
    "http://river.local:8000" and "ws://river.local:8000" work. The path is
    appended only when the caller has not already given one, which keeps a
    fully-specified URL usable as-is.

    Credentials go on the query string because that is the one auth form a
    headless device can always manage -- no custom headers, no timing
    requirement on the first frame.
    """
    parts = urlsplit(base_url.rstrip("/"))

    scheme = {"http": "ws", "https": "wss"}.get(parts.scheme, parts.scheme)
    if scheme not in ("ws", "wss"):
        raise ValueError(
            f"Unsupported scheme {parts.scheme!r} in {base_url!r}; "
            "expected http, https, ws, or wss."
        )

    path = parts.path or ""
    if not path or path == "/":
        path = "/api/willow/ws"

    query = urlencode({"token": token, "user_id": user_id})
    return urlunsplit((scheme, parts.netloc, path, query, ""))


def build_auth_frame(token: str, user_id: str = "default") -> str:
    """
    Fallback auth frame, for transports that cannot set a query string.

    The server accepts this as the first text frame. Not needed when
    build_ws_url() carried the credentials, but harmless to send.
    """
    return json.dumps({"type": "auth", "token": token, "user_id": user_id})


def build_audio_frame(wav_bytes: bytes) -> str:
    """
    Wrap captured WAV bytes in the frame the server expects.

    Args:
        wav_bytes: A complete WAV file -- header included. The server hands
            these straight to the STT provider, which sniffs the RIFF header
            to decide how to decode.
    """
    encoded = base64.b64encode(wav_bytes).decode("ascii")
    return json.dumps({"type": "audio_data", "data": encoded})


def parse_server_message(raw: str) -> ServerMessage:
    """
    Decode one server frame.

    Never raises. Malformed JSON, unknown types, and undecodable base64 all
    come back as kind="unknown" -- a device in another room should not drop
    its connection because one frame was garbled.
    """
    try:
        payload = json.loads(raw)
    except Exception:
        return ServerMessage(kind="unknown")

    if not isinstance(payload, dict):
        return ServerMessage(kind="unknown")

    kind = payload.get("type")

    if kind in (MSG_TRANSCRIPT, MSG_RESPONSE):
        text = payload.get("text")
        return ServerMessage(
            kind=kind, text=text if isinstance(text, str) else "")

    if kind == MSG_AUDIO:
        encoded = payload.get("audio")
        if not isinstance(encoded, str):
            return ServerMessage(kind="unknown")
        try:
            audio = base64.b64decode(encoded)
        except Exception:
            return ServerMessage(kind="unknown")
        # Default to wav: that is what Piper and Kokoro emit, and older
        # servers omit the field entirely.
        fmt = payload.get("format") or "wav"
        return ServerMessage(
            kind=MSG_AUDIO,
            audio=audio,
            format=fmt if isinstance(fmt, str) else "wav",
        )

    return ServerMessage(kind="unknown")


def pcm16_to_wav(pcm: bytes, sample_rate: int = 16_000,
                 channels: int = 1) -> bytes:
    """
    Wrap raw 16-bit PCM in a WAV container.

    Microphone capture gives raw frames; the server's STT sniffs for a RIFF
    header to tell a WAV from raw PCM. Writing the 44-byte header by hand
    avoids a soundfile/libsndfile dependency on the device, which matters on
    a Pi image you want to keep small.
    """
    byte_rate = sample_rate * channels * 2
    block_align = channels * 2

    header = b"RIFF"
    header += (36 + len(pcm)).to_bytes(4, "little")
    header += b"WAVEfmt "
    header += (16).to_bytes(4, "little")        # PCM fmt chunk size
    header += (1).to_bytes(2, "little")         # audio format: PCM
    header += channels.to_bytes(2, "little")
    header += sample_rate.to_bytes(4, "little")
    header += byte_rate.to_bytes(4, "little")
    header += block_align.to_bytes(2, "little")
    header += (16).to_bytes(2, "little")        # bits per sample
    header += b"data"
    header += len(pcm).to_bytes(4, "little")

    return header + pcm
