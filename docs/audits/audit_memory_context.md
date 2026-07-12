# Memory and Context Engine Audit

This document outlines the findings of the audit conducted on the River Song AI codebase, specifically focusing on `core/context_engine.py`, `core/memory_manager.py`, and `core/conversation_loop.py`.

## 1. System Components
* **`ContextEngine` (`core/context_engine.py`)**: Maintains a live view of the physical environment (room occupancy, temperature, lights) via Home Assistant sensors.
* **`MemoryManager` (`core/memory_manager.py`)**: Manages the three-tier memory system: Known Facts, User Preferences, and Conversation Summaries. Uses SQLite as the source of truth, with optional ChromaDB/MemGPT vector capabilities.
* **`ScribeDaemon` (`daemons/scribe/scribe.py`)**: A background service that heuristically scans the user's document vault and extracts facts.
* **`ConversationLoop` (`core/conversation_loop.py`)**: The central orchestrator that handles turn-by-turn routing, inference, memory injection, and state tracking.

## 2. Memory Lifecycle

### A. Extraction
Memory extraction differs heavily based on the type of memory:
* **Facts**: 
  * **How:** Extracted asynchronously from *user notes* by the `ScribeDaemon`. It scans for stale notes (where `mtime > indexed_at`), feeds the note content into an LLM with a specialized extraction prompt, and expects a JSON array of `key: value` pairs.
  * **Note:** Facts are *not* currently extracted from live conversations.
* **Preferences / Habits**:
  * **How:** Extracted from the *conversation*. During Phase 15 of `ConversationLoop.run_once()`, a non-blocking background task (`_infer_habits()`) prompts the LLM to identify if the user demonstrated any specific habits or routines in that turn.
  * **Note:** These are saved as *pending* habits (awaiting human approval), not immediately applied as active preferences.
* **Summaries**:
  * **How:** Extracted synchronously at the end of each conversation turn. 
  * **Note:** No LLM is used here. The system simply builds a naïve string: `User said: "{transcript[:200]}". River Song responded: "{full_response[:200]}".`
* **Episodes (Graphiti)**:
  * **How:** At the end of a turn or when `ScribeDaemon` processes a note, raw transcripts and document segments are fire-and-forget written to Graphiti (`get_graphiti_provider().add_episode()`).

### B. Storage
* **Source of Truth**: All facts, preferences, pending habits, and summaries are stored in SQLite (`SQLiteStore`).
* **Semantic Vectors**: If `semantic_memory_enabled` is true, Facts and Preferences are *mirrored* to Chroma (`VectorStore`) inside `upsert_fact` and `upsert_preference`.
* **Summaries TTL**: Summaries are assigned a Time-To-Live (TTL). When `build_context_block` accesses them, it automatically extends the expiration date of referenced summaries if `auto_extend` is enabled.

### C. Retrieval & Injection
* At the beginning of a conversation turn, `ConversationLoop` calls `_rebuild_system_prompt()`.
* **Physical Context**: `ContextEngine.build_context_block()` filters out stale room data (older than 30 minutes) and formats the active environment (`"Living Room: 1 person(s) present, active..."`).
* **Memory Context**: `MemoryManager.build_context_block(user_id)` retrieves memory. 
  * Currently, it loads **ALL** active facts, **ALL** preferences, and up to `memory_max_summaries_in_context` recent summaries. 
  * These text blocks are pre-pended to the active `system` prompt message before routing to the LLM.

## 3. Evaluation: Efficiency and Accuracy

### Strengths (Highly Efficient)
> [!TIP]
> The overall architecture correctly delegates heavy operations to background loops, preventing system hangs during live audio interaction.

* **Non-blocking Extraction**: Extracting habits (`_infer_habits`) and extracting facts (`ScribeDaemon`) happen asynchronously. The user does not wait for these LLM calls to complete before receiving a TTS response.
* **Summary Speed**: By simply truncating strings to 200 characters rather than asking an LLM to synthesize the chat, the summary step takes `O(1)` time, keeping conversation turn latency extremely low.
* **Context Trimming**: `ContextEngine` successfully trims out stale physical environment data so the LLM doesn't act on outdated physical context. The TTL extension logic on summaries ensures old, unused logs naturally expire.

### Weaknesses (Scaling & Accuracy Risks)
> [!WARNING]
> While the framework is resilient, semantic recall is currently orphaned and unbounded SQLite fetching will bloat the context window over time.

* **Wholesale Context Injection (Scaling Risk)**: `ConversationLoop` calls `MemoryManager.build_context_block()` *without* passing `query_text`. Because of this, it bypasses the semantic path entirely (`get_context_for_prompt`). Consequently, **every single fact and preference** in the SQLite database is injected into the system prompt on every turn. As the system gathers more facts over months, this will bloat token usage and confuse the LLM.
* **Orphaned Vector Store**: Because `query_text` is never passed during system prompt rebuilding, the Chroma `VectorStore` (and `memgpt_provider.recall` for long-term recall) is effectively unused for conversational memory retrieval.
* **Summarization Accuracy**: The 200-character string truncation for summaries is highly efficient but contextually poor. It is not a semantic summary, meaning long-winded answers or complex logic get cut off abruptly, making it harder for the AI to "remember" detailed past interactions accurately.
* **Graphiti is Write-Only**: The `ConversationLoop` diligently writes `Episodes` to Graphiti for cross-runtime recall, but there is no mechanism querying Graphiti during `_rebuild_system_prompt()` or intent routing.
* **Fact Mining Constraints**: Facts are strictly mined from Vault Notes (via Scribe). A user cannot naturally say "My favorite color is blue" and have it immediately stored as an active fact without the habit inferencer picking it up as a "pending habit" first.
