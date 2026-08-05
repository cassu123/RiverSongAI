# Fix CodeRabbit Frontend Audit Findings

This PR resolves all 15 of the critical frontend audit findings reported by CodeRabbit in PR #139.

## Summary of Findings Addressed

| Finding | Component/File | Fix Summary | Status |
|---|---|---|---|
| 1 | `BarcodeScanner.jsx` | Decoupled scanner effect dependencies into refs to prevent infinite loops and constant camera restarts. | Fixed |
| 2 | `ChatInterface.jsx` & `ChatPage.jsx` & `ChatInterface.test.jsx` | Added effect for `initialIntent` hydration and decoupled `localStorage` clear to trigger only after successful consumption. Mocked `useConversation` for tests. | Fixed |
| 3 | `MaintenancePulse.jsx` | Derived `isNonRoad` from `currentVehicle.vehicle_type` and drilled the prop down to child components to fix crashes from undefined references. | Fixed |
| 4 | `useWebSocket.js` | Updated dangerous-key guard to check `Object.prototype.hasOwnProperty` instead of `in` keyword to avoid rejecting all JSON messages. | Fixed |
| 5 | `CommercePage.jsx` | Bypassed `apiFetch` in `uploadImage` to allow `FormData` to construct the proper multipart boundary without `application/json` header contamination. | Fixed |
| 6 | `CulinaryPage.jsx` | Added missing `put` method to `useApi` hook and routed `delete` through `_handle` so UI responds appropriately to errors. | Fixed |
| 7 | `CulinaryPage.jsx` | Removed unused `grocery` tab logic that lacked a `renderGrocery` implementation, causing the page to crash. | Fixed |
| 8 | `Sessions.jsx` | Cleared `sessionDetails` early on session selection and handled fetch errors to prevent stale telemetry from the previous session. | Fixed |
| 9 | `SetupWizard.jsx` | Added a `parseSection` deep-merge function for `hardware`, `safety_floors`, and `home_position` defaults to ensure older configurations load successfully without crashing. | Fixed |
| 10 | `UnitDetail.jsx` | Ensured `manualTimer` interval is cleared when manual mode stops or the component unmounts to prevent runaway vehicle commands. | Fixed |
| 11 | `ProactivePage.jsx` | Used parsed JSON variables from `apiFetch` instead of relying on `.ok` properties (which don't exist in the parsed object) so the UI successfully loads proactive logs. Guarded `kinds_muted` reads. | Fixed |
| 12 | `ProactivePage.jsx` | Sent the plain `prefs` object in `apiFetch` instead of stringifying it first, allowing correct JSON content-type negotiation. | Fixed |
| 13 | `NotificationsSection.jsx` | Swapped `serviceWorker.ready` for `serviceWorker.getRegistration` to prevent the UI from being permanently disabled if no service worker was installed. | Fixed |
| 14 | `VoiceIDSection.jsx` | Added `pcm16ToWavBlob` utility to convert raw 16kHz PCM `Int16Array` chunk from `useAudioRecorder` into a standard WAV blob instead of attempting base64 string conversion. | Fixed |
| 15 | `AudioPlayer.js` | Memoized the `_init` initialization promise so concurrent audio chunk calls wait for the same graph to construct instead of instantiating duplicate playback tracks. | Fixed |

## Validation
* Code was modified on the local branch `fix/coderabbit-frontend-audit` off `main`.
* Ran `npm run build` in the frontend directory. The build completed successfully.
