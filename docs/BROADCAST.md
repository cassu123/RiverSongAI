# Broadcast

Internal fan-out endpoint that daemons use to push real-time events to
every currently-connected WebSocket client. Today the only event in use
is `lip_sync` (from Herald during TTS playback), but the route is
generic enough to add more.

---

## Endpoint

| Method | Path | Auth |
|---|---|---|
| POST | `/api/broadcast/lip_sync` | **Daemon internal secret only** (`Authorization: Bearer ${DAEMON_INTERNAL_SECRET}`) |

Body (`LipSyncPayload`):

```json
{
  "type": "lip_sync",
  "timings": [
    {"t": 0.00, "open": 0.0},
    {"t": 0.02, "open": 0.8},
    ...
  ]
}
```

Returns:

```json
{ "ok": true, "clients": <int> }
```

---

## How it works

1. A daemon (Herald) computes per-20 ms mouth-open values from a TTS
   audio buffer.
2. It POSTs the timings array to `/api/broadcast/lip_sync` with the
   shared `DAEMON_INTERNAL_SECRET` bearer token.
3. The route reads `request.app.state.active_connections`, a
   `{user_id: [WebSocket, ...]}` dict maintained by the conversation
   WebSocket handler.
4. It iterates every socket and `send_json(payload)`. Stale sockets
   throw and are silently skipped — the WS handler is responsible for
   cleaning its own dict.
5. Returns the number of successful sends.

There is no per-user filtering on this endpoint — every connected
client receives every broadcast. If/when broadcasts need targeting,
add a `user_ids: list[str]` filter on the payload and respect it in the
fan-out loop.

---

## Auth model

`/api/broadcast/*` is **not** behind the normal JWT auth. The bearer
token expected is `DAEMON_INTERNAL_SECRET`. The validator in
`config/settings.py` rejects the default value and short secrets at
boot, so this surface cannot ship in production with a weak key.

---

## Extending

To add a new broadcast event:

1. Add a typed Pydantic model in `api/routes/broadcast.py`.
2. Add a new route under `/api/broadcast/<event>` with the same
   `DAEMON_INTERNAL_SECRET` check.
3. Have the producing daemon POST to it.
4. Add a matching client-side `onmessage` handler in
   `frontend/src/...` to react to `payload.type`.
