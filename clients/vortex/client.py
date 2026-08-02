"""
clients/vortex/client.py

River Vortex voice client — runs ON the hub device, not on the server.

The loop is: listen locally for the wake word, record until the speaker
stops, ship the clip to River Song, play the reply. Audio only leaves the
device after the wake word fires; before that, nothing is transmitted
anywhere.

Runs the same on a Raspberry Pi, a spare laptop, or anything else with a mic
and a speaker, so the chain can be proven on whatever hardware is already
lying around before committing to a Pi build.

Setup:
    pip install -r clients/vortex/requirements.txt

Run:
    export VORTEX_SERVER=http://river-song.local:8000
    export VORTEX_TOKEN=<matches WILLOW_DEVICE_TOKEN on the server>
    python -m clients.vortex.client

Wake word models come from openWakeWord, which is free and open -- the same
engine the server side already expects. (The v1.0 ecosystem doc says
Porcupine; that is Picovoice, which is licensed past a free tier.)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from typing import Optional

from clients.vortex.protocol import (
    MSG_AUDIO,
    MSG_RESPONSE,
    MSG_TRANSCRIPT,
    build_audio_frame,
    build_ws_url,
    parse_server_message,
    pcm16_to_wav,
)

logger = logging.getLogger("vortex")

SAMPLE_RATE = 16_000
FRAME_MS = 80
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000

# How long the speaker must be quiet before the clip is considered finished.
SILENCE_HANGOVER_S = 1.2
# Hard ceiling so a noisy room cannot record forever.
MAX_UTTERANCE_S = 15.0
# Amplitude below which a frame counts as silence, as a fraction of full
# scale. Deliberately generous -- a hub sits across the room, not on a desk.
SILENCE_THRESHOLD = 0.015

# Reconnect backoff. A hub in a back bedroom must ride out a server restart
# without anyone walking over to it.
RECONNECT_MIN_S = 1.0
RECONNECT_MAX_S = 60.0


class VortexClient:
    """Wake word → record → send → play, with reconnect."""

    def __init__(
        self,
        server: str,
        token: str,
        user_id: str = "default",
        wake_model: str = "hey_river",
        input_device: Optional[int] = None,
        output_device: Optional[int] = None,
        threshold: float = 0.5,
    ) -> None:
        self._url = build_ws_url(server, token, user_id)
        self._safe_url = build_ws_url(server, "***", user_id)
        self._wake_model = wake_model
        self._input_device = input_device
        self._output_device = output_device
        self._threshold = threshold
        self._oww = None

    # -- wake word ---------------------------------------------------------

    def _load_wake_word(self):
        """
        Load openWakeWord, or None to run in always-listening mode.

        A missing wake-word engine is not fatal: push-to-talk and testing
        both want a client that records on demand. It is logged loudly
        because it is a meaningful change in behaviour, not a detail.
        """
        try:
            from openwakeword.model import Model
        except ImportError:
            logger.warning(
                "openwakeword not installed — running without wake word "
                "(press Enter to talk). Install: pip install openwakeword"
            )
            return None

        try:
            model = Model(wakeword_models=[self._wake_model])
            logger.info("Wake word model loaded: %s", self._wake_model)
            return model
        except Exception as exc:
            logger.warning(
                "Could not load wake word model %r (%s) — running without "
                "wake word.", self._wake_model, exc,
            )
            return None

    # -- audio -------------------------------------------------------------

    def _record_utterance(self, stream) -> bytes:
        """
        Record until the speaker stops, or MAX_UTTERANCE_S.

        Returns raw 16-bit PCM. Endpointing is amplitude-based rather than a
        neural VAD: it is a fraction of the cost, and a hub only needs to
        answer "is anyone still talking", which loudness answers well enough
        in a normal room.
        """
        import numpy as np

        frames = []
        silent_for = 0.0
        recorded = 0.0

        while recorded < MAX_UTTERANCE_S:
            block, _ = stream.read(FRAME_SAMPLES)
            mono = block[:, 0] if block.ndim > 1 else block
            frames.append(mono.copy())

            recorded += FRAME_MS / 1000.0
            if float(np.abs(mono).mean()) < SILENCE_THRESHOLD:
                silent_for += FRAME_MS / 1000.0
                if silent_for >= SILENCE_HANGOVER_S:
                    break
            else:
                silent_for = 0.0

        if not frames:
            return b""

        pcm = np.concatenate(frames)
        return (pcm * 32767).astype("<i2").tobytes()

    def _play(self, audio: bytes, fmt: str) -> None:
        """
        Play a reply.

        WAV is decoded inline. Anything else (ElevenLabs mp3) needs a decoder
        the device may not have, so it is reported rather than silently
        dropped -- a hub that goes quiet with no explanation is the worst
        failure mode here.
        """
        if fmt != "wav":
            logger.warning(
                "Reply came back as %s; this client decodes wav only. "
                "Use a local TTS (Piper/Kokoro) on the server.", fmt,
            )
            return

        try:
            import io
            import wave

            import numpy as np
            import sounddevice as sd

            with wave.open(io.BytesIO(audio), "rb") as wf:
                rate = wf.getframerate()
                channels = wf.getnchannels()
                pcm = np.frombuffer(
                    wf.readframes(wf.getnframes()), dtype="<i2")

            samples = pcm.astype("float32") / 32768.0
            if channels > 1:
                samples = samples.reshape(-1, channels)

            sd.play(samples, rate, device=self._output_device)
            sd.wait()
        except Exception as exc:
            logger.error("Playback failed: %s", exc)

    # -- main loop ---------------------------------------------------------

    async def run(self) -> None:
        """Connect and serve turns forever, reconnecting on failure."""
        try:
            import sounddevice as sd
            import websockets
        except ImportError as exc:
            raise SystemExit(
                f"Missing dependency: {exc.name}. "
                "Install with: pip install -r clients/vortex/requirements.txt"
            ) from exc

        self._oww = self._load_wake_word()
        backoff = RECONNECT_MIN_S

        while True:
            try:
                logger.info("Connecting to %s", self._safe_url)
                async with websockets.connect(self._url) as ws:
                    logger.info("Connected. Listening.")
                    backoff = RECONNECT_MIN_S
                    with sd.InputStream(
                        samplerate=SAMPLE_RATE,
                        channels=1,
                        dtype="float32",
                        blocksize=FRAME_SAMPLES,
                        device=self._input_device,
                    ) as stream:
                        await self._serve_turns(ws, stream)

            except KeyboardInterrupt:
                raise
            except Exception as exc:
                logger.warning(
                    "Connection lost (%s); retrying in %.0fs", exc, backoff)
                await asyncio.sleep(backoff)
                # Exponential backoff, capped -- a server down for an hour
                # should not mean a hub hammering it once a second.
                backoff = min(backoff * 2, RECONNECT_MAX_S)

    async def _serve_turns(self, ws, stream) -> None:
        """Handle turns on an open connection until it drops."""
        import numpy as np

        while True:
            if self._oww is not None:
                block, _ = await asyncio.to_thread(stream.read, FRAME_SAMPLES)
                mono = block[:, 0] if block.ndim > 1 else block
                pcm16 = (mono * 32767).astype("<i2")

                scores = self._oww.predict(pcm16)
                if not any(s >= self._threshold for s in scores.values()):
                    continue
                logger.info("Wake word detected.")
                self._oww.reset()
            else:
                await asyncio.to_thread(
                    input, "Press Enter to talk (no wake word)...")

            pcm = await asyncio.to_thread(self._record_utterance, stream)
            if not pcm:
                continue

            logger.info("Sending %.1fs of audio.", len(pcm) / 2 / SAMPLE_RATE)
            await ws.send(build_audio_frame(pcm16_to_wav(pcm, SAMPLE_RATE)))

            await self._receive_turn(ws)

    async def _receive_turn(self, ws) -> None:
        """
        Read frames until the reply audio arrives.

        The audio event is the last thing a turn emits, so it doubles as the
        end-of-turn marker. The timeout keeps a dropped reply from wedging
        the device: a hub that stops responding to its wake word looks
        broken, even when the connection is technically fine.
        """
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
            except asyncio.TimeoutError:
                logger.warning("Timed out waiting for a reply; listening again.")
                return

            msg = parse_server_message(raw)

            if msg.kind == MSG_TRANSCRIPT:
                logger.info("Heard: %s", msg.text)
            elif msg.kind == MSG_RESPONSE:
                logger.info("River: %s", msg.text)
            elif msg.kind == MSG_AUDIO and msg.audio:
                await asyncio.to_thread(self._play, msg.audio, msg.format or "wav")
                return


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description="River Vortex voice client for hub devices.")
    parser.add_argument(
        "--server", default=os.getenv("VORTEX_SERVER", "http://localhost:8000"),
        help="River Song base URL (env: VORTEX_SERVER)")
    parser.add_argument(
        "--token", default=os.getenv("VORTEX_TOKEN", ""),
        help="Must match WILLOW_DEVICE_TOKEN on the server (env: VORTEX_TOKEN)")
    parser.add_argument(
        "--user-id", default=os.getenv("VORTEX_USER_ID", "default"),
        help="Which user this hub speaks as (env: VORTEX_USER_ID)")
    parser.add_argument(
        "--wake-model", default=os.getenv("VORTEX_WAKE_MODEL", "hey_river"),
        help="openWakeWord model name or path (env: VORTEX_WAKE_MODEL)")
    parser.add_argument(
        "--threshold", type=float,
        default=float(os.getenv("VORTEX_WAKE_THRESHOLD", "0.5")),
        help="Wake word sensitivity, 0-1 (env: VORTEX_WAKE_THRESHOLD)")
    parser.add_argument("--input-device", type=int, default=None,
                        help="sounddevice input index (default: system)")
    parser.add_argument("--output-device", type=int, default=None,
                        help="sounddevice output index (default: system)")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if not args.token:
        parser.error(
            "No device token. Set VORTEX_TOKEN or pass --token. It must match "
            "WILLOW_DEVICE_TOKEN on the server; without it the server refuses "
            "every connection."
        )

    client = VortexClient(
        server=args.server,
        token=args.token,
        user_id=args.user_id,
        wake_model=args.wake_model,
        input_device=args.input_device,
        output_device=args.output_device,
        threshold=args.threshold,
    )

    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        logger.info("Shutting down.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
