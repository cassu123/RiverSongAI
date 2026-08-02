# River Vortex — Hub Client

The voice client that runs **on** a Vortex hub device, not on the River Song
server.

```
wake word (local) → record → WebSocket → River Song → play reply
```

Nothing is transmitted until the wake word fires. Before that, audio is
processed on the device and discarded.

## What it needs

A microphone, a speaker, and a network path to River Song. That's it — a
Raspberry Pi, a spare laptop, an old desktop. Prove the chain works on
whatever is already lying around before buying Pi hardware.

## Server side

Set a device token in the server's `.env`:

```
WILLOW_DEVICE_TOKEN=<a long random string>
```

Without it the server refuses every hub connection — there is no anonymous
fallback. Generate one with:

```
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Device side

```bash
pip install -r clients/vortex/requirements.txt

export VORTEX_SERVER=http://river-song.local:8000
export VORTEX_TOKEN=<the same token>
export VORTEX_USER_ID=default          # which user this hub speaks as

python -m clients.vortex.client
```

### Options

| Flag | Env | Default | Notes |
|---|---|---|---|
| `--server` | `VORTEX_SERVER` | `http://localhost:8000` | `http`/`https` are converted to `ws`/`wss` |
| `--token` | `VORTEX_TOKEN` | — | Required; must match the server |
| `--user-id` | `VORTEX_USER_ID` | `default` | Whose memory and settings this hub uses |
| `--wake-model` | `VORTEX_WAKE_MODEL` | `hey_river` | openWakeWord model name or path |
| `--threshold` | `VORTEX_WAKE_THRESHOLD` | `0.5` | Lower = more sensitive, more false triggers |
| `--input-device` | — | system default | `sounddevice` index |
| `--output-device` | — | system default | `sounddevice` index |

List audio devices:

```bash
python -c "import sounddevice; print(sounddevice.query_devices())"
```

## Without a wake word

If `openwakeword` isn't installed or the model won't load, the client falls
back to press-Enter-to-talk and says so in the log. That mode is for bring-up
and testing — it proves the network, audio capture, and playback all work
before you introduce wake-word tuning as a second variable.

## Wake word engine

This uses **openWakeWord**, which is free and open, and matches what the
River Song server already expects (`wake_word_model` in settings).

The v1.0 ecosystem document specifies Porcupine. Porcupine is Picovoice and
is licensed past a free tier; openWakeWord is not. The code is right and the
document is out of date.

## Reconnecting

The client reconnects on its own with exponential backoff, from 1s up to 60s.
A hub in a back bedroom rides out a server restart without anyone walking
over to it.

## Audio format

Replies are decoded as WAV, which is what Piper and Kokoro produce. If the
server is configured for ElevenLabs the reply arrives as MP3 and the client
logs a warning rather than playing noise — hubs should be paired with a local
TTS anyway.

## Running as a service

```ini
# /etc/systemd/system/vortex.service
[Unit]
Description=River Vortex hub client
After=network-online.target sound.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/RiverSongAI
Environment=VORTEX_SERVER=http://river-song.local:8000
Environment=VORTEX_TOKEN=<token>
ExecStart=/usr/bin/python3 -m clients.vortex.client
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now vortex
journalctl -u vortex -f
```

## Not built yet

This is the voice half of Vortex. The spec also calls for a touchscreen
ambient display, intercom between units, on-demand camera feeds, and 4G LTE
fallback. Voice first — it's the part that proves the whole chain.
