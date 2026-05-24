> **ARCHIVED — 2026-05-23**
> All prompts in this document have been implemented. This file is retained as a historical design record.
> For current settings documentation, see `config/settings.py` and `.env.example`.
> The 3 RAG-chunk settings (Prompt 5) and 2 Analytics AI settings (Prompt 7) that were originally
> missing from `settings.py` were added 2026-05-23 — see `DOCS_AUDIT_REPORT.md` issues C-3 and H-5,
> plus the "Remediation Applied" section appended to that report.

---

# Gemini Implementation Prompts — River Song AI Local AI Integration
*Copy and paste each prompt individually, in order. Each is self-contained.*

---

## PROMPT 1 — Semantic Memory (Vector Search)

```
You are implementing Phase 1 of a local AI integration for River Song AI, a personal AI operating 
system running on Ubuntu 25.10. The server has: GTX 1050 Ti (4GB VRAM), 32GB RAM, AMD FX-8350 CPU.

PROJECT OVERVIEW:
- FastAPI backend (main.py at project root), React/Vite frontend (frontend/src/)
- Ollama is already installed and running at http://localhost:11434
- SQLite database at DB_PATH (configured in .env)
- All settings use Pydantic BaseSettings in config/settings.py loaded from .env
- Memory system uses raw sqlite3 in providers/memory/ and core/memory_manager.py

TASK: Add semantic vector search to the memory system using local embeddings + ChromaDB.
Currently, memory recall is keyword-based. After this change, when River Song needs context 
for a conversation, it will embed the user's message and retrieve the most semantically 
relevant memories — even if the wording doesn't match.

BEFORE WRITING CODE, READ THESE FILES:
1. config/settings.py — understand the Settings class pattern
2. core/memory_manager.py — understand save_fact(), save_preference(), get_context_for_prompt()
3. providers/memory/ — see what files already exist
4. .env.example — understand existing env var patterns

IMPLEMENT THE FOLLOWING:

1. requirements.txt — add: chromadb

2. providers/memory/embedding_provider.py — NEW FILE:
   - Class EmbeddingProvider
   - Method: async def embed(self, text: str) -> list[float]
   - Uses the ollama Python client (already in requirements): client.embeddings(model=settings.embedding_model, prompt=text)
   - Returns the embedding vector
   - Handle connection errors gracefully — return None if Ollama unreachable

3. providers/memory/vector_store.py — NEW FILE:
   - Class VectorStore
   - __init__: create a chromadb.PersistentClient at settings.chroma_path; get_or_create_collection("river_song_memory")
   - Method: upsert(id: str, text: str, metadata: dict) — embeds text via EmbeddingProvider, upserts into Chroma
   - Method: search(query_text: str, n_results: int = 5, where: dict = None) -> list[dict]
     - Returns list of {id, text, metadata, distance} sorted by relevance
     - Falls back to empty list if Chroma or embedding unavailable
   - Gate everything behind settings.semantic_memory_enabled check

4. core/memory_manager.py — MODIFY:
   - Import VectorStore, instantiate lazily (only if semantic_memory_enabled)
   - In save_fact(): after SQLite insert, also call vector_store.upsert(id=str(fact_id), text=fact_text, metadata={"type": "fact", "user_id": user_id})
   - In save_preference(): same pattern
   - In get_context_for_prompt(user_id, query_text): if semantic_memory_enabled and query_text provided, call vector_store.search(query_text, n_results=8, where={"user_id": user_id}); merge results with existing SQLite results, deduplicate by id, return top results. Fall back to current SQLite-only behavior if semantic search fails.

5. .env.example — ADD these lines in the Memory section:
   EMBEDDING_MODEL=nomic-embed-text
   CHROMA_PATH=/mnt/data/river-song/chroma
   SEMANTIC_MEMORY_ENABLED=true

6. config/settings.py — ADD to Settings class:
   embedding_model: str = "nomic-embed-text"
   chroma_path: str = "/mnt/data/river-song/chroma"
   semantic_memory_enabled: bool = False

RULES:
- Default SEMANTIC_MEMORY_ENABLED to False in settings.py (safe off by default)
- Never break existing SQLite memory behavior — semantic search is additive
- All new code must handle import errors and connection failures silently (log warning, don't crash)
- Do not add chromadb to the commented-out section of requirements.txt — add it to the active section
- Chroma collection name must be "river_song_memory" for consistency

After all files are written, output a summary of every file changed and the exact ollama command to run on the server: `ollama pull nomic-embed-text`
```

---

## PROMPT 2 — Streaming LLM Responses

```
You are implementing Phase 2 of a local AI integration for River Song AI, a personal AI operating 
system running on Ubuntu 25.10. The backend is FastAPI, frontend is React/Vite.

PROJECT OVERVIEW:
- FastAPI backend, WebSocket-based conversation at /api/ws/conversation
- Ollama is the primary local LLM provider (providers/llm/ollama.py)
- The conversation pipeline is in core/conversation_loop.py
- The WebSocket handler is in api/routes/conversation.py
- Frontend conversation UI is in frontend/src/components/ConversationPanel.jsx
- Currently, the full LLM response is awaited before anything is sent to the frontend

TASK: Add streaming so LLM tokens appear in the UI in real time as they're generated.
The voice (TTS) pipeline still needs the complete text, so the approach is:
- Stream tokens to the WebSocket for display
- Simultaneously buffer the full text
- When streaming is complete, send the full buffered text to TTS
- Send a "done" frame when streaming is complete

BEFORE WRITING CODE, READ THESE FILES:
1. providers/llm/ollama.py — understand current chat() method signature and return
2. core/conversation_loop.py — understand the full pipeline flow
3. api/routes/conversation.py — understand how WebSocket messages are sent
4. frontend/src/components/ConversationPanel.jsx — understand how messages are received and displayed
5. config/settings.py — understand the Settings pattern
6. .env.example — understand env var patterns

IMPLEMENT THE FOLLOWING:

1. providers/llm/ollama.py — ADD method:
   async def stream_chat(self, messages: list[dict]) -> AsyncGenerator[str, None]:
   - Uses ollama client with stream=True
   - Yields each token string as it arrives
   - Uses the same model as the regular chat() method
   - Import AsyncGenerator from typing

2. core/conversation_loop.py — MODIFY the LLM call section:
   - If settings.llm_streaming_enabled and provider is Ollama:
     - Call stream_chat(), collect tokens into a buffer while yielding each to a callback
     - Callback sends {"type": "token", "content": token_str} over the WebSocket
     - After iteration completes, use the full buffered text for TTS as normal
   - Else: existing behavior unchanged
   - The streaming callback should be passed in or accessed via the WebSocket send function

3. api/routes/conversation.py — MODIFY:
   - Pass a send_token callback into the conversation loop that does: await websocket.send_json({"type": "token", "content": token})
   - After streaming completes, send: {"type": "stream_done"}
   - Existing message types (audio, text response, error) must remain unchanged

4. frontend/src/components/ConversationPanel.jsx — MODIFY:
   - Handle incoming {"type": "token"} messages: append content to a "streaming" message bubble
     that shows as the AI is typing (use a React state variable streamingContent)
   - Handle {"type": "stream_done"}: finalize the streaming bubble into a permanent message
   - Existing message handling (audio playback, final text display) must remain unchanged
   - The streaming bubble should show a blinking cursor while receiving tokens

5. .env.example — ADD:
   LLM_STREAMING_ENABLED=true

6. config/settings.py — ADD:
   llm_streaming_enabled: bool = False

RULES:
- Default llm_streaming_enabled to False — streaming is opt-in
- Non-Ollama providers (Claude, OpenAI etc.) should skip streaming and use existing path
- Never break the TTS pipeline — TTS always receives the complete text
- Frontend must degrade gracefully if stream_done never arrives (timeout after 30s, finalize)
- Do not change the WebSocket message format for any existing message types

Output every file changed with a summary of what was modified.
```

---

## PROMPT 3 — Tool Use / Function Calling

```
You are implementing Phase 3 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. LLM providers: Ollama (local) and Anthropic Claude (cloud, via anthropic SDK).

PROJECT OVERVIEW:
- core/conversation_loop.py orchestrates the full voice pipeline
- core/intent_router.py currently does regex-based intent routing
- providers/llm/claude_api.py already calls the Anthropic SDK (anthropic==0.96.0)
- providers/llm/ollama.py handles local Ollama models
- The app has: Google Calendar, Home Assistant, inventory system, culinary system, vehicle tracking
- All settings in config/settings.py (Pydantic BaseSettings) loaded from .env

TASK: Give River Song the ability to take real actions through conversation using LLM tool use.
When a user says "add milk to my shopping list" or "turn off the living room lights", 
the LLM should call the appropriate tool rather than just generating text.

BEFORE WRITING CODE, READ THESE FILES:
1. providers/llm/claude_api.py — understand current API call pattern
2. providers/llm/ollama.py — understand current chat() pattern
3. core/conversation_loop.py — understand the full pipeline
4. core/intent_router.py — understand current routing
5. api/routes/inventory.py — understand add item logic
6. providers/smart_home/ — understand Home Assistant integration
7. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. core/tools.py — NEW FILE — Define all tools:

   TOOL SCHEMAS (list of dicts in Anthropic format — also usable for Ollama):
   - create_calendar_event: title(str), date(str, YYYY-MM-DD), time(str, HH:MM), duration_minutes(int)
   - add_inventory_item: name(str), quantity(int), unit(str), location(str), category(str)
   - add_shopping_list_item: item(str), quantity(int, optional)
   - set_reminder: message(str), datetime_str(str, ISO 8601)
   - control_device: device_name(str), action(str: "on"/"off"/"toggle"/"set"), value(str, optional)
   - log_vehicle_maintenance: vehicle_name(str), service_type(str), date(str), mileage(int, optional)
   - add_recipe_to_library: title(str), source_url(str, optional), notes(str, optional)
   - create_routine: name(str), trigger(str), action_description(str)

   TOOL EXECUTOR (async function execute_tool(tool_name: str, tool_input: dict, context: dict) -> str):
   - "create_calendar_event" → call Google Calendar provider if available, else return confirmation text
   - "add_inventory_item" / "add_shopping_list_item" → call inventory DB insert logic
   - "control_device" → call Home Assistant provider
   - "set_reminder" → save to reminders table in SQLite (create table if not exists)
   - "log_vehicle_maintenance" → call vehicle tracking DB insert
   - "add_recipe_to_library" → call culinary provider
   - "create_routine" → call routines DB insert
   - Each executor returns a short plain-English result string, e.g. "Added 2 gallons of milk to shopping list."
   - Wrap each executor in try/except — return error description string on failure

2. providers/llm/claude_api.py — MODIFY:
   - Add method: async def chat_with_tools(self, messages: list, tools: list, system: str) -> dict
   - Pass tools list in API call: client.messages.create(..., tools=tools)
   - If response stop_reason == "tool_use":
     - Extract tool_use block (name + input)
     - Return {"type": "tool_call", "tool_name": ..., "tool_input": ..., "tool_use_id": ...}
   - Else: return {"type": "text", "content": response_text}
   - For tool_result turn: send messages + tool_result block back to get final text response

3. providers/llm/ollama.py — MODIFY:
   - Add method: async def chat_with_tools(self, messages: list, tools: list) -> dict
   - Use ollama's tool/function calling format (supported in llama3.1, qwen2.5, mistral)
   - Same return shape as Claude: {"type": "tool_call", ...} or {"type": "text", ...}

4. core/conversation_loop.py — MODIFY the LLM call section:
   - If settings.tool_use_enabled:
     - Import TOOL_SCHEMAS and execute_tool from core/tools.py
     - Call chat_with_tools() instead of chat()
     - If response type is "tool_call": call execute_tool(), send result back to LLM, get final text
     - Final text goes to TTS as normal
   - Else: existing path unchanged

5. .env.example — ADD:
   TOOL_USE_ENABLED=false
   TOOL_USE_PROVIDER=anthropic

6. config/settings.py — ADD:
   tool_use_enabled: bool = False
   tool_use_provider: str = "anthropic"

RULES:
- Default tool_use_enabled to False
- Tool executors must never raise exceptions to the caller — always return a string
- If a required provider (Google Calendar, Home Assistant) is not configured, return a graceful message
- The system prompt sent with tool calls should instruct the model to use tools for actions,
  not just describe them
- Do not change any existing non-tool-use code paths

Output every file changed and a quick test script showing how to manually test one tool call.
```

---

## PROMPT 4 — Vision Model (Image Analysis)

```
You are implementing Phase 4 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. Ollama is running locally. Frontend: React/Vite.

PROJECT OVERVIEW:
- Ollama is already used for LLM (providers/llm/ollama.py)
- The culinary system handles recipes (api/routes/culinary.py, frontend/src/pages/CulinaryPage.jsx)
- The inventory system handles items (api/routes/inventory.py, frontend/src/pages/InventoryPage.jsx)
- The commerce system handles product listings (frontend/src/pages/CommercePage.jsx)
- All settings use Pydantic BaseSettings in config/settings.py
- New API routes must be registered in main.py
- Frontend calls backend at /api/* prefix

HARDWARE NOTE: GTX 1050 Ti (4GB VRAM). Use moondream (1.7GB, lightweight) as default vision model.
llava:7b is an alternative but may run on CPU RAM (still functional, just slower).

TASK: Let River Song analyze photos to auto-fill data fields. A user uploads a photo of a product, 
recipe, or inventory item — the vision model describes it and returns structured data.

BEFORE WRITING CODE, READ THESE FILES:
1. providers/llm/ollama.py — understand the ollama client usage
2. api/routes/culinary.py — understand existing upload/photo handling
3. api/routes/inventory.py — understand existing item creation
4. main.py — understand how routers are registered
5. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. providers/llm/vision_provider.py — NEW FILE:
   - Class VisionProvider
   - __init__: stores model name (settings.vision_model), ollama base URL
   - Method: async def analyze_image(self, image_bytes: bytes, prompt: str) -> str
     - Converts image_bytes to base64
     - Calls ollama chat with image in message: {"role": "user", "content": prompt, "images": [base64_str]}
     - Returns the text response
   - Method: async def extract_recipe_data(self, image_bytes: bytes) -> dict
     - Prompt: "Look at this recipe image. Extract: title, ingredient list, any visible instructions. Return as JSON with keys: title, ingredients (list of strings), notes."
     - Parse response as JSON, return dict. On parse failure return {"title": "", "ingredients": [], "notes": raw_response}
   - Method: async def extract_inventory_item(self, image_bytes: bytes) -> dict
     - Prompt: "Look at this product/item image. Extract: item name, estimated quantity if visible, category (food/electronics/clothing/household/other), brief description. Return as JSON with keys: name, category, description."
     - Same JSON parse pattern
   - Method: async def suggest_listing_details(self, image_bytes: bytes) -> dict
     - Prompt: "Look at this product image. Suggest: title for an online listing, description (2-3 sentences), 5 relevant tags. Return as JSON with keys: title, description, tags (list)."
     - Same JSON parse pattern
   - Gate all methods behind settings.vision_enabled — return empty dict / empty string if disabled

2. api/routes/vision.py — NEW FILE:
   - POST /api/vision/analyze
     - Accepts: multipart form with file (image) and prompt (str, optional)
     - Returns: {"description": str, "model_used": str}
   - POST /api/vision/recipe
     - Accepts: multipart form with file (image)
     - Returns: {"title": str, "ingredients": list, "notes": str}
   - POST /api/vision/inventory-item
     - Accepts: multipart form with file (image)
     - Returns: {"name": str, "category": str, "description": str}
   - POST /api/vision/listing
     - Accepts: multipart form with file (image)
     - Returns: {"title": str, "description": str, "tags": list}
   - All endpoints require authentication (use same auth dependency as other routes)
   - Return 503 with message "Vision model not enabled" if vision_enabled is False

3. main.py — ADD:
   - Import vision router from api/routes/vision.py
   - app.include_router(vision_router, prefix="/api")

4. frontend/src/pages/CulinaryPage.jsx — MODIFY:
   - On the recipe photo upload input (find existing file input), add an "Analyze Photo" button next to it
   - On click: POST image to /api/vision/recipe
   - On response: auto-populate the recipe title field and ingredients list in the add-recipe form
   - Show a loading spinner during analysis
   - Show error toast if vision is disabled (503)

5. frontend/src/pages/InventoryPage.jsx — MODIFY:
   - On the item photo upload, add an "Analyze Photo" button
   - On click: POST image to /api/vision/inventory-item
   - On response: auto-fill name, category, description fields in add-item form

6. frontend/src/pages/CommercePage.jsx — MODIFY:
   - On product image upload, add "Generate Listing Details" button
   - On click: POST image to /api/vision/listing
   - On response: auto-fill title, description, tags fields

7. .env.example — ADD:
   VISION_MODEL=moondream
   VISION_ENABLED=false

8. config/settings.py — ADD:
   vision_model: str = "moondream"
   vision_enabled: bool = False

RULES:
- Default vision_enabled to False
- If the vision model is not available in Ollama, catch the error and return a helpful message
- All file uploads must enforce a 10MB size limit
- Never store uploaded images server-side — process in memory and discard
- Do not modify existing photo display/storage logic — only add the "analyze" action

Output every file changed and the exact ollama command to pull the model:
`ollama pull moondream`
```

---

## PROMPT 5 — RAG for Local Documents

```
You are implementing Phase 5 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. ChromaDB is available (added in Phase 1). Ollama embeddings available.

PROJECT OVERVIEW:
- Vehicle manuals (PDFs) are uploaded in the vehicles system (api/routes/vehicles.py)
- Culinary PDFs are handled in api/routes/culinary.py
- pypdf and pymupdf are already in requirements.txt for PDF text extraction
- Chroma vector store pattern was established in Phase 1 (providers/memory/vector_store.py)
- The intent router in core/intent_router.py decides how to handle user queries
- All settings in config/settings.py (Pydantic BaseSettings)

TASK: When a user uploads a vehicle manual PDF or other document, chunk it, embed it, and store it 
in ChromaDB. When a user asks a maintenance/document question in conversation, retrieve relevant 
chunks and inject them into the LLM context so River Song can answer from the actual document.

BEFORE WRITING CODE, READ THESE FILES:
1. providers/memory/vector_store.py — understand the Chroma pattern from Phase 1
2. providers/memory/embedding_provider.py — understand embedding pattern from Phase 1
3. api/routes/vehicles.py — understand PDF upload and vehicle data structure
4. core/intent_router.py — understand how to add new intent handlers
5. core/conversation_loop.py — understand how context is passed to LLM
6. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. providers/rag/chunker.py — NEW FILE:
   - Function: chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]
     - Splits text into overlapping chunks by word count
     - Returns list of chunk strings
   - Function: extract_text_from_pdf(file_bytes: bytes) -> str
     - Uses pypdf (PdfReader) to extract all text from PDF bytes
     - Returns concatenated text string
     - Falls back to pymupdf (fitz) if pypdf returns empty text

2. providers/rag/__init__.py — NEW FILE (empty or minimal)

3. providers/rag/rag_provider.py — NEW FILE:
   - Class RAGProvider
   - __init__: instantiates EmbeddingProvider and VectorStore (from Phase 1 providers); 
     uses collection name "river_song_docs" (separate from memory collection)
   - Method: async def ingest_document(self, doc_id: str, file_bytes: bytes, file_type: str = "pdf", metadata: dict = {})
     - Extract text (use chunker.extract_text_from_pdf for PDFs)
     - Chunk text with chunker.chunk_text()
     - For each chunk: upsert into vector store with id=f"{doc_id}_chunk_{i}", 
       metadata={"doc_id": doc_id, "chunk_index": i, **metadata}
     - Return {"chunks_ingested": count}
   - Method: async def query(self, question: str, doc_id: str = None, n_chunks: int = 5) -> list[str]
     - Search vector store with question embedding
     - If doc_id provided: filter by metadata doc_id
     - Return list of relevant chunk text strings
   - Method: async def query_as_context(self, question: str, doc_id: str = None) -> str
     - Calls query(), formats chunks into a context block:
       "Relevant document excerpts:\n---\n{chunk1}\n---\n{chunk2}\n..."
     - Returns empty string if no results or RAG disabled
   - Gate all methods behind settings.rag_enabled

4. api/routes/rag.py — NEW FILE:
   - POST /api/rag/ingest
     - Accepts: multipart file + doc_id (str) + doc_type (str, optional)
     - Calls rag_provider.ingest_document()
     - Returns: {"status": "ok", "chunks_ingested": n}
   - POST /api/rag/query
     - Accepts JSON: {"question": str, "doc_id": str (optional)}
     - Returns: {"context": str, "chunks": list[str]}
   - Require auth on both endpoints

5. main.py — ADD rag router (prefix="/api")

6. api/routes/vehicles.py — MODIFY:
   - After successfully saving a PDF manual: call rag_provider.ingest_document(doc_id=str(vehicle_id), file_bytes=pdf_bytes, file_type="pdf", metadata={"vehicle_name": vehicle_name, "type": "manual"})
   - Do this asynchronously (fire and forget with asyncio.create_task) so upload doesn't block

7. core/intent_router.py — MODIFY:
   - Add RAG intent check: if rag_enabled and user message contains maintenance/repair/manual keywords 
     (oil, tire, brake, filter, service, interval, manual, specification, torque, fluid):
     - Check if user has vehicles with ingested manuals
     - If yes: call rag_provider.query_as_context(question, doc_id=vehicle_id)
     - If context returned: prepend to the LLM system prompt as document context
   - This should happen before the LLM call, not replace it

8. .env.example — ADD:
   RAG_ENABLED=false
   RAG_CHUNK_SIZE=512
   RAG_CHUNK_OVERLAP=64
   RAG_TOP_K=5

9. config/settings.py — ADD:
   rag_enabled: bool = False
   rag_chunk_size: int = 512
   rag_chunk_overlap: int = 64
   rag_top_k: int = 5

RULES:
- Default rag_enabled to False
- RAG must depend on Phase 1 (semantic memory) being available — check for chromadb import at top
- Never block the vehicle upload endpoint — RAG ingestion is always fire-and-forget
- If embedding is unavailable, log a warning and skip ingestion silently
- Keep the "river_song_docs" collection separate from "river_song_memory" collection

Output every file changed with a summary of changes.
```

---

## PROMPT 6 — Whisper Model Upgrade

```
You are implementing Phase 6 of a local AI integration for River Song AI, a personal AI OS.
This is a simple configuration upgrade — minimal code changes required.

PROJECT OVERVIEW:
- Server: Ubuntu 25.10, GTX 1050 Ti (4GB VRAM), 32GB RAM
- Whisper runs locally via providers/stt/whisper_local.py
- Current setting: WHISPER_MODEL_SIZE=base (74MB, ~60% accuracy)
- Settings loaded from .env via config/settings.py (Pydantic BaseSettings)
- NVIDIA drivers are NOT yet installed on server (run: sudo ubuntu-drivers autoinstall)

TASK: Update the Whisper provider to support dynamic model size selection and add a note about
the upgrade path. Also add model size validation and a descriptive log on startup.

BEFORE WRITING CODE, READ THESE FILES:
1. providers/stt/whisper_local.py — understand current model loading
2. config/settings.py — understand whisper_model_size setting (may already exist)
3. .env.example — see current WHISPER_MODEL_SIZE value
4. api/routes/models_settings.py — understand the model settings UI

IMPLEMENT THE FOLLOWING:

1. providers/stt/whisper_local.py — MODIFY:
   - On model load, log: f"Loading Whisper model: {model_size} ({MODEL_INFO[model_size]['size']}, ~{MODEL_INFO[model_size]['accuracy']} accuracy)"
   - Add MODEL_INFO dict at top:
     {
       "tiny":   {"size": "39MB",  "accuracy": "low",        "vram": "~1GB"},
       "base":   {"size": "74MB",  "accuracy": "moderate",   "vram": "~1GB"},
       "small":  {"size": "244MB", "accuracy": "good",       "vram": "~2GB"},
       "medium": {"size": "1.5GB", "accuracy": "very good",  "vram": "~5GB (use CPU)"},
       "large":  {"size": "2.9GB", "accuracy": "excellent",  "vram": "~10GB (use CPU)"},
     }
   - Add validation: if model_size not in MODEL_INFO, log warning and fall back to "base"
   - If model_size is "medium" or "large", log a note: "Medium/large Whisper runs on CPU — ensure Ollama GPU allocation doesn't conflict"

2. api/routes/models_settings.py — MODIFY:
   - In the model settings response (wherever Whisper config is exposed), add whisper model info:
     "whisper": {"current_model": settings.whisper_model_size, "available_models": list(MODEL_INFO.keys()), "recommendation": "small for GPU-shared, medium for dedicated CPU"}
   - If this endpoint doesn't exist yet, just ensure the setting is readable from settings.py

3. .env.example — UPDATE the WHISPER_MODEL_SIZE comment:
   # tiny (39MB) | base (74MB) | small (244MB, recommended) | medium (1.5GB) | large (2.9GB)
   # Upgrade to 'small' after running: sudo ubuntu-drivers autoinstall
   WHISPER_MODEL_SIZE=base

4. HANDOFF.md — ADD to "What's Still Left" section:
   5. **Whisper upgrade** — change WHISPER_MODEL_SIZE=base to =small in .env after NVIDIA drivers installed (sudo ubuntu-drivers autoinstall). Medium/large run on CPU only.

RULES:
- Do not change WHISPER_MODEL_SIZE default in .env.example — leave it as "base"
- The model size change for production is a manual step (edit .env on server), not automatic
- Do not restart the service or change startup behavior beyond better logging

Output every file changed with a summary.
```

---

## PROMPT 7 — Analytics AI Summaries

```
You are implementing Phase 7 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. Ollama runs locally for LLM. Frontend: React/Vite.

PROJECT OVERVIEW:
- Analytics data is fetched in api/routes/analytics.py for platforms: TikTok, Instagram, 
  Facebook, YouTube, Etsy, eBay, Pinterest, Shopify, Twitter/X
- Frontend analytics UI is in frontend/src/pages/AnalyticsPage.jsx
- Ollama is the local LLM (providers/llm/ollama.py) — no business data leaves the server
- All settings in config/settings.py. Frontend calls backend at /api/* prefix.
- docs/api_registry/ has reference docs for each platform's analytics data

TASK: After fetching platform analytics data, use the local Ollama LLM to generate plain-English 
insights and recommendations. Business data stays local — no cloud LLM for this feature.

BEFORE WRITING CODE, READ THESE FILES:
1. api/routes/analytics.py — understand current data fetch structure and response format
2. frontend/src/pages/AnalyticsPage.jsx — understand how data is displayed
3. providers/llm/ollama.py — understand the chat() method
4. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. api/routes/analytics.py — MODIFY:
   - Add new endpoint: GET /api/analytics/{platform}/summary
     - platform: one of tiktok | instagram | facebook | youtube | etsy | ebay | pinterest | shopify | twitter
     - Fetch current analytics data for that platform (reuse existing fetch logic)
     - If no data or platform not configured: return {"summary": "No data available", "insights": [], "recommendations": []}
     - Build a prompt:
       f"""You are a social media and e-commerce analyst. Analyze these {platform} metrics and provide actionable advice.

       Metrics data:
       {json.dumps(metrics_data, indent=2)}

       Respond with JSON only (no markdown) in this exact format:
       {{
         "summary": "2-3 sentence plain English overview of performance",
         "insights": ["insight 1", "insight 2", "insight 3"],
         "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
       }}"""
     - Call Ollama chat() with this prompt (use a small/fast model: settings.analytics_llm_model)
     - Parse JSON response, return it
     - On parse failure: return {"summary": raw_response, "insights": [], "recommendations": []}
     - Require auth
   - Cache results for 1 hour using a simple in-memory dict {platform: (timestamp, result)}
     so repeated calls don't re-run the LLM

2. frontend/src/pages/AnalyticsPage.jsx — MODIFY:
   - For each platform section that has data, add an "AI Summary" button or collapsible card below the metrics
   - On expand/click: fetch GET /api/analytics/{platform}/summary
   - Show loading spinner during fetch
   - Display result as:
     - Summary paragraph (italic, slightly muted color)
     - "Insights" section with 3 bullet points
     - "Recommendations" section with 3 bullet points  
     - Small badge: "Generated locally by [model name]" 
   - Cache the result in React state so re-opening doesn't re-fetch

3. .env.example — ADD:
   ANALYTICS_AI_ENABLED=false
   ANALYTICS_LLM_MODEL=llama3.2:3b

4. config/settings.py — ADD:
   analytics_ai_enabled: bool = False
   analytics_llm_model: str = "llama3.2:3b"

RULES:
- Default analytics_ai_enabled to False
- ONLY use Ollama for this feature — never send analytics data to Claude/OpenAI/Gemini
- The /summary endpoint must check analytics_ai_enabled and return 503 if disabled
- Use a small, fast model (3b) as default — analysis runs in background while user reads raw metrics
- Cache is in-memory only (lost on restart) — that's fine, analytics don't need persistence
- If Ollama is unreachable, return graceful fallback (don't crash)

Output every file changed with a summary of changes.
```

---

## PROMPT 8 — Local Image Generation (Stable Diffusion 1.5)

```
You are implementing Phase 8 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. Frontend: React/Vite. Server: Ubuntu 25.10, GTX 1050 Ti (4GB VRAM).

PROJECT OVERVIEW:
- The server will have AUTOMATIC1111 Stable Diffusion WebUI running at localhost:7860 with --api flag
- SD 1.5 (not SDXL or Flux — hardware limit: 4GB VRAM max) will be installed
- Commerce products are managed in api/routes/commerce.py and CommercePage.jsx
- Culinary recipes are in api/routes/culinary.py and CulinaryPage.jsx
- New API routes must be registered in main.py
- All settings in config/settings.py (Pydantic BaseSettings)
- httpx is already in requirements.txt for async HTTP

TASK: Add local AI image generation for product listings (Etsy/eBay), recipe card art, 
and inventory visuals. Images are generated by SD 1.5 via the AUTOMATIC1111 REST API.

BEFORE WRITING CODE, READ THESE FILES:
1. main.py — understand router registration
2. api/routes/commerce.py — understand product data structure
3. api/routes/culinary.py — understand recipe data structure
4. frontend/src/pages/CommercePage.jsx — find where product images are displayed
5. frontend/src/pages/CulinaryPage.jsx — find where recipe photos are displayed
6. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. providers/image/__init__.py — NEW FILE (empty)

2. providers/image/sd_provider.py — NEW FILE:
   - Class SDProvider
   - __init__: stores sd_api_url, default_steps, default_width, default_height
   - Method: async def generate(self, prompt: str, negative_prompt: str = "", width: int = None, height: int = None, steps: int = None) -> bytes
     - POST to {sd_api_url}/sdapi/v1/txt2img with JSON payload
     - Payload: {"prompt": prompt, "negative_prompt": negative_prompt or "blurry, low quality, watermark, text", "width": width or settings.sd_default_width, "height": height or settings.sd_default_height, "steps": steps or settings.sd_default_steps, "cfg_scale": 7, "sampler_name": "Euler a"}
     - Response: {"images": ["base64_string", ...]} — decode images[0] from base64 to bytes
     - Return PNG bytes
     - Raise ConnectionError with helpful message if SD API unreachable
   - Method: async def generate_product_image(self, product_name: str, product_description: str = "", style: str = "product photo") -> bytes
     - Build prompt: f"professional {style} of {product_name}, {product_description}, white background, studio lighting, high quality"
     - Call generate() with 512x512
   - Method: async def generate_recipe_card(self, recipe_title: str, ingredients_preview: str = "") -> bytes
     - Build prompt: f"food photography, {recipe_title}, {ingredients_preview}, rustic wooden table, natural lighting, appetizing, high quality"
     - Call generate() with 512x512
   - Gate all methods behind settings.image_generation_enabled — raise RuntimeError("Image generation disabled") if disabled

3. api/routes/image.py — NEW FILE:
   - POST /api/image/generate
     - Accepts JSON: {"prompt": str, "negative_prompt": str (opt), "width": int (opt), "height": int (opt), "steps": int (opt)}
     - Returns PNG bytes with content-type image/png
   - POST /api/image/product
     - Accepts JSON: {"product_name": str, "description": str (opt), "style": str (opt)}
     - Returns PNG bytes
   - POST /api/image/recipe
     - Accepts JSON: {"title": str, "ingredients": list[str] (opt)}
     - Calls generate_recipe_card(title, ", ".join(ingredients[:4]))
     - Returns PNG bytes
   - All endpoints: require auth, return 503 with JSON error if image_generation_enabled is False

4. main.py — ADD image router (prefix="/api")

5. frontend/src/pages/CommercePage.jsx — MODIFY:
   - On each product listing card / product creation form, add "Generate Image" button
   - On click: POST to /api/image/product with {product_name, description}
   - Show loading spinner (generation takes 10-30 seconds)
   - On response: display the generated image; offer "Use This Image" button to set as product photo
   - Show "Image generation not available" message if 503

6. frontend/src/pages/CulinaryPage.jsx — MODIFY:
   - On recipes without a photo, add "Generate Recipe Art" button
   - On click: POST to /api/image/recipe with {title, ingredients}
   - Show loading spinner
   - On response: display image with option to save it as the recipe's photo

7. .env.example — ADD:
   IMAGE_GENERATION_ENABLED=false
   SD_API_URL=http://localhost:7860
   SD_DEFAULT_MODEL=v1-5-pruned-emaonly.safetensors
   SD_DEFAULT_STEPS=20
   SD_DEFAULT_WIDTH=512
   SD_DEFAULT_HEIGHT=512

8. config/settings.py — ADD:
   image_generation_enabled: bool = False
   sd_api_url: str = "http://localhost:7860"
   sd_default_model: str = "v1-5-pruned-emaonly.safetensors"
   sd_default_steps: int = 20
   sd_default_width: int = 512
   sd_default_height: int = 512

RULES:
- Default image_generation_enabled to False — SD must be manually set up first
- Image generation is slow (10-30s) — never block on it; frontend must show a loading state
- Never store generated images server-side unless user explicitly saves them
- SD 1.5 only — do not reference SDXL or Flux anywhere in comments or prompts
- httpx timeout for SD API calls should be 120 seconds (generation can be slow)

Also output the manual setup instructions as a comment block at the top of sd_provider.py:
# SETUP: Install AUTOMATIC1111 on server:
# git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui /mnt/data/stable-diffusion
# Download v1-5-pruned-emaonly.safetensors to /mnt/data/stable-diffusion/models/Stable-diffusion/
# Run: cd /mnt/data/stable-diffusion && bash webui.sh --api --listen --port 7860 --nowebui

Output every file changed with a summary.
```

---

## PROMPT 9 — Voice Cloning (Chatterbox TTS)

```
You are implementing Phase 9 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. The TTS system uses a pluggable provider pattern. Server: Ubuntu 25.10, 
GTX 1050 Ti (4GB VRAM). NVIDIA drivers must be installed first (sudo ubuntu-drivers autoinstall).

PROJECT OVERVIEW:
- TTS providers live in providers/tts/
- Piper is the current primary TTS (providers/tts/piper.py)
- Kokoro is an alternative (providers/tts/kokoro_provider.py, CPU-native)
- Voice registry is in providers/tts/voice_registry.py
- TTS provider is selected by TTS_PROVIDER env var in config/settings.py
- Model settings UI is in api/routes/models_settings.py
- Chatterbox is referenced in requirements.txt comments (chatterbox-tts==0.1.7, needs <4.5GB VRAM)

TASK: Add Chatterbox TTS as a new provider option for voice cloning. The user records a reference
audio clip; Chatterbox clones that voice zero-shot. River Song speaks in a custom cloned voice.

BEFORE WRITING CODE, READ THESE FILES:
1. providers/tts/piper.py — understand the TTS provider interface (methods, return type)
2. providers/tts/kokoro_provider.py — understand alternative provider pattern
3. providers/tts/voice_registry.py — understand voice catalog structure
4. api/routes/models_settings.py — understand TTS provider/voice selection API
5. config/settings.py and .env.example — understand TTS settings pattern

IMPLEMENT THE FOLLOWING:

1. providers/tts/chatterbox_provider.py — NEW FILE:
   - Implement same interface as piper.py and kokoro_provider.py
   - Class ChatterboxProvider
   - __init__:
     - Check if chatterbox is importable: try/except ImportError → set self.available = False, log warning
     - If available: load model with ChatterboxTTS.from_pretrained(device="cuda" if GPU else "cpu")
     - Load reference audio from settings.chatterbox_reference_audio path (if file exists)
     - self.available = True only if both model loaded and reference audio exists
   - Method: async def synthesize(self, text: str, voice_id: str = None) -> bytes
     - If not self.available: raise RuntimeError("Chatterbox not available")
     - Call model.generate(text, audio_prompt_path=reference_audio_path, exaggeration=settings.chatterbox_exaggeration, cfg_weight=settings.chatterbox_cfg_weight)
     - Convert output tensor to WAV bytes (use torchaudio or scipy.io.wavfile)
     - Return WAV bytes
   - Handle long text by chunking at sentence boundaries if text > 200 chars

2. providers/tts/voice_registry.py — MODIFY:
   - Add Chatterbox entries to the voice catalog:
     {"id": "chatterbox_cloned", "name": "River Song (Cloned)", "provider": "chatterbox", "description": "Zero-shot voice clone from reference audio", "language": "en"}
     {"id": "chatterbox_cloned_expressive", "name": "River Song Expressive (Cloned)", "provider": "chatterbox", "description": "Higher exaggeration clone", "language": "en"}

3. api/routes/models_settings.py — MODIFY:
   - In the TTS providers list response, add chatterbox:
     {"id": "chatterbox", "name": "Chatterbox (Voice Clone)", "available": chatterbox_provider.available, "requires_gpu": True, "note": "Record voice_reference.wav first"}
   - Add endpoint: POST /api/settings/tts/upload-reference
     - Accepts multipart WAV file
     - Saves to settings.chatterbox_reference_audio path
     - Returns {"status": "ok", "path": path}
     - Require admin auth

4. main.py or wherever TTS provider is instantiated — MODIFY:
   - Add Chatterbox to provider selection logic:
     if settings.tts_provider == "chatterbox": provider = ChatterboxProvider()

5. requirements.txt — MODIFY:
   - Move chatterbox-tts==0.1.7 from comments to active section, but keep it commented with note:
     # chatterbox-tts==0.1.7   # Voice cloning TTS — requires NVIDIA GPU + drivers
     #   Install manually: pip install chatterbox-tts==0.1.7
     #   Needs: sudo ubuntu-drivers autoinstall (NVIDIA drivers)

6. .env.example — ADD:
   CHATTERBOX_ENABLED=false
   CHATTERBOX_REFERENCE_AUDIO=/mnt/data/river-song/voice_reference.wav
   CHATTERBOX_EXAGGERATION=0.5
   CHATTERBOX_CFG_WEIGHT=0.5

7. config/settings.py — ADD:
   chatterbox_enabled: bool = False
   chatterbox_reference_audio: str = "/mnt/data/river-song/voice_reference.wav"
   chatterbox_exaggeration: float = 0.5
   chatterbox_cfg_weight: float = 0.5

RULES:
- Chatterbox must fail gracefully if not installed — fall back to Piper automatically
- Never crash the app if chatterbox-tts import fails
- Reference audio must be WAV format, 16kHz or 22kHz, mono
- Add a clear startup log message if chatterbox is enabled but reference audio not found
- Do not change any existing Piper or Kokoro behavior

Also output a setup checklist as a comment in chatterbox_provider.py:
# SETUP CHECKLIST:
# 1. sudo ubuntu-drivers autoinstall && sudo reboot
# 2. pip install chatterbox-tts==0.1.7
# 3. Record 10-30s clear speech: save as /mnt/data/river-song/voice_reference.wav
# 4. Set TTS_PROVIDER=chatterbox in .env
# 5. Set CHATTERBOX_ENABLED=true in .env

Output every file changed with a summary.
```

---

## PROMPT 10 — n8n for Complex Routines

```
You are implementing Phase 10 of a local AI integration for River Song AI, a personal AI OS.
Backend: FastAPI. The server will run n8n via Docker at localhost:5678.

PROJECT OVERVIEW:
- Simple routines system exists in api/routes/routines.py and frontend/src/pages/RoutinesPage.jsx
- n8n will be a separate Docker container on the same server (localhost:5678)
- n8n can call River Song's own API via webhooks and HTTP requests
- River Song can trigger n8n workflows via n8n's REST API
- New routes must be registered in main.py
- All settings in config/settings.py (Pydantic BaseSettings)
- httpx is already in requirements.txt

TASK: Add n8n as an "Advanced Routines" option alongside the existing simple routines.
n8n handles complex multi-step automations; River Song provides a webhook endpoint that n8n 
can call, and River Song can trigger n8n workflows via API.

BEFORE WRITING CODE, READ THESE FILES:
1. api/routes/routines.py — understand current routine data structure and endpoints
2. frontend/src/pages/RoutinesPage.jsx — understand current routines UI
3. main.py — understand router registration
4. config/settings.py and .env.example

IMPLEMENT THE FOLLOWING:

1. providers/automation/__init__.py — NEW FILE (empty)

2. providers/automation/n8n_client.py — NEW FILE:
   - Class N8NClient
   - __init__: stores n8n_url, api_key, webhook_secret
   - Method: async def trigger_workflow(self, workflow_id: str, data: dict = {}) -> dict
     - POST to {n8n_url}/api/v1/workflows/{workflow_id}/execute with auth header
     - Returns execution result or {"status": "triggered"}
   - Method: async def list_workflows(self) -> list[dict]
     - GET {n8n_url}/api/v1/workflows
     - Returns list of {id, name, active} dicts
   - Method: async def get_workflow(self, workflow_id: str) -> dict
     - GET {n8n_url}/api/v1/workflows/{workflow_id}
   - Method: async def is_available(self) -> bool
     - GET {n8n_url}/healthz — return True if 200, False otherwise
   - Gate all methods behind settings.n8n_enabled

3. api/routes/n8n_webhooks.py — NEW FILE:
   - POST /api/webhooks/n8n
     - Accepts any JSON body from n8n
     - Validates webhook secret header (X-N8N-Secret) against settings.n8n_webhook_secret
     - Routes action based on body["action"] field:
       - "speak" → queue text for TTS (store in a shared in-memory queue)
       - "notify" → store as a notification in SQLite (create notifications table if needed)
       - "run_routine" → trigger a River Song routine by name
       - "log" → write to River Song logs
     - Returns {"status": "ok", "action": action}
   - GET /api/webhooks/n8n/status — returns {"n8n_available": bool, "n8n_url": str}
   - No auth required on webhook endpoint (secured by webhook secret instead)

4. api/routes/routines.py — MODIFY:
   - Add endpoint: GET /api/routines/n8n/workflows
     - Calls n8n_client.list_workflows()
     - Returns list of n8n workflows (for display in UI)
     - Return empty list if n8n unavailable, not 500 error

5. main.py — ADD n8n_webhooks router (prefix="/api")

6. frontend/src/pages/RoutinesPage.jsx — MODIFY:
   - Add a new "Advanced Automations (n8n)" section below existing routines
   - Show n8n status (available/unavailable) with a colored indicator
   - If available: show list of n8n workflows (fetched from /api/routines/n8n/workflows)
   - Add "Open n8n Editor" button → opens n8n UI in new tab at n8n_url (from /api/webhooks/n8n/status)
   - Add an info card explaining: "Advanced automations run in n8n and can trigger River Song actions via webhooks"
   - If n8n unavailable: show setup instructions card (see Docker command below)

7. .env.example — ADD:
   N8N_ENABLED=false
   N8N_URL=http://localhost:5678
   N8N_API_KEY=
   N8N_WEBHOOK_SECRET=

8. config/settings.py — ADD:
   n8n_enabled: bool = False
   n8n_url: str = "http://localhost:5678"
   n8n_api_key: str = ""
   n8n_webhook_secret: str = ""

RULES:
- Default n8n_enabled to False
- n8n is always optional — all existing routines must continue working without it
- Webhook secret validation must use constant-time comparison (use hmac.compare_digest)
- Never expose the webhook secret in any API response
- If n8n is unreachable, all n8n endpoints return graceful empty/false responses, never 500 errors

Also output the Docker setup command as a comment at the top of n8n_client.py:
# SETUP: Run n8n via Docker on the server:
# docker run -d \
#   --name n8n \
#   --restart unless-stopped \
#   -p 5678:5678 \
#   -e N8N_BASIC_AUTH_ACTIVE=true \
#   -e N8N_BASIC_AUTH_USER=riversong \
#   -e N8N_BASIC_AUTH_PASSWORD=<your_password> \
#   -e N8N_WEBHOOK_URL=http://localhost:5678/ \
#   -v /mnt/data/river-song/n8n:/home/node/.n8n \
#   n8nio/n8n
# Then get API key from n8n UI → Settings → API → Create API Key
# Set N8N_API_KEY and N8N_WEBHOOK_SECRET in .env

Output every file changed with a summary of changes.
```
