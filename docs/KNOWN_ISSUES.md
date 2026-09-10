# Known Issues

Wiring gaps, minor bugs, and deferred follow-ups noticed during the
2026-05-23 documentation remediation. None of these are blockers —
they are recorded here so the next session can address them deliberately
without re-discovering each one.

> **2026-09-10 update:** Items resolved in June 2026 (C-3 analytics flag,
> n8n router mounting, Sifter document indexer, Scribe analyze_note, CHRONOS
> shared/ root, RAG chunk settings, and HANDOFF memory path) have been removed
> per the style guide. Current open items and architectural notes follow.

---

## Warden daemon is a stub

`daemons/warden/warden.py::_main_loop()` is an idle sleep. Settings for YOLO + RTSP cameras
(`WARDEN_RTSP_CAMERAS`, `YOLO_MODEL`, `YOLO_CONFIDENCE`,
`YOLO_INFERENCE_DEVICE`) are reserved in `config/settings.py` but the real-time
vision inference pipeline is deferred.

---

## Kiosk surface archived 2026-05-24

The `/kiosk` page, Herald daemon, `/api/broadcast/*`, `/api/auth/ws-ticket/kiosk`,
and the `KIOSK_TOKEN` / `HUB_ENTITIES` / `KIOSK_URL` / `HERALD_ENABLED` /
`DAEMON_HERALD_PORT` settings were all removed from `main`. The full
implementation lives in branch **`archive/kiosk-v3`** on `origin` for
future reference.

**Why archived:** the original design used a Chromecast-style overlay
where the Hub's browser loaded `https://riversongai.com/kiosk` and
authenticated with a long-lived shared secret baked into the public JS
bundle. The user's revised plan is to do native device-app development
that talks to the backend directly (a generic `/ws/device`-style
endpoint with per-device credentials), not a browser overlay. The
kiosk approach was speculative scaffolding for hardware that was never
acquired and an architecture that's being replaced.

**Security side-effect of the archive:** the bundle-token exposure
path (kiosk secret reachable to anyone who could load `/kiosk` via
Cloudflare tunnel) is now closed. There is no `/kiosk` route, no
broadcast endpoint, no kiosk WS ticket endpoint, no kiosk secret to
expose.

**What was preserved on `main`:**

- `frontend/src/components/RiverSong.jsx` — the orb avatar (used by
  `ConversationPage`). Its `lipSyncOpen` prop is still wired as a
  future hook; it currently falls back to `audioLevel` for animation.
- `providers/voice_id/voice_id_provider.py` and `/api/voice-id/*` —
  Voice ID is feature-complete and lives on its own.
- The Pulse / Scribe / Sifter / Warden / Mechanic daemons — all
  unrelated to kiosk.

When real device-app development starts, see branch
`archive/kiosk-v3` for the lip-sync compute approach (per-20 ms RMS
on the TTS audio buffer in `daemons/herald/herald.py::_compute_lip_sync`)
— that algorithm is useful regardless of the transport.

---

## Daemon systemd template (System vs User)

**Note:** Daemons can run under either system-level systemd (`/etc/systemd/system/`)
requiring root, or user-level systemd (`~/.config/systemd/user/river-song-daemon@.service`)
which runs without sudo. Pulse is currently configured and active under
the user systemd service (`systemctl --user status river-song-daemon@pulse`).

---

## Notes on style

This file records issues; it doesn't track work. As issues are
resolved, **delete the relevant section** rather than marking it
"DONE". Resolved issues belong in git history, not in a permanent
known-issues list.
