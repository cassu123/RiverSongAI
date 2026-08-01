# River Vortex — the server half

River Vortex is the physical device layer of the ecosystem: Raspberry Pi smart
displays and screenless speakers, one per room. The units are **thin clients**.
No model runs on them, they do no intent recognition, and they hold no
privileged credentials. They render and they listen; this server decides.

This document describes the half that lives here. The device half lives in
`cassu123/river-vortex` and its `README.md` documents the endpoints the unit
exposes.

---

## Invariants

These are load-bearing. The device layer is built assuming they hold, and each
one is enforced in code rather than by convention.

| # | Invariant | Where it is enforced |
|---|---|---|
| 1 | A unit never decides permission | `core/intent_router.evaluate_device_request` — every voice command, tapped card button and device-grid toggle goes through it |
| 2 | Locks, garage doors and alarm disarm are **hard-denied** to units | `UNIT_DENIED_DOMAINS` + `_GARAGE_PATTERN`, refused at the router with a log line saying why |
| 3 | Units never hold Home Assistant credentials | All device state and control flows through `api/routes/home.py`; camera snapshots are proxied, never handed over as HA URLs |
| 4 | A unit never self-asserts identity | `core.vortex_units.resolve_owner` resolves the user from the pairing record; no route accepts a `user_id` from a device |
| 5 | Second factors are entered on the touchscreen, never spoken | `POST /api/vortex/confirm` is HTTP-only and is never reachable from a transcript |
| 6 | Camera consent is per purpose and lives on the unit | `camera_purpose_enabled` gates every request; an unconsented purpose answers **409**, distinct from a hardware fault, and is never retried around |
| 7 | Anything pushed to a screenless unit must carry `speech` | `SurfacePublisher._for_unit` derives speech from the card text when a publisher forgets |

---

## Modules

| Module | Responsibility |
|---|---|
| `core/vortex_security.py` | Token hashing and constant-time comparison, pairing lockout, pending confirmations, second-factor verification |
| `core/vortex_units.py` | Unit profiles: owner, room, display, camera capability. Room → unit resolution |
| `core/vortex_hub.py` | The live WebSocket registry and every server → unit push, including the amplitude envelope |
| `core/vortex_surfaces.py` | Card validation, the per-unit card set, room-aware publishers and their withdrawals |
| `core/vortex_replica.py` | The unit's local copy: devices, cameras, notifications, rooms, weather, wake word. Section-level versioning |
| `core/vortex_actions.py` | Device control, card actions and confirmation redemption — all through the permission model |
| `core/vortex_voice.py` | Utterance handling and TTS, plus the orb's presence vocabulary |
| `core/vortex_vision.py` | Snapshot storage and retention, face identification |
| `core/vortex_media.py` | Resolve-vs-play split, room targeting, transport routing |
| `api/routes/vortex.py` | Everything device-facing |

---

## Endpoints

`api/routes/fleet.py` already owns `/register`, `/heartbeat`, `/telemetry`,
`/alerts` and the `/commands` poll under the same `/api/vortex` prefix. Those
are unchanged; the poll is still the right channel for slow, offline-tolerant
operations like `restart` and `run_scene`.

### Pairing

A fresh unit has no credential, so the first two are necessarily open. **The
code alone never mints a token** — approval does, and approval requires a
logged-in user. Both open routes count against one shared lockout, because 8
digits is 10⁸ and an attacker hammering either is enumerating the same space.

```
POST   /api/vortex/pair/request     {code, metadata}       open
GET    /api/vortex/pair/status?code=...                    open, returns the token once
POST   /api/vortex/pair/approve     {code, name, room}     JWT
GET    /api/vortex/pair/pending                            JWT
POST   /api/vortex/profiles/{id}/adopt                     JWT — for units claimed the old way
```

The unit polls outbound. Nothing here ever connects inbound to a Pi.

### The live channel

```
WS     /api/vortex/ws?unit_id=...
```

Refuses an unknown unit before `accept()`. The first frame must be
`{"type":"auth","unit_id":…,"token":…}`, validated with `hmac.compare_digest`;
no valid auth frame within five seconds and the socket is dropped.

**Unit → server:** `audio_chunk`, `state`, `ack`, `occupancy`, `camera_state`,
`ping`.

**Server → unit:** `presence`, `amplitude`, `audio`, `surface`,
`surface_withdraw`, `navigate`, `replica`, `devices_update`, `cameras_update`,
`notifications_update`, `media`.

`presence.state` is one of `idle | listening | thinking | speaking | acting |
error`. This vocabulary is fixed — it comes from `prototypes/presence-orb.html`
and the hub refuses to send anything else rather than letting an unknown state
reach a renderer that will silently drop it.

### The replica

```
GET    /api/vortex/replica?unit_id=...&since=<version>     X-Unit-Token
```

Sections: `devices`, `cameras`, `notifications`, `rooms`, `weather`,
`weather_alerts`, `wake_word`, plus a `unit` block. Each is versioned
independently, so `since` returns only what moved. A `since` ahead of the
current version — this server restarted and its counter went back — falls back
to a full snapshot rather than silently returning nothing.

Weather rides here rather than on `/api/feeds/weather` because a unit holds a
unit token, not a user JWT, and because the ambient screen should keep showing
conditions while this server is unreachable.

### Surfaces

```
GET    /api/vortex/v1/surfaces?unit_id=...                 X-Unit-Token
POST   /api/vortex/v1/surfaces                             JWT
DELETE /api/vortex/v1/surfaces/{id}                        JWT
POST   /api/vortex/v1/surface-action                       X-Unit-Token
```

Pushing the same `id` **replaces** the card and never stacks a second one, so
ids should be stable and meaningful: `garage`, `shopping-list`, `doorbell`.

Priority is physical, not decorative:

| Priority | What the unit does |
|---|---|
| `ambient` | Idle filler, shown only when nothing else wants the screen |
| `normal` | Sits beside the clock |
| `high` | Wakes the panel from backlight-off and speaks aloud |
| `critical` | Takes over the whole display over any page and cuts off playing audio |

`high` and `critical` are physical interruptions in a bedroom at 3am.
Doorbells, smoke, water. Not deliveries. Every `critical` publish is logged
with the `source` that raised it.

`surface-action` re-runs the tapped intent through the intent router with the
same checks as a voice command. A confirm card on a wall panel is a prompt, not
an authorisation. It returns 2xx only when the action was accepted — the unit
leaves the card up on anything else, so a tap that did not land never looks
like one that did.

Ready-made publishers live in `core/vortex_surfaces.py`:
`publish_shopping_list`, `publish_reminder`, `publish_weather_alert`,
`publish_doorbell`, `publish_motion_snapshot`, `publish_cooking_step`.

### Actions

```
POST   /api/vortex/devices/toggle    {unit_id, entity_id}          X-Unit-Token
POST   /api/vortex/devices/control   {unit_id, entity_id, action}  X-Unit-Token
POST   /api/vortex/confirm           {unit_id, challenge_id, code} X-Unit-Token
```

Three outcomes, uniform across every path:

- `ok` — done.
- `denied` (**403**) — hard-denied by invariant 2, or a second factor is
  impossible on a screenless unit.
- `pending_confirmation` — a challenge id was minted and a `confirm` card
  pushed to the unit. Nothing executed. The permission decision is taken again
  at redemption time, so a confirmation cannot buy past the hard deny.

### Voice

```
POST   /api/vortex/tts   {unit_id, text}   X-Unit-Token   → audio/wav
```

Same Piper (or Kokoro/ElevenLabs) path as every other voice surface, so a unit
and the browser sound identical. The `amplitude` stream for the orb is emitted
off this same synthesis — the envelope is in hand at exactly that moment, and
the unit plays an opaque blob it cannot measure.

### Cameras

```
GET    /api/vortex/camera/{entity_id}/snapshot   X-Unit-Token   proxied from HA
POST   /api/vortex/camera/frames                 X-Unit-Token   identification
POST   /api/vortex/camera/snapshot               X-Unit-Token   motion snapshot
GET    /api/vortex/snapshots/{id}?exp=&sig=      signed URL
```

The unit sends pixels and gets back a decision. It never receives a roster of
faces or an embedding database.

**Retention: 24 hours.** Snapshots are deleted from disk by the
`vortex_snapshots` sweep, not merely made unreachable — a link that stops
working over a file still on disk is not retention. Identification frames are
never written to disk at all. These are cameras in bedrooms.

Face recognition needs a backend configured at `VORTEX_FACE_BACKEND`. Without
one this server answers "I can see someone, but I can't tell who yet" rather
than inventing a match. It is a second factor and never an authorisation:
invariant 2 stands regardless of how confidently a face is matched.

---

## Not yet built

- **Task 3 — cooking sessions.** `cook_now` still returns steps and forgets.
  `publish_cooking_step` is ready for a session to drive it; the session model,
  its timers and the step endpoints are not written.
- **Task 3c — casting.** `core/fleet_simulator.py` accepts `cast`/`stop_cast`
  and tracks a `cast_target`; neither side implements it.
- **Task 8b — video calls.** The audio intercom is not yet extended to video,
  and no signalling path exists.
