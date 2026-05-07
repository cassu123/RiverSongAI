# Local AI Integration Plan — River Song AI
*Hardware: GTX 1050 Ti (4GB VRAM), 32GB RAM, AMD FX-8350*
*Base: Ollama already installed, Whisper + Piper running, Claude/Gemini/OpenAI SDK present*

---

## What Already Works (Do Not Repeat)
- Ollama: local LLMs via `/providers/llm/ollama.py`
- Whisper (base): local STT via `/providers/stt/whisper_local.py`
- Piper + Kokoro: local TTS via `/providers/tts/`
- Cloud LLMs: Claude, Gemini, OpenAI, Mistral, Bedrock all integrated
- Intent routing: regex-based in `core/intent_router.py`

---

## Hardware Limits (must respect)
| Resource | Amount | Implication |
|----------|--------|-------------|
| GPU VRAM | 4 GB | Whisper (base/small), Ollama 3B–7B Q4, SD 1.5 barely. No SDXL, no Flux, no video. |
| RAM | 32 GB | 13B–30B models at Q4 fit easily on CPU. Chroma, embeddings fine. |
| CPU | AMD FX-8350 (8-core) | CPU inference: ~2–4 tok/s for 7B, ~1 tok/s for 13B. Functional, just slow. |
| HDD | 1.8 TB | Plenty for model weights, Chroma DB, generated images |

---

## Phase 1 — Semantic Memory (Highest Value, Least Effort)
**Goal:** Replace keyword-based memory lookup with semantic vector search so River Song finds relevant facts even when wording differs.

**How it works:** When a fact is saved → embed it with `nomic-embed-text` via Ollama → store in Chroma. When building conversation context → embed the user's query → retrieve closest memories by cosine similarity.

### Files to create/modify:
- `requirements.txt` — add `chromadb`
- `providers/memory/embedding_provider.py` — NEW: calls `ollama.embeddings()` with `nomic-embed-text`
- `providers/memory/vector_store.py` — NEW: Chroma client, methods: `upsert(id, text, metadata)`, `search(query_text, n_results=5, filter={})`
- `core/memory_manager.py` — update `save_fact()` and `save_preference()` to also upsert into Chroma; update `get_context_for_prompt()` to semantic search instead of keyword filter
- `.env.example` — add:
  ```
  EMBEDDING_MODEL=nomic-embed-text    # pulled via Ollama
  CHROMA_PATH=/mnt/data/river-song/chroma
  SEMANTIC_MEMORY_ENABLED=true
  ```
- `config/settings.py` — add above three fields

### Ollama model to pull:
```bash
ollama pull nomic-embed-text    # 274MB, CPU-native, fast
```

---

## Phase 2 — Vision Model for Image Analysis
**Goal:** Let River Song describe, categorize, and extract data from photos (inventory items, recipe uploads, product listings).

**How it works:** Add a vision-capable model to Ollama. Expose a `/api/analyze-image` endpoint. Frontend pages (Culinary, Inventory, Commerce) can send a photo and get back structured data (item name, quantity, price estimate, ingredients, etc.).

### Files to create/modify:
- `providers/llm/vision_provider.py` — NEW: sends image bytes + prompt to Ollama vision model, returns text
- `api/routes/vision.py` — NEW: POST `/api/vision/analyze` accepts multipart `file` + `prompt`, returns `{ description, tags, structured_data }`
- `main.py` — register `vision` router
- `api/routes/culinary.py` — when user uploads a recipe photo, call vision to extract title/ingredients/steps
- `api/routes/inventory.py` — when user uploads item photo, call vision to auto-fill name/description/category
- `.env.example` — add:
  ```
  VISION_MODEL=llama3.2-vision    # or llava
  VISION_ENABLED=true
  ```

### Ollama model to pull:
```bash
ollama pull llava:7b    # 4.7GB, fits in 4GB VRAM (tight) or falls to CPU RAM
# alternative: ollama pull moondream  # 1.7GB, lightweight
```

### Frontend hooks:
- `CulinaryPage.jsx` — add "Analyze Photo" button on recipe card upload; populates fields from vision response
- `InventoryPage.jsx` — same on item photo upload
- `CommercePage.jsx` — analyze product photo, suggest title/description for Etsy/eBay listing

---

## Phase 3 — RAG for Local Documents
**Goal:** Let River Song answer questions from uploaded documents (vehicle manuals, recipe PDFs, inventory spreadsheets) without sending them to the cloud.

**How it works:** When a PDF/document is uploaded → chunk it → embed each chunk → store in Chroma with doc_id metadata. When user asks a question related to that domain → retrieve top-k chunks → inject into LLM context.

### Files to create/modify:
- `providers/rag/rag_provider.py` — NEW: `ingest_document(doc_id, file_bytes, file_type)` and `query(doc_id, question, n_chunks=5)`. Uses Phase 1 embedding + Chroma.
- `providers/rag/chunker.py` — NEW: splits text into overlapping 512-token chunks
- `api/routes/rag.py` — NEW: POST `/api/rag/ingest` and POST `/api/rag/query`
- `api/routes/vehicles.py` — after PDF upload, call `rag_provider.ingest_document()` with vehicle_id as doc_id; when user asks "what's the oil interval for my truck?" → route to RAG
- `core/intent_router.py` — add RAG intent: if user's vehicle memory exists and question matches maintenance keywords → call RAG query first, inject result into LLM context
- `.env.example` — add:
  ```
  RAG_ENABLED=true
  RAG_CHUNK_SIZE=512
  RAG_CHUNK_OVERLAP=64
  RAG_TOP_K=5
  ```

---

## Phase 4 — Streaming LLM Responses (UX)
**Goal:** Stream tokens from Ollama to the browser in real time so responses feel instant, not delayed.

### Files to create/modify:
- `providers/llm/ollama.py` — add `stream_chat(messages) -> AsyncGenerator[str, None]` method using Ollama's streaming API
- `core/conversation_loop.py` — add streaming path: after intent routing, if not needing full response for TTS immediately, stream text chunks to WebSocket
- `api/routes/conversation.py` — on WebSocket: send `{"type": "token", "content": "..."}` frames during streaming; send `{"type": "done"}` at end
- `frontend/src/components/ConversationPanel.jsx` — handle `type: "token"` frames to append characters in real time; handle `type: "done"` to finalize display
- `.env.example` — add:
  ```
  LLM_STREAMING_ENABLED=true
  ```

**Note:** TTS pipeline still needs full text; streaming display and TTS synthesis can run in parallel (stream display, buffer full text, then TTS).

---

## Phase 5 — Tool Use / Function Calling
**Goal:** Give River Song real actions — create calendar events, update inventory, set routines, control Home Assistant — all triggered by conversation.

**How it works:** Define a tool schema for each action. When Claude (or Ollama with function calling) detects intent + entities, it calls the appropriate tool instead of just generating text. The tool executes, returns a result, and River Song confirms verbally.

### Files to create/modify:
- `core/tools.py` — NEW: define all available tools as Python functions + JSON schemas:
  - `create_calendar_event(title, date, time, duration)`
  - `add_inventory_item(name, quantity, location, category)`
  - `set_reminder(message, datetime)`
  - `control_device(device_name, action)`
  - `add_shopping_list_item(item, quantity)`
  - `create_routine(name, trigger, actions)`
  - `log_vehicle_maintenance(vehicle_id, service_type, date, mileage)`
  - `add_recipe(title, ingredients, steps, source_url)`
- `providers/llm/claude_api.py` — add tool_use support: pass tool schemas in API call, handle `tool_use` content blocks, execute tool, send `tool_result` back
- `providers/llm/ollama.py` — add function calling for models that support it (llama3.1, qwen2.5-coder, mistral)
- `core/conversation_loop.py` — add tool execution loop: call LLM → if tool_use response → execute tool → feed result back → get final text → TTS
- `.env.example` — add:
  ```
  TOOL_USE_ENABLED=true
  TOOL_USE_PROVIDER=anthropic    # anthropic | ollama
  ```

---

## Phase 6 — Whisper Upgrade
**Goal:** Better speech recognition accuracy (especially for proper nouns, names, commands).

**Action:** Once NVIDIA drivers are installed (`sudo ubuntu-drivers autoinstall`), upgrade Whisper model size.

### Files to modify:
- `.env` on server — change `WHISPER_MODEL_SIZE=base` to `WHISPER_MODEL_SIZE=small` (244MB, much better accuracy, still fits in 4GB VRAM alongside small Ollama model) or `medium` (1.5GB, near-human, CPU-only if running Ollama on GPU simultaneously)

**Recommendation:** `small` for GPU-shared setup, `medium` for CPU-only transcription if GPU is dedicated to LLM.

---

## Phase 7 — Local Image Generation (SD 1.5)
**Goal:** Generate images for Etsy product listings, recipe cards, inventory visuals — locally, privately.

**Hardware note:** SD 1.5 needs ~2.5GB VRAM. Fits on GTX 1050 Ti. SDXL (8GB) and Flux (12GB) do NOT fit.

### Install on server:
```bash
# Option A: AUTOMATIC1111 (simplest)
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui /mnt/data/stable-diffusion
cd /mnt/data/stable-diffusion && bash webui.sh --api --listen --port 7860 --nowebui

# Option B: ComfyUI (more flexible)
git clone https://github.com/comfyanonymous/ComfyUI /mnt/data/comfyui
```

### Files to create/modify:
- `providers/image/sd_provider.py` — NEW: calls AUTOMATIC1111 REST API at `localhost:7860`; methods: `generate(prompt, negative_prompt, width, height, steps) -> bytes`
- `providers/image/__init__.py` — NEW
- `api/routes/image.py` — NEW: POST `/api/image/generate` accepts JSON `{prompt, style, context}`, returns base64 PNG
- `main.py` — register image router
- `frontend/src/pages/CommercePage.jsx` — "Generate Product Image" button → calls `/api/image/generate` with product name/description as prompt
- `frontend/src/pages/CulinaryPage.jsx` — "Generate Recipe Card" button on recipes without photos
- `.env.example` — add:
  ```
  IMAGE_GENERATION_ENABLED=false    # enable after SD 1.5 setup
  SD_API_URL=http://localhost:7860
  SD_DEFAULT_MODEL=v1-5-pruned-emaonly.safetensors
  SD_DEFAULT_STEPS=20
  SD_DEFAULT_WIDTH=512
  SD_DEFAULT_HEIGHT=512
  ```

### SD 1.5 model to download:
```bash
mkdir -p /mnt/data/stable-diffusion/models/Stable-diffusion
# Download v1-5-pruned-emaonly.safetensors (~4GB) from HuggingFace
```

---

## Phase 8 — Voice Cloning (Chatterbox TTS)
**Goal:** Give River Song a consistent, cloned custom voice instead of generic Piper voices.

**Hardware note:** Chatterbox needs <4.5GB VRAM (already flagged in requirements.txt comments). Fits on GTX 1050 Ti if not running SD simultaneously.

### Files to modify:
- `requirements.txt` — uncomment/add `chatterbox-tts==0.1.7`
- `providers/tts/chatterbox_provider.py` — NEW: implement `TTSProvider` interface using Chatterbox; load reference audio from `/mnt/data/river-song/voice_reference.wav`
- `providers/tts/voice_registry.py` — add Chatterbox voice entries
- `api/routes/models_settings.py` — add Chatterbox to TTS provider picker
- `.env.example` — add:
  ```
  CHATTERBOX_ENABLED=false    # enable after NVIDIA drivers installed
  CHATTERBOX_REFERENCE_AUDIO=/mnt/data/river-song/voice_reference.wav
  CHATTERBOX_EXAGGERATION=0.5
  CHATTERBOX_CFG_WEIGHT=0.5
  ```

**Setup:** Record 10–30 seconds of clear speech as `voice_reference.wav` and place at the path above. Chatterbox clones it zero-shot.

---

## Phase 9 — n8n for Complex Routines
**Goal:** Replace the simple routines system with n8n workflows for complex multi-step automations (e.g., "Every Monday morning: check weather, check calendar, read news headlines, brief me").

### Install on server:
```bash
docker run -d \
  --name n8n \
  --restart unless-stopped \
  -p 5678:5678 \
  -e N8N_BASIC_AUTH_ACTIVE=true \
  -e N8N_BASIC_AUTH_USER=riversong \
  -e N8N_BASIC_AUTH_PASSWORD=<password> \
  -v /mnt/data/river-song/n8n:/home/node/.n8n \
  n8nio/n8n
```

### Files to create/modify:
- `api/routes/n8n_webhooks.py` — NEW: POST `/api/webhooks/n8n` — receives webhook from n8n, routes action to River Song systems
- `providers/automation/n8n_client.py` — NEW: trigger n8n workflows via REST API
- `frontend/src/pages/RoutinesPage.jsx` — add "Advanced (n8n)" option in routine creation, links to n8n UI at `:5678`
- `.env.example` — add:
  ```
  N8N_ENABLED=false
  N8N_URL=http://localhost:5678
  N8N_API_KEY=
  N8N_WEBHOOK_SECRET=
  ```

---

## Phase 10 — Analytics AI Summaries
**Goal:** Use local LLM to analyze social media metrics and generate plain-English insights/recommendations — no business data leaves the server.

### Files to create/modify:
- `api/routes/analytics.py` — after fetching platform data, pass metrics JSON to Ollama with prompt: "Analyze these metrics and give 3 actionable insights in plain English. Focus on growth opportunities."
- `frontend/src/pages/AnalyticsPage.jsx` — add "AI Summary" card below each platform's metrics; calls `/api/analytics/{platform}/summary`
- Add dedicated endpoint: GET `/api/analytics/{platform}/summary` → fetches data → calls Ollama → returns `{ summary, insights[], recommendations[] }`

---

## Implementation Order for Gemini

| Priority | Phase | Effort | Value |
|----------|-------|--------|-------|
| 1 | Phase 1: Semantic Memory | Low | Very High |
| 2 | Phase 4: Streaming Responses | Medium | High (UX) |
| 3 | Phase 5: Tool Use | High | Very High |
| 4 | Phase 2: Vision Model | Low | High |
| 5 | Phase 3: RAG Documents | Medium | High |
| 6 | Phase 6: Whisper Upgrade | Very Low | Medium |
| 7 | Phase 10: Analytics AI | Low | Medium |
| 8 | Phase 7: Image Generation | High | Medium |
| 9 | Phase 8: Voice Cloning | Medium | Medium |
| 10 | Phase 9: n8n Routines | High | Medium |

---

## Quick Wins (Can Do Today)

1. `ollama pull nomic-embed-text` — enables Phase 1 immediately
2. `ollama pull moondream` — lightweight vision model (1.7GB), enables Phase 2
3. Change `WHISPER_MODEL_SIZE=small` in .env — instant accuracy improvement
4. `pip install chromadb` — Phase 1 dependency

---

## Notes for Gemini

- Always add new settings to both `.env.example` AND `config/settings.py` (Pydantic BaseSettings)
- All new providers should be gated by `FEATURE_ENABLED=false` so they don't break existing setup
- New API routes go in `api/routes/` and must be registered in `main.py`
- Frontend pages use `/api/` prefix for all backend calls (proxied via Vite in dev, direct in prod)
- Database: SQLite at `DB_PATH`, inventory uses SQLAlchemy; memory uses raw sqlite3 via `providers/memory/`
- Chroma persistent storage: use `/mnt/data/river-song/chroma` (HDD, not SSD) to avoid filling the OS drive
- Test new Ollama models with `ollama run <model>` before wiring into code
- Hardware: NVIDIA drivers not yet installed (`sudo ubuntu-drivers autoinstall` still needed) — GPU features may fall back to CPU
