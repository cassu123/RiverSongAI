# River Song AI — Integrations

Catalog of every third-party service River Song talks to, grouped by
category. Each row links the provider module, the routes that surface it,
the API-registry setup guide, and a short config checklist.

**Status legend:** ✅ Live · ⚠️ Partial · 🔜 Planned (no implementation
yet)

**Setup complexity:** S = key only · M = OAuth or webhook · L =
multi-step / multi-service

---

## LLM Providers

| Integration | Status | Auth | Provider file | Routes | Setup |
|---|---|---|---|---|---|
| Ollama (local) | ✅ | none | `providers/llm/ollama.py` | `conversation.py`, `models_settings.py` | S — install Ollama, pull models |
| Anthropic Claude | ✅ | API key | `providers/llm/claude_api.py` | same | S — `ANTHROPIC_API_KEY` + `ANTHROPIC_ENABLED=true` |
| Google Gemini | ✅ | API key | `providers/llm/gemini.py` | same | S — `GEMINI_API_KEY` + `GEMINI_ENABLED=true` |
| OpenAI | ✅ | API key | `providers/llm/openai_api.py` | same | S — `OPENAI_API_KEY` + `OPENAI_ENABLED=true` |
| Mistral AI | ✅ | API key | `providers/llm/mistral_api.py` | same | S — `MISTRAL_API_KEY` + `MISTRAL_AI_ENABLED=true` |
| Amazon Bedrock | ✅ | IAM keys | `providers/llm/bedrock.py` | same | M — AWS keys + model access enabled per region |
| NVIDIA NIM | ✅ | API key | `providers/llm/nvidia_nim.py` | same | S — free `nvapi-*` key from build.nvidia.com |

The model-intent router (`providers/llm/model_intent_router.py`) picks the
best provider when `provider="auto"` and `MODEL_INTENT_ROUTER_ENABLED=true`.

---

## Google Suite (OAuth 2.0)

A single OAuth client (`config_files/google_client_secrets.json`)
authorizes all six surfaces. Per-user tokens are stored as JSON files in
`GOOGLE_TOKEN_STORAGE_PATH` (`data/google_tokens` by default).

| Integration | Status | Provider | Route | Registry | Setup |
|---|---|---|---|---|---|
| Auth orchestration | ✅ | `providers/google/auth.py` | `api/routes/feeds/google.py` | `docs/api_registry/google_oauth.txt` | M |
| Calendar | ✅ | `providers/google/calendar.py` | `api/routes/feeds/google.py` | google_oauth.txt | M |
| Gmail | ✅ | `providers/google/gmail.py` | google.py | google_oauth.txt | M |
| Maps | ✅ | `providers/google/maps.py` | `api/routes/feeds/location.py` | google_oauth.txt | S — also needs `GOOGLE_MAPS_API_KEY` |
| Tasks | ✅ | `providers/google/tasks.py` | google.py | google_oauth.txt | M |
| YouTube Music | ✅ | `providers/google/youtube_music.py` | google.py | google_oauth.txt | M |
| Books | ✅ | `providers/google/books.py` | (used via reading) | google_oauth.txt | M |

**Per-user setup:** the user authorizes once via the OAuth flow; the
refresh token is persisted to `{user_id}.json`. Never commit
`data/google_tokens/`.

---

## Commerce

| Integration | Status | Auth | Provider | Routes | Registry | Setup |
|---|---|---|---|---|---|---|
| Amazon Seller (SP-API) | ✅ | LWA + AWS IAM | `providers/commerce/amazon.py` | `api/routes/domains/commerce.py` | `docs/api_registry/amazon_seller.txt` | L |
| Walmart Marketplace | ⚠️ scaffold | OAuth2 | `providers/commerce/walmart.py` | commerce.py | `docs/api_registry/walmart_seller.txt` | M |
| Shopify (Admin API) | ✅ | OAuth2 + HMAC | `providers/commerce/shopify.py`, `providers/commerce/shopify_auth.py` | `api/routes/auth/shopify_auth.py`, `api/routes/webhooks/shopify_webhooks.py` | `docs/api_registry/shopify_analytics.txt` | L |

Shopify uses HMAC-validated webhooks (`SHOPIFY_WEBHOOK_SECRET`) for order
events and stock counts.

---

## Analytics Platforms

Manual snapshot storage + AI-summary endpoint at
`/api/analytics/{platform}/summary` (gated by `ANALYTICS_AI_ENABLED` —
note: gate not yet wired, see `docs/KNOWN_ISSUES.md`).

| Platform | Status | Registry | Notes |
|---|---|---|---|
| TikTok | ✅ live in route | `docs/api_registry/tiktok_analytics.txt` | Manual snapshot + AI summary |
| Instagram | ✅ | `docs/api_registry/instagram_analytics.txt` | Manual + summary |
| Amazon | ✅ | `docs/api_registry/amazon_seller.txt` | Manual + summary |
| Etsy | ✅ | `docs/api_registry/etsy_analytics.txt` | Manual + summary |
| Facebook | ✅ | `docs/api_registry/facebook_analytics.txt` | Manual + summary |
| YouTube | 🔜 | `docs/api_registry/youtube_analytics.txt` | Setup guide only |
| eBay | 🔜 | `docs/api_registry/ebay_analytics.txt` | Setup guide only |
| Shopify | 🔜 (analytics) | `docs/api_registry/shopify_analytics.txt` | Shopify commerce is live; analytics aggregation not yet wired |
| Pinterest | 🔜 | `docs/api_registry/pinterest_analytics.txt` | Setup guide only |
| Twitter / X | 🔜 | `docs/api_registry/twitter_x_analytics.txt` | Setup guide only |

---

## Information Feeds

| Integration | Status | Auth | Provider | Notes |
|---|---|---|---|---|
| OpenWeatherMap | ✅ | key | `providers/feeds/weather.py` | `WEATHER_API_KEY`; default location via `DEFAULT_LOCATION` |
| NewsAPI.org | ✅ | key | `providers/feeds/news.py` | `NEWS_API_KEY`, free tier |
| Alpha Vantage | ✅ | key | `providers/feeds/stocks.py` | 25 req/day free |
| Finnhub | ✅ | key | `providers/feeds/stocks.py` | 60 req/min free; preferred over Alpha Vantage |
| World News API | ✅ | key | (via news.py) | `WORLD_NEWS_API_KEY` |
| APITube | ✅ | key | (via news.py) | `APITUBE_API_KEY` |
| Mediastack | ✅ | key | (via news.py) | `MEDIASTACK_API_KEY` |
| TheSportsDB | ✅ | key (or "1") | `providers/feeds/sports.py` | Free tier uses literal `"1"` |
| OpenSky (flights) | ✅ | none | `providers/feeds/flights.py` | Free public; needs `LOCATION_LAT/LON` |

The Pulse daemon (`daemons/pulse/pulse.py`) ticks these every 300 s and
records snapshots.

---

## Smart Home

| Integration | Status | Auth | Provider | Routes |
|---|---|---|---|---|
| Home Assistant | ✅ | long-lived token | `providers/smart_home/home_assistant.py` | `api/routes/domains/home.py` |
| Device registry | ✅ | local file | `providers/smart_home/device_registry.py` | home.py |

Google Home Hub integration was previously planned as a kiosk-cast
overlay (Herald daemon). That approach was archived 2026-05-24 to
branch `archive/kiosk-v3`; native device-app development will replace
it. See `docs/KNOWN_ISSUES.md` for context.

---

## Voice / Audio

| Integration | Status | Auth | Provider | Routes |
|---|---|---|---|---|
| Whisper STT (local) | ✅ | none | `providers/stt/whisper_local.py` | `api/routes/ai/conversation.py` |
| Piper TTS (local) | ✅ | none | `providers/tts/piper.py` | conversation.py |
| Kokoro TTS (local) | ✅ | none | `providers/tts/kokoro_provider.py` | conversation.py |
| ElevenLabs TTS (cloud) | ✅ | key | `providers/tts/elevenlabs.py` | conversation.py |
| Chatterbox (local clone) | ✅ | none | `providers/tts/chatterbox_provider.py` | conversation.py |
| Voice ID (Resemblyzer) | ✅ | none | `providers/voice_id/voice_id_provider.py` | `api/routes/auth/voice_id.py` |
| openWakeWord | ✅ | none | `core/wake_word_service.py` | conversation.py |

See `docs/VOICE_ID.md` for the Voice ID enrollment + verification flow.

---

## Image / Vision

| Integration | Status | Provider | Routes | Notes |
|---|---|---|---|---|
| Stable Diffusion (A1111 API) | ✅ | `providers/image/sd_provider.py` | `api/routes/ai/image.py` | On-demand via `SD_ON_DEMAND` to save VRAM |
| Vision (Ollama moondream) | ✅ | `providers/llm/vision_provider.py` | `api/routes/feeds/vision.py` | `VISION_MODEL=moondream` |

---

## Memory / RAG

| System | Status | File | Notes |
|---|---|---|---|
| SQLite (canonical store) | ✅ | `providers/memory/sqlite_store.py` | `DB_PATH` |
| Embedding (Ollama nomic-embed-text) | ✅ | `providers/memory/embedding_provider.py` | `EMBEDDING_MODEL` |
| Vector store (ChromaDB) | ✅ | `providers/memory/vector_store.py` | `CHROMA_PATH` |
| TTL engine | ✅ | `providers/memory/ttl_engine.py` | `MEMORY_DEFAULT_TTL`, `MEMORY_AUTO_EXTEND` |
| RAG (document Q&A) | ✅ | `providers/rag/rag_provider.py`, `providers/rag/chunker.py` | `RAG_CHUNK_SIZE=512`, `RAG_CHUNK_OVERLAP=64`, `RAG_TOP_K=5` |

---

## Web Search

| Integration | Status | Auth | Provider | Setup |
|---|---|---|---|---|
| Brave Search | ✅ | key | `providers/web/search.py` | `BRAVE_SEARCH_API_KEY` |
| SearXNG (self-hosted) | ✅ | none | `providers/web/search.py` | `SEARXNG_BASE_URL` |
| Tavily | ✅ | key | `providers/web/search.py` | `TAVILY_API_KEY` — free 1k/month |
| Google PSE | ✅ | key + cx | `providers/web/search.py` | `GOOGLE_PSE_API_KEY` + `GOOGLE_PSE_CX` |
| TinyFish | ✅ | key | `providers/web/search.py` | `TINYFISH_API_KEY` — free 5/min |

---

## Reading

| Integration | Status | Auth | Provider | Setup |
|---|---|---|---|---|
| Audible | ✅ | per-user auth file | `providers/reading/audible.py` | `python -m providers.reading.audible --setup --user-id <id>` |
| Libby / OverDrive | ✅ | per-user chip | `providers/reading/libby.py` | `python -m providers.reading.libby --setup --user-id <id>` |
| Kindle | ⚠️ scaffold | TBD | `providers/reading/kindle.py` | Manual sync |
| Google Books | ✅ | OAuth (via Google auth) | `providers/google/books.py` | Same as Google suite |

---

## Push / Broadcast

| Integration | Status | File | Setup |
|---|---|---|---|
| Web Push (VAPID) | ✅ | `providers/push/sender.py`, `api/routes/webhooks/push.py` | `PUSH_NOTIFICATIONS_ENABLED=true` + VAPID keys |

See `docs/PUSH_NOTIFICATIONS.md`. The internal broadcast WebSocket
(`/api/broadcast/*`) was removed with the kiosk archive — its only
consumer was Herald lip-sync.

---

## Automation / Orchestration

| Integration | Status | File | Setup |
|---|---|---|---|
| n8n | ✅ | `providers/automation/n8n_client.py`, `api/routes/webhooks/n8n_webhooks.py` | `N8N_ENABLED=true`, URL + API key + webhook secret |

---

## Telemetry / Robotics

| Integration | Status | File | Setup |
|---|---|---|---|
| MAVLink / ArduRover | ✅ (daemon) | `daemons/mechanic/mechanic.py`, `api/routes/fleet/rover.py` | `MECHANIC_ENABLED=true`, serial port + baud |
| Vision (YOLO + RTSP cameras) | 🔜 | `daemons/warden/warden.py` (stub) | Scaffolded settings only |

---

## How to add a new integration

1. Read the matching `docs/api_registry/<service>.txt` (if one exists) and
   add a new file to that directory if not.
2. Add settings (key, enable flag, any URLs) to `config/settings.py` and
   `.env.example`.
3. Implement the provider under `providers/<category>/<service>.py`.
4. Expose endpoints under `api/routes/<feature>.py` and register the
   router in `api/routes/__init__.py` + `main.py`.
5. Add a row to this file.
