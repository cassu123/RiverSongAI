# Push Notifications

Web Push (VAPID) for the River Song PWA / browser tabs. Lets the server
nudge a user when their browser is closed (system notification on
desktop, banner on mobile).

---

## Status

- ✅ Subscribe / unsubscribe / test endpoints live.
- ✅ Per-user subscription storage in `push_subscriptions` (SQLite via
  `memory_manager._store`).
- ✅ Expired-subscription cleanup (410 Gone → row deleted).
- ⚠️ Off by default. `PUSH_NOTIFICATIONS_ENABLED=true` plus VAPID keys
  required.

---

## Setup

1. Generate VAPID keys once (any machine):
   ```bash
   python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); \
   print('PRIVATE:', v.private_key.decode()); \
   print('PUBLIC:',  v.public_key.decode())"
   ```
2. In `.env`:
   ```
   PUSH_NOTIFICATIONS_ENABLED=true
   VAPID_PRIVATE_KEY=...
   VAPID_PUBLIC_KEY=...
   VAPID_CLAIMS_EMAIL=mailto:you@example.com
   ```
3. Restart the backend. The frontend reads `VAPID_PUBLIC_KEY` from
   `GET /api/push/vapid-public-key` and uses it to subscribe via the
   browser's Push Manager.

---

## API

All endpoints require `Authorization: Bearer <JWT>`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET    | `/api/push/vapid-public-key` | — | Returns `{public_key}` (or `{public_key: null}` if disabled). Frontend bootstraps from this. |
| POST   | `/api/push/subscribe` | `{subscription: <PushSubscription JSON>}` | Save the browser's `PushSubscription` for the calling user. |
| DELETE | `/api/push/unsubscribe` | `{endpoint: "<endpoint URL>"}` | Remove one subscription by its endpoint. |
| POST   | `/api/push/test` | — | Send a test notification to every subscription owned by the calling user. Auto-cleans 410 Gone rows. |

---

## Sender API (internal)

`providers/push/sender.py::send_push(subscription_json, title, body, icon="/favicon.ico") -> bool`

- Returns `True` on success or transient failure.
- Returns `False` only on HTTP 410 (subscription expired) — caller is
  expected to delete the row from the store.
- Raises `RuntimeError` if VAPID keys are missing.

`pywebpush` is called inside a thread-pool executor to keep the event
loop responsive.

---

## Storage

Subscriptions live in the `push_subscriptions` table inside
`river_song.db`. Each row stores `(user_id, subscription_json,
endpoint)`. Queries used:

- `save_push_subscription(user_id, json_str)`
- `delete_push_subscription(user_id, endpoint)`
- `get_push_subscriptions(user_id) -> list[str]`

---

## Privacy

- Subscriptions are tied to the user's JWT subject and never shared
  across users.
- Push payloads are plaintext over end-to-end encrypted Web Push — the
  browser vendor sees encrypted bytes, your server sees plaintext.
- No payload content is logged.
