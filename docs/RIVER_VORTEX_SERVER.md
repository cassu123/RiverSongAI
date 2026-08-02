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

---

## Cooking sessions

`cook_now` scales a recipe, hands back a step list and forgets it. A session is
what remembers, and it is household-scoped rather than per-device so the
kitchen Vortex, a phone and the browser are on the same step.

```
POST   /api/culinary/sessions                  {recipe_id, target_servings, equipment?}
GET    /api/culinary/sessions/current
GET    /api/culinary/sessions/{id}
POST   /api/culinary/sessions/{id}/step        {action: next|back|goto|repeat, index?}
POST   /api/culinary/sessions/{id}/timer       {seconds, label?, step_index?}
DELETE /api/culinary/sessions/{id}/timer/{tid}
POST   /api/culinary/sessions/{id}/end
```

`core/cooking_sessions.py` holds the logic; `api/routes/culinary_sessions.py`
is the HTTP surface and `core/intent_router` routes the voice commands. All
three share one code path, so "next" over the microphone and "Next" tapped on
a wall panel are the same operation.

**Each step carries** its index, the total, the instruction, the ingredients
for *that step only*, and any timer the step's text implies. The canonical
field is **`instruction`**; `text` is emitted alongside it as the device's
tolerated alias, because a mismatch there leaves River silent on every step of
a recipe.

**Steps are materialised at start**, not derived per read. Scaling is cheap but
equipment translation is an LLM call, and re-deriving would re-run it on every
"next". It also means a recipe edited by someone else mid-cook does not change
the instructions under the person following them.

**Timers store a wall-clock deadline, never a countdown.** A countdown needs
something running to decrement it, so it loses exactly the time a reboot takes
— which is when you most want it to be right. A deadline is simply true
whenever it is next read.

**Every change is broadcast three ways**: the culinary WebSocket, the Vortex
WebSocket, and a `normal`-priority surface card on the kitchen unit. A timer
going off raises a `high` card — worth interrupting for, but a kitchen timer is
not a smoke alarm. Ending a session withdraws both.

Voice, while a session is active: `next`, `back`, `repeat`, "how much
`<ingredient>`", "set a timer for N", "how long left". With no session, the
handler returns nothing and the transcript goes to the LLM — so "how much do I
owe you" is not answered out of an ingredient list.

---

## Casting

```
GET    /api/vortex/cast/targets    X-Unit-Token
POST   /api/vortex/cast            {target, url | query, content_type, title}
POST   /api/vortex/cast/stop       {target}
```

There is no official Google Cast REST API. The practical route is
`pychromecast`, and **Home Assistant already runs it** — every Chromecast,
Android TV, Sonos and AirPlay target in the house is already a `media_player`
entity there, already discovered, already authenticated. So casting resolves a
target and calls `media_player.play_media` through `/api/home`. Nothing runs on
the Pi, and no Cast protocol is reimplemented here.

Resolution prefers a `media_player` over a hub whenever both match, even when
the hub matched more exactly: someone who named their living room hub "living
room" and says "cast this to the living room" means the screen. A query that
matches two screens resolves to neither rather than guessing.

Casting *through* a unit queues a `cast` fleet command rather than pushing over
the WebSocket — casting is slow and offline-tolerant, which is what the
`/commands` poll is for. The payload is:

```jsonc
{"command": "cast",
 "params": {"target": "living room", "url": "...", "content_type": "video",
            "title": "...", "artwork_url": "..."}}
```

`core/fleet_simulator.py` already accepts that command; **no real unit
implements it yet.** YouTube *video* casting specifically is reverse-engineered
and fragile, and is deliberately not attempted.

Voice: "cast Blue Planet to the living room TV", "stop casting to the bedroom".

---

## Intercom and video calls

```
GET    /api/vortex/calls/targets   rooms and people this caller can reach
POST   /api/vortex/calls           {to, mode}      ring
POST   /api/vortex/calls/answer    {call_id}
POST   /api/vortex/calls/end       {call_id}
POST   /api/vortex/calls/signal    {call_id, type, payload}
WS     /api/vortex/calls/ws?token= the phone app's signalling channel
```

**This server does signalling and nothing else.** Audio and video go directly
between the two endpoints — on a home LAN that is a couple of hops over the
switch, and none of it passes through here. SDP and ICE are forwarded verbatim;
the session description is never parsed or stored.

A call has two participants and either can be a hub or a person:

```
unit:<unit_id>   a Vortex hub, signalling over /api/vortex/ws
user:<user_id>   the phone app or a browser, over /api/vortex/calls/ws
```

Both are addressed the same way, so **kitchen-to-bedroom, phone-to-kitchen and
kitchen-to-phone are one code path**. A user may have several devices connected
at once — phone, tablet, browser tab. All of them ring and the first to answer
takes the call; closing one tab does not hang up on anybody.

**ICE.** Two devices on the same LAN connect on host candidates and need
nothing configured, which is why `vortex_ice_servers` is empty by default. A
phone on mobile data needs STUN and usually TURN — put them there as a JSON
array. Nothing is defaulted to a public STUN server, because that would quietly
send every household's IP to a third party to solve a problem most of these
calls do not have.

**Consent.** A video call to a unit whose owner has not enabled the
`video_calls` camera purpose connects as *audio*, with a note saying why. The
call still happens; it just does not carry video. Asking the unit anyway would
be routing around a refusal. Audio intercom needs no camera at all.

A ringing call raises a `critical` surface on the callee with Answer and
Decline — one of the few things that earns a takeover, because it is
time-limited and someone is waiting. Tapping either goes through the same
registry as the app, so however someone picks up, one code path decides whether
they may.

Voice, from a unit: "call the kitchen", "video call the living room".

---

## Face match

Enrolment lives in a user's own account, next to voice match, and the two APIs
are deliberately the same shape:

```
GET    /api/face-id/status    can this run at all, and why not
POST   /api/face-id/enroll    one image, adds a sample
GET    /api/face-id/me        enrolment status
DELETE /api/face-id/me        remove every print
POST   /api/face-id/identify  admin only, for debugging
```

Detection is YuNet, recognition is SFace, both through OpenCV. Neither model
ships with the wheel, so fetch them once:

```
python scripts/fetch_face_models.py
```

Prints live under `data/face_prints/<user_id>/` as a 112×112 aligned crop plus
its 128-float embedding — not the frame it came from. Nothing leaves the
machine. Deleting an enrolment removes the directory.

**Failure modes are kept distinct**, because they lead a person to very
different conclusions about their own house:

| Outcome | Means |
|---|---|
| `unavailable` / `no_detector` | Could not look — no OpenCV, or no model |
| `unavailable` / `no_recognition_backend` | Saw a face, has nothing to compare it to |
| `no_match` / `no_face_in_frame` | Looked, nobody in shot |
| `no_match` / `below_threshold` | Looked, saw someone, not a household member |

A missing model is never reported as "that isn't you".

The provider decides the match against SFace's calibrated cosine threshold
(0.363) and the Vortex hook honours that decision rather than re-thresholding a
score whose scale it does not know. `VORTEX_FACE_BACKEND` defaults to this
provider and can be pointed elsewhere.

**It is a second factor, never an authorisation.** Invariant 2 does not consult
it: however confident the match, a unit still cannot open a lock, a garage door
or an alarm.

---

## Streamed utterances

A unit sends one utterance as several `audio_chunk` frames and sets `final` on
the last. Non-final frames are buffered per unit and joined onto the final one
before transcription.

This matters more than it sounds. Before it, only the final frame survived, so
an utterance had to fit in a single 128 KB frame — 4.1 seconds at 16 kHz mono
s16le. Anything longer was dropped with a log line and the room got silence.
*"Set a timer for ten minutes"* fit. *"Put milk and eggs on the shopping list
and start the oven timer"* did not.

Two different caps, deliberately:

| Cap | Value | What it bounds |
|---|---|---|
| `MAX_AUDIO_CHUNK_BYTES` | 128 KB | one frame — a sane wire size |
| `MAX_UTTERANCE_BYTES` | 32 s | the accumulated total, per unit |

The total is what stops a unit that never sends `final` from growing the
buffer forever. It sits just above the device's own 30-second recording limit,
so a long-but-legitimate command is never what trips it. An utterance that
does pass the cap is dropped **whole** — half a command acted on is worse than
one that visibly failed — and the orb says so rather than going quiet.

The buffer is cleared on every `final` and on disconnect, so a half-spoken
command can never prepend itself to the next one. Chunks are raw PCM by
protocol; a WAV header on any of them is unwrapped before joining, because
`RIFF…RIFF…` decodes as only the first chunk and the rest would go quietly
missing.

---

## Willow — retired

`/api/willow/ws` is gone: the route, the `willow` fleet program, its claim
endpoint, the `willow_router` registration and the shared
`WILLOW_DEVICE_TOKEN` setting. No ESP32-S3 Box hardware exists and none is
planned, and a shared device token mounted with no owner is worse than no
endpoint — one secret across every device means any device can impersonate any
other, and a single leak re-keys the house.

Two things from that work are kept, because they are worth having on their own:

- **`fleet_units.owner_user_id`.** A unit acquires an identity from whoever
  claimed it, so it never has to assert one. A column rather than a metadata
  key: the device `register` call replaces metadata wholesale, so an owner
  stored there would be wiped the first time a unit came back online.
- **`unit_owner()`** in `api/routes/fleet.py` — the single place a
  unit-authenticated request turns into a user. It returns `""` for an
  unclaimed unit rather than a fallback account, because acting as some
  default would be guessing whose memory and settings to use.

---

## Not yet built

- **The device-side cast handler.** The command payload and the queueing are
  done here; `river-vortex` needs a handler for `cast` / `stop_cast`.
- **Call media on the device.** Signalling is complete on this side; the units
  need the WebRTC peer connection to match it.
