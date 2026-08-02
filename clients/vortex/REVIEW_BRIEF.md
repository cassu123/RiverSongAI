# River Vortex — Code Review Brief

Paste the section below into a fresh thread. It is written to stand alone;
the reviewer has none of the conversation this code came out of.

---

## PROMPT — copy from here

Review the River Vortex hub client in the repo `cassu123/RiverSongAI`, branch
`claude/hugging-face-exploration-hd3268`.

### What River Vortex is

River Song is a self-hosted household AI. **Vortex** is its hub-device layer:
small always-on devices in each room (Raspberry Pi 4/5, 7"–10" touchscreen,
mic array, speaker) that give River a physical presence. Voice in, voice out,
audio never leaving the local network.

The **server** half already existed: `api/routes/willow.py`, a token-authed
WebSocket that accepts hardware voice devices and runs a full
`ConversationLoop` per connection.

The **client** half is what needs review — it runs ON the hub device.

### Files in scope

| File | Lines | What |
|---|---|---|
| `clients/vortex/client.py` | 345 | Wake word → record → send → play, with reconnect |
| `clients/vortex/protocol.py` | 178 | Pure wire-format functions (no I/O) |
| `clients/vortex/README.md` | — | Device setup, systemd unit |
| `tests/test_vortex_protocol.py` | 224 | 38 tests, protocol only |
| `api/routes/willow.py` | 128 | Server endpoint — read for the contract; one line changed |

Commit: `375b174 Add the River Vortex hub voice client`

### The protocol contract

Client → server:
- Auth via `?token=<T>&user_id=<U>` query params (also accepts a first
  `{"type":"auth",...}` text frame, or the WS subprotocol)
- Audio as `{"type":"audio_data","data":"<base64 wav>"}` — **JSON text frames,
  not binary**. The server receives binary frames and discards them.

Server → client:
- `{"type":"transcript","text":...}`
- `{"type":"response","text":...}`
- `{"type":"audio","audio":"<base64>","format":"wav"|"mp3"}`

The `format` field was added in this commit; the client defaults to `wav`
when it is absent so older servers still work.

### Deployment reality

- Target: Raspberry Pi 4/5, headless, systemd, unattended for weeks
- Also expected to run on a spare laptop/desktop for bring-up
- Server: AMD FX-8350, GTX 1050 Ti (4GB), 32GB RAM, Ubuntu
- Hard constraint: **local and free**. No paid services, no cloud APIs.
- Wake word is **openWakeWord** (free). The project's v1.0 design doc says
  Porcupine; that is Picovoice and licensed past a free tier, so the code
  intentionally diverges from the doc.

### What is already verified

- 38 tests pass, covering URL normalisation, both auth forms, frame encoding
  against what `willow.py` actually parses, malformed-input handling, WAV
  header framing at four sample rates, and a round trip against the server's
  own base64 encoding.
- The module imports and the CLI runs (`--help`, missing-token error path).

### What is NOT verified — and is the point of this review

**No audio hardware, no microphone, no speaker, and no running server were
available when this was written.** Everything below `protocol.py` is
unexercised. Assume the audio path is wrong until proven otherwise.

Specific things the author is uncertain about and wants checked:

1. **openWakeWord input format.** `_serve_turns` passes an int16 numpy array
   to `model.predict()`. Confirm that matches the library's expected dtype,
   shape, and frame size — and that 80ms frames (`FRAME_SAMPLES`) are what it
   wants. Getting this wrong means the wake word silently never fires.

2. **Lost audio at the start of an utterance.** Wake-word detection and
   recording read from the same stream sequentially. After detection, is the
   first syllable of the command already gone? A pre-roll ring buffer may be
   needed.

3. **WebSocket keepalive during recording.** `_record_utterance` blocks in a
   worker thread for up to 15 seconds while the connection sits idle. Can the
   `websockets` client library's ping/pong still run, or does the connection
   get dropped mid-utterance?

4. **Thread leak on the no-wake-word path.** The fallback calls
   `asyncio.to_thread(input, ...)`, which blocks forever. If the connection
   drops while it is waiting, that thread never returns. How bad is this in
   practice, and what is the clean fix?

5. **Audio device loss.** A USB mic unplugged, or a Pi audio glitch — the
   reconnect loop recreates the `InputStream`, but does a dead device produce
   an exception that reaches the handler, or does it hang?

6. **Silence detection is a guess.** `SILENCE_THRESHOLD = 0.015` mean
   amplitude, `SILENCE_HANGOVER_S = 1.2`. Untested against a real room. Is
   amplitude adequate, or is a proper VAD (e.g. silero) warranted for a device
   sitting across a room?

7. **No clean shutdown path.** The reconnect loop runs forever with no maximum
   attempts and no exit condition other than KeyboardInterrupt. Under systemd
   with `Restart=always`, is that right, or should it exit and let systemd
   restart it?

### Also worth a look

- Security: the device token is a single shared secret across all hubs. It
  appears in the WS URL query string and therefore in server logs. Given this
  is LAN-only, is that acceptable, and what would be the cheap improvement?
- `pcm16_to_wav` hand-writes a 44-byte WAV header to avoid a `soundfile`
  dependency on the device. Verify the header is correct for all the sample
  rates and channel counts it claims to support.
- The client decodes WAV only and logs a warning for MP3. Reasonable, or
  should it decode MP3 too?

### What is explicitly out of scope

Vortex's spec also calls for a touchscreen ambient display, intercom between
units, on-demand camera feeds, and 4G LTE fallback. None of that is built.
Voice only.

### Output wanted

Prioritised findings — what will actually break on a Pi in a real room, ranked
above style. Concrete fixes preferred over descriptions of problems. If the
audio pipeline design is wrong in a way that needs restructuring rather than
patching, say so plainly.

## PROMPT — copy to here
