# River Song AI — Handover Log

## Overall Summary
Migrated the speaking architecture from a half-duplex, polled design to a high-performance, full-duplex binary streaming architecture with barge-in support. Replaced the basic model selection on the Speaking page with the modern hierarchical popover from the Chat page. Significantly overhauled the visual aesthetics of the 3D Avatar Orb with cinematic bloom, spring physics, and dynamic audio deformation.

## Detailed Work Log

### 1. Full-Duplex Architecture & Interruption Handling (Phase 2 & 3)
- **Problem**: The original voice pipeline buffered full TTS responses and had no way to gracefully handle mid-sentence user interruptions without corrupting session state or continuing to play stale audio.
- **Backend Fixes (`conversation.py`, `conversation_loop.py`)**: 
  - Isolated the LLM generation and TTS streaming into a cancellable background `_generation_task`.
  - Added an `interrupt` command handler that calls `task.cancel()`, halting the LLM and TTS pipeline immediately without breaking the conversation loop.
  - Implemented a 4-byte binary header (`gen_id` + `seq_id`) prepended to every raw PCM chunk.
- **Frontend Fixes (`ConversationPage.jsx`, `AudioPlayer.js`)**: 
  - Updated the frontend to parse the 4-byte binary header.
  - The frontend now drops any incoming audio chunks whose `gen_id` does not match the latest generation, ensuring stale audio is immediately silenced on interrupt.
- **Polish (`main.py`)**: 
  - Set strict `Cache-Control: no-cache, no-store, must-revalidate` headers for `index.html` to prevent aggressive service worker caching.
  - Confirmed WebSocket ping/pong loops are active to maintain connection stability.

### 2. UI/UX: Speaking Page Model Picker
- **Problem**: The model picker on the Speaking page used a rudimentary `<Sheet>` component, creating an inconsistent and less premium experience compared to the Chat page.
- **Fixes (`ConversationPage.jsx`)**: 
  - Ported the hierarchical popover design (`MpopRow`, `MpopBack`) from `ChatInterface.jsx`.
  - Replaced the generic model button with a dynamic button reflecting the selected provider's icon.
  - Users can now seamlessly navigate "River Decides", "Local", "NVIDIA NIM", and "Cloud" grouped categories directly from a floating popover.

### 3. Visuals: Avatar Orb Upgrades
- **Problem**: The `RiverSong.jsx` 3D orb looked flat, reacted rigidly to state changes via linear interpolation, and lacked environmental presence.
- **Fixes (`RiverSong.jsx`, `package.json`)**:
  - **Cinematic Bloom**: Downgraded `@react-three/postprocessing` to `^2.16.0` to resolve a fiber compatibility issue, restoring the high-end glowing bloom.
  - **Audio Spectrum FFT Deformation**: Updated the `VORTEX_VERT` shader so the orb's surface physically ripples with complex noise based on the incoming audio signal.
  - **Mouse Magnetism**: The orb subtly rotates and tilts toward the user's cursor position.
  - **Spring Physics**: Rewrote the animation loop to use custom physics (stiffness and damping) for audio velocity and state changes, making the orb bounce and recoil organically instead of fading linearly.
  - **Morphing States**: Implemented `uMorph` (orb shatters into fragments while "thinking") and `uError` (orb turns jagged).
  - **Dynamic Environment**: Anchored the orb by placing a subtle reflective floor below it and a `pointLight` inside it, allowing it to cast its palette colors onto the scene.

## Agent Thoughts & Next Steps
The core pipeline is now extremely robust. The transition to pure PCM streaming and binary headers places the app squarely in the realm of high-end voice agents (e.g., Kimi / Claude). 

**Suggested Next Steps for the Next Shift**:
1. **AudioPlayer Refinement**: Keep an eye on the `AudioWorklet` RingBuffer. If the user reports clicking/popping during TTS playback, the RingBuffer size may need to be slightly increased, or a micro-fade-in/out may need to be applied to the raw PCM chunks in `playback-processor.js`.
2. **Lip Sync Alignment**: The `lipSyncOpen` value is being transmitted, but ensuring it perfectly aligns with the audio playback timing might require tying the visual event dispatch to the exact `currentTime` of the `AudioContext` rather than the WebSocket receive event.
3. **Avatar GLB**: The groundwork is fully laid for swapping the procedural orb out for a rigged 3D `.glb` avatar when ready.

---

## Culinary Module Restoration & Hardening (Phase 4-5) — 2026-05-23

**Context:** The Culinary module suffered a catastrophic regression in commit `41340a2` (the "Glass Round" migration), where functional UI (Filtering, Editing, Prep, Voting) was replaced with aesthetic placeholders. A deep-tissue restoration and hardening pass was executed to resuscitation core logic while maintaining the new design language.

### 🛠 Work Completed

**1. Functional Restoration:**
- **Branding:** Header restored to **Culinary**.
- **API Reconnection:** Standardized `useApi` hook to use standard `delete` method. Reconnected all 6 backend culinary silos (`recipes`, `stockroom`, `dinner`, `prep`, `equipment`, `banned`).
- **Structured Filtering:** Library now has a full **Filter Bar** (Search, Meal Type, Dynamic Protein extractor, and Sort Mode).
- **Prep Deck:**
    - Replaced `alert()` popups with high-performance `ShoppingListModal` (with stockroom cross-referencing) and `StagingAreaModal` (per-recipe provision piles).
    - Restored **The Adjuster**: Functional scaling engine with support for Imperial/Metric unit preferences.

**2. Hardening & UX:**
- **Recipe Detail Modal:**
    - Transitioned from bottom-anchored global `Sheet` to a compact, contextual centered modal.
    - Added **Focus Trap** (Tab-cycling) and **Escape Key** closure logic.
    - Fixed Edit/Close button layout via explicit header padding.
- **Dynamic Forms:** Brittle JSON textareas eliminated. The recipe editor now uses structured, row-based dynamic inputs for **Provisions** (qty, unit, name) and **Execution Sequence** (multi-line steps).
- **Banned Ingredients:** Wired the orphaned backend substitution engine. Recipes now flag banned items with an "APPLY SUBSTITUTE" action that triggers a regex-based overhaul of the archive record.
- **AI Recommendations:** Integrated local LLM (Ollama) in the Banned tab to provide reasoning-based suggestions for household dietary restrictions.
- **Performance:** Optimized `animate-page-in` duration to snappy `400ms` (cards) and `250ms` (modals) to reduce perceived blur transition latency.
- **Typography:** Enforced `line-height: 1.7` on all recipe text blocks and form textareas to eliminate highlight jitter.

### 📂 File State
- `frontend/src/pages/CulinaryPage.jsx` — Total reconstruction of components and state logic.
- `frontend/src/pages/CulinaryPage.test.jsx` — Expanded suite covering filtering, voting, substitution, and prep deck modals.
- `api/routes/culinary.py` — `[VERIFIED WORKING]` and now fully utilized.

### ✅ Acceptance Status
- [x] Header reads "Culinary".
- [x] Filter Bar (Search + 3 Dropdowns) functional.
- [x] Modal focus-trapped and Esc-responsive.
- [x] Dynamic forms for recipes (no more JSON textareas).
- [x] Prep Deck: Shopping List & Staging Area modals operational.
- [x] Substitution engine wired to Recipe Archive.

**Next for Culinary:** Finish the "ADJUST" button in stockroom (inline sheet needed) and monitor WebSocket events for reactive updates.
