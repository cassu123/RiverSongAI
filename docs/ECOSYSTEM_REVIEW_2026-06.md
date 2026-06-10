# River Song Ecosystem — Honest Program Review (June 2026)

Scope: the hub (RiverSongAI), all five satellite repos (river-vector, river-horizon,
river-kova, river-sentinel, river-vortex), the native Android app, and the Google
Drive program docs. Written after the June 2026 hub code-review/fix session.

---

## Scorecard

| Program | Repo | Honest state |
|---|---|---|
| River Song (hub) | RiverSongAI | **Live & solid.** Production, 256 tests passing, security hardened this month. Known gaps tracked in docs/KNOWN_ISSUES.md (stub daemons, unwired n8n router). |
| River Vector (mowers) | river-vector | **Half-built, most mature satellite.** Real subsystems, 101 files. Safety gaps + protocol drift (below). Not ready for autonomous mowing. |
| River Horizon (drones) | river-horizon | **Decent code, nothing to talk to.** Real MAVLink/flight/test code, but it calls `/api/horizon/*` — routes that don't exist on the hub. |
| River Kova (chore robots) | river-kova | **Decent code, nothing to talk to.** Real ROS2/RealSense integration, 139 test assertions, but calls nonexistent `/api/kova/*`. |
| River Vortex (home hubs) | river-vortex | **Prototype.** Real audio/display structure, placeholder tests, calls nonexistent `/api/vortex/*`. |
| River Sentinel (robot dogs) | river-sentinel | **Empty shell.** 29 of 32 files nearly empty. No gait control, no e-stop, no API client. Name + folders only. |
| River Vexa (vehicles) | (no repo) | **Ideas only.** Lives as Drive docs ("River Drive" feature list). Good ideas, nothing built. |
| Android (native) | riversong_android_app | **Prototype to deprecate.** 117 Kotlin files, never compiled-verified, API paths drifted, voice stubbed. The Capacitor app in RiverSongAI/frontend is ahead on every axis. |

---

## The five program-level problems (in priority order)

### 1. The hub–satellite contract only exists for Vector
The hub exposes `/api/vector/*` (and `/api/rover`, `/api/daemon`). Horizon, Kova, and
Vortex were all written against `/api/horizon/*`, `/api/kova/*`, `/api/vortex/*` —
**none of which exist**. Telemetry and registration from three of the five satellites
would 404 today.

**Fix direction:** generalize the Vector pattern (claim → X-Unit-Token → register →
telemetry batch → command long-poll) into a generic fleet API, e.g.
`/api/fleet/{program}/...`, or stamp per-program routers from shared hub code. Decide
once, then update all satellites against it.

### 2. Four copies of the same plumbing, three different HTTP libraries
Every satellite re-implements telemetry collector/logger/alerts, WireGuard lifecycle,
and a hub API client — Horizon uses aiohttp, Kova uses requests, Vortex uses httpx.
Same bugs will need fixing four times.

**Fix direction:** extract one shared package (e.g. `river-link`): hub client,
telemetry base, VPN manager, e-stop base class. Satellites pip-install it. Do this
*before* writing more satellite code.

### 3. Safety code is the least-finished part of safety-critical repos
- river-vector: return-home/docking is TODO (autonomy/return_home.py:164,218,223);
  `manual.blades` lacks the operator-presence gate the spec requires; remote e-stop
  signals the loop but never calls an actuator cutoff.
- river-sentinel: e-stop file is literally empty.
- **Rule to adopt: no autonomous operation of any blade/prop/leg hardware until that
  program's safety module has real implementations and tests.** Vector's reviewer
  verdict: one unit, controlled test yard, manual-first, only after return-home and
  the presence gate are built.

### 4. Two Android apps, one of them dead weight
The native Kotlin app duplicates the Capacitor app with ~70% coverage, drifted
endpoints (`/api/dashboard/summary`, `/api/chat/transcribe`), no 2FA support, no
ws-ticket auth, stubbed audio. **Archive it** (mark README "superseded by
RiverSongAI/frontend Capacitor build") and invest only in Capacitor.

### 5. Docs and process drift
- docs/ECOSYSTEM.md (and the Drive master) says the stack is **Firebase
  Firestore/Auth** — reality is SQLite + custom JWT. The master doc no longer
  describes the real system.
- Satellites are single-commit code dumps — no history, no branches, no CI.
- A "API Keys | River Song AI" **spreadsheet lives in Google Drive** — move secrets
  to a password manager / server .env; a Drive sheet is one mis-share away from leak.
- Hub has KNOWN_ISSUES.md but no GitHub issues — convert them so they're trackable.

---

## Recommended order of work

1. **Merge & deploy** the hub review branch (everything from this session).
2. **Pick the fleet contract** and build the shared `river-link` client package.
   (Vector's protocol is the template; fix its known drift: ack must send
   `status`, session_id race on first telemetry, hardcoded /etc bootstrap path.)
3. **Finish Vector depth-first** until one mower completes a supervised autonomous
   session: return-home, blade presence gate, offline fallback (config-wait loop
   currently spins forever), then field test. Vector is the proof that the whole
   architecture works end-to-end.
4. **Port Horizon and Kova** onto the shared client + real hub routes (their domain
   code is worth keeping).
5. **Park Sentinel and Vexa** deliberately — they're paper programs; leave them as
   specs until Vector ships. That's a feature of focus, not a failure.
6. **Archive** riversong_android_app, RiverSong----old, andriod_app (already marked
   DO-NOT-USE) so the org page reflects reality.
7. **Process upgrades** on the hub: GitHub Actions CI (pytest + frontend build — both
   now run from a clean checkout), branch+PR workflow instead of direct-to-main,
   small commits in satellites.
8. **Sync the master doc**: update ECOSYSTEM.md stack table to reality and re-export
   to Drive; keep git as the source of truth.

---

## Bottom line

The vision is coherent and the documentation discipline is genuinely unusual for a
solo project — the hub is a real, live, multi-user product. The risk isn't the
vision; it's breadth-first execution: five robot programs at 10–60% each instead of
one at 100%. The architecture bet (hub commands everything) is still unproven
end-to-end because no satellite has completed a full loop in the field. Vector is
closest — drive it to done, extract what you learned into shared code, and the rest
of the fleet becomes assembly instead of invention.
