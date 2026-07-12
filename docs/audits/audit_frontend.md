# Frontend Architecture Audit: React Components

## 1. WebSocket Robustness (`ConversationPage.jsx`)
- **Connection Logic**: WebSockets are wrapped in a custom hook `useWebSocket(wsUrl, handleMessage, { token })`. The component reacts to `connectionStatus` to update UI state (`connecting`, `idle`, etc.).
- **Graceful Reconnect**: The component itself does not implement explicit backoff or retry UI, deferring entirely to the `useWebSocket` hook. If the hook supports auto-reconnect, it is abstracted away. On disconnect, the page just transitions to a `connecting` state.
- **Session Management**: Session expiry correctly handles `authError` by setting an error state, though it lacks an explicit reconnection trigger mechanism for the user on failure.

## 2. State Management Patterns
- **Local Storage Syncing**: `App.jsx` heavily uses `useEffect` to sync local component state (`universe`, `profile`, `adminMode`) back into `localStorage`. This is robust but slightly unoptimized as each state slice triggers a distinct write. Consider a unified `useLocalStorage` hook to avoid boilerplate.
- **Action Hoisting**: Both `ChatInterface.jsx` and `ConversationPage.jsx` use a `setAction` prop to hoist a complex `<ActionSlot />` component (the bottom input/microphone bar) up to the global shell (`App.jsx`). It uses `useEffect` with a cleanup function to remove the action slot when the page unmounts, successfully preventing ghost UI.
- **Derived State**: Model picking (`activeModel`, `selectedModelLabel`) heavily relies on `useMemo` cross-referencing fetched `/api/models`, ensuring labels stay synced without duplicating strings in state.
- **Audio Stream Handling**: Incoming binary audio chunks in `ConversationPage` are intercepted in the WebSocket listener, decoded using a DataView header, and piped directly into an `audioPlayer` instance while avoiding React re-renders per chunk.

## 3. Potential Memory Leaks & Performance Hazards
1. **Uncleared `setTimeout` in `ConversationPage`**:
   - The websocket `handleMessage` listener creates a timeout when receiving a `token` to fire `finalizeStream` after 30 seconds (`streamTimeoutRef.current = setTimeout(...)`).
   - **Hazard**: There is no `useEffect` cleanup for `streamTimeoutRef.current` on component unmount. If the user navigates away while receiving a stream, this timer will trigger a state update on an unmounted component 30 seconds later, leaking memory and throwing a React warning.
2. **Uncleared Audio/WebAudio Context in `ConversationPage`**:
   - `const audioPlayer = useMemo(() => new AudioPlayer(...), [])` is instantiated on mount.
   - **Hazard**: There is no cleanup returning `audioPlayer.dispose()` or `audioPlayer.stop()` in a `useEffect` when the component unmounts. If `AudioPlayer` holds Web Audio API Contexts, they will leak (browsers typically max out at 6 active AudioContexts per origin).
3. **Heavy 3D Rendering (Avatar/Orb)**:
   - `ConversationPage` dynamically imports a `<RiverSong>` component. Comments indicate this will swap to an `<AvatarModel>` pulling a 3D `.glb` file soon.
   - **Hazard**: If the Three.js WebGLRenderer context is not explicitly disposed inside `RiverSong.jsx`'s unmount lifecycle, it will cause severe GPU memory leaks across route transitions.
4. **Fetch Call Cleanups in `ChatInterface`**:
   - `/api/models` and `/api/settings/llm` fetches are initiated in `useEffect` on mount. They lack `AbortController` signals to cancel the network requests if the component unmounts before they resolve, leading to unmounted state updates. (Note: `ChatInterface` *does* correctly use an `AbortController` for sending messages, which is excellent).
