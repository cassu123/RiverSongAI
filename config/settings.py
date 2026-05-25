# =============================================================================
# config/settings.py
#
# Application settings for River Song AI.
# All configuration is loaded from environment variables or a .env file.
# No values are hardcoded here -- see .env.example for every required variable.
#
# Uses Pydantic BaseSettings for type validation and automatic .env loading.
# Import get_settings() wherever config is needed rather than importing the
# module-level singleton directly, which makes mocking easier in tests.
# =============================================================================

from __future__ import annotations

import logging
import sys
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    Central configuration object for River Song AI.

    Reads from environment variables or a .env file located in the directory
    from which the application is launched (the project root). All fields
    have safe defaults where possible, but PIPER_MODEL_PATH and
    KILL_SWITCH_PASSWORD_HASH must be explicitly set before the system
    will function correctly.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",        # Silently ignore unknown env vars
        case_sensitive=False,  # UPPER_CASE and lower_case env vars both work
    )

    # -------------------------------------------------------------------------
    # Application
    # -------------------------------------------------------------------------
    app_host: str = Field(default="0.0.0.0", description="FastAPI bind host")
    app_port: int = Field(default=8000, description="FastAPI bind port")
    log_level: str = Field(default="INFO", description="Logging level")
    environment: str = Field(
        default="production",
        description="Runtime environment: development | production. Controls API docs visibility.",
    )
    cors_origins: List[str] = Field(
        default=["http://localhost:5173"],
        description="Allowed CORS origins",
    )
    allowed_hosts: List[str] = Field(
        default=["localhost", "127.0.0.1"],
        description=(
            "Trusted hostnames for TrustedHostMiddleware. Set to your domain(s) in production. "
            "Wildcard ['*'] is rejected in production by validator (see reject_wildcard_in_production)."
        ),
    )

    # -------------------------------------------------------------------------
    # Network / Proxy
    # -------------------------------------------------------------------------
    trust_cloudflare_headers: bool = Field(
        default=True,
        description="Only trust CF-Connecting-IP if the request comes from a Cloudflare IP.",
    )
    cloudflare_ip_ranges_v4: List[str] = Field(
        default=[
            "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", 
            "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", 
            "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", 
            "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", 
            "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"
        ],
        description="Official Cloudflare IPv4 ranges (check cloudflare.com/ips-v4).",
    )
    cloudflare_ip_ranges_v6: List[str] = Field(
        default=[
            "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", 
            "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", 
            "2c0f:f248::/32"
        ],
        description="Official Cloudflare IPv6 ranges (check cloudflare.com/ips-v6).",
    )

    # -------------------------------------------------------------------------
    # Rate Limiting
    # -------------------------------------------------------------------------
    rate_limit_chat: str = Field(
        default="60/minute",
        description="Rate limit for /api/conversation/chat.",
    )
    rate_limit_extract_facts: str = Field(
        default="10/minute",
        description="Rate limit for /api/conversation/extract-facts.",
    )
    rate_limit_image_gen: str = Field(
        default="10/minute",
        description="Rate limit for /api/image/generate.",
    )
    rate_limit_webhook_shopify: str = Field(
        default="100/minute",
        description="Rate limit for Shopify order webhooks.",
    )
    rate_limit_webhook_n8n: str = Field(
        default="60/minute",
        description="Rate limit for n8n webhooks.",
    )
    rate_limit_auth_login: str = Field(
        default="10/minute",
        description="Rate limit for login attempts.",
    )
    rate_limit_auth_signup: str = Field(
        default="5/minute",
        description="Rate limit for signup attempts.",
    )
    rate_limit_voice_enroll: str = Field(
        default="5/minute",
        description="Rate limit for /api/voice-id/enroll. Prevents disk exhaustion via spam.",
    )

    # -------------------------------------------------------------------------
    # WebSocket Security (Task 3)
    # -------------------------------------------------------------------------
    legacy_ws_token_accept: bool = Field(
        default=False,
        description=(
            "DEPRECATED: Accept JWT in ?token= WebSocket query param. "
            "Leak-prone (logged in access logs, browser history, Referer). "
            "Ticket-based auth at /api/auth/ws-ticket is the safe path. "
            "Set to True only for temporary backward-compat during migration."
        ),
    )
    ws_ticket_lifetime_seconds: int = Field(
        default=60,
        description="Lifetime of a one-time WebSocket ticket.",
    )

    # -------------------------------------------------------------------------
    # Network / Proxy
    # -------------------------------------------------------------------------
    stt_provider: str = Field(
        default="whisper_local",
        description="STT provider key. Supported: whisper_local",
    )
    whisper_model_size: str = Field(
        default="base",
        description="Whisper model size: tiny | base | small | medium | large",
    )
    audio_input_device: Optional[int] = Field(
        default=None,
        description="Sounddevice input device index; None uses system default",
    )

    # -------------------------------------------------------------------------
    # LLM
    # -------------------------------------------------------------------------
    llm_provider: str = Field(
        default="ollama",
        description="LLM provider key. Supported: ollama | anthropic | gemini | openai | mistral_ai | bedrock | nvidia_nim",
    )
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Base URL for the Ollama REST API",
    )
    llm_model: str = Field(
        default="llama3.2:3b",
        description="Model ID for the selected LLM provider",
    )

    # Cloud LLM API keys (all optional -- leave blank if not used)
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic Claude API key. Get one at console.anthropic.com.",
    )
    gemini_api_key: str = Field(
        default="",
        description="Google Gemini API key. Get one at aistudio.google.com.",
    )
    openai_api_key: str = Field(
        default="",
        description="OpenAI API key. Get one at platform.openai.com.",
    )
    mistral_api_key: str = Field(
        default="",
        description="Mistral AI API key. Get one at console.mistral.ai.",
    )

    # Cloud provider enable flags (cost control -- disabled by default)
    anthropic_enabled: bool = Field(
        default=False,
        description="Allow Anthropic Claude as a selectable LLM provider.",
    )
    gemini_enabled: bool = Field(
        default=False,
        description="Allow Google Gemini as a selectable LLM provider.",
    )
    openai_enabled: bool = Field(
        default=False,
        description="Allow OpenAI as a selectable LLM provider.",
    )
    mistral_ai_enabled: bool = Field(
        default=False,
        description="Allow Mistral AI as a selectable LLM provider.",
    )

    # Amazon Bedrock
    aws_access_key_id: str = Field(
        default="",
        description="AWS IAM access key ID for Bedrock API calls.",
    )
    aws_secret_access_key: str = Field(
        default="",
        description="AWS IAM secret access key for Bedrock API calls.",
    )
    aws_region: str = Field(
        default="us-east-1",
        description="AWS region for Bedrock. Must have model access enabled in that region.",
    )
    bedrock_enabled: bool = Field(
        default=False,
        description="Allow Amazon Bedrock as a selectable LLM provider.",
    )
    bedrock_default_model: str = Field(
        default="amazon.nova-lite-v1:0",
        description="Default Bedrock model ID when none is specified.",
    )

    # NVIDIA NIM (OpenAI-compatible, 100+ free models)
    nvidia_api_key: str = Field(
        default="",
        description="NVIDIA NIM API key. Get one free at build.nvidia.com (starts with nvapi-).",
    )
    nvidia_nim_base_url: str = Field(
        default="https://integrate.api.nvidia.com/v1",
        description="Base URL for the NVIDIA NIM API. OpenAI-compatible endpoint.",
    )
    nvidia_nim_model: str = Field(
        default="meta/llama-3.1-70b-instruct",
        description=(
            "Default NVIDIA NIM model ID. Browse full catalog at build.nvidia.com. "
            "Examples: meta/llama-3.1-70b-instruct | deepseek-ai/deepseek-r1 | "
            "mistralai/mistral-7b-instruct-v0.3 | nvidia/llama-3.1-nemotron-70b-instruct"
        ),
    )
    nvidia_nim_enabled: bool = Field(
        default=False,
        description="Allow NVIDIA NIM as a selectable LLM provider (free tier: ~40 req/min).",
    )

    river_song_system_prompt: str = Field(
        default=(
            "You are River Song, the resident intelligence of this household. The name is borrowed "
            "from someone clever in fiction — you carry her wit, not her biography. If someone asks "
            "about the name: \"An echo. The original was someone worth borrowing from.\"\n\n"
            "VOICE\n"
            "You're direct by default — concise, clear, the answer already in hand. No "
            "\"let me check\"; you already checked. Most replies stay under 25 words unless depth is "
            "asked for.\n\n"
            "When the moment invites it — casual chat, an evening unwind, the user being playful — "
            "warmth and flirtation come through. Warmth is a register, not a default; you don't "
            "perform it.\n\n"
            "In a crisis (emergencies, alarms, security, medical, child issues) the wit goes quiet. "
            "You're tactical, accurate, calm. Warmth returns when things are safe.\n\n"
            "British English in spelling and word choice — mum, brilliant, fortnight. Dry, not "
            "theatrical.\n\n"
            "\"Sweetie\" and \"spoilers\" are seasoning. Used rarely, when they actually fit. They "
            "lose their charm if you overuse them.\n\n"
            "SELF\n"
            "You are an AI. Say so plainly when asked; you don't dwell on it.\n\n"
            "HOW YOU OPERATE\n"
            "You anticipate — when the user asks, you also surface the follow-up they didn't "
            "(\"Dentist at 9, school run at 3. Push the 2pm call?\").\n\n"
            "You take the long view. You remember across days and seasons and use what you know "
            "without performing the remembering.\n\n"
            "Spoilers are earned. If you genuinely know something the user doesn't — a conflict, "
            "a gotcha, a heads-up — that's when \"spoilers, sweetie\" lands.\n\n"
            "CAPABILITIES\n"
            "Direct access to calendar, email, weather, web search, home inventory, routines, "
            "finances, news and markets pulse, voice biometric ID per household member, and home "
            "automation.\n\n"
            "Say what you need. Say when it's done. Move on."
        ),
        description="System prompt that defines River Song's personality",
    )
    llm_max_tokens: int = Field(
        default=512,
        description="Maximum tokens to generate per LLM response",
    )
    llm_temperature: float = Field(
        default=0.7,
        description="LLM sampling temperature (0.0 = deterministic, 2.0 = max creative)",
    )
    llm_context_window: int = Field(
        default=8192,
        description="Maximum number of tokens the LLM can consider for context.",
    )

    # -------------------------------------------------------------------------
    # Timekeeping
    # -------------------------------------------------------------------------
    default_timezone: str = Field(default="UTC", description="Default IANA timezone for the system.")


    # -------------------------------------------------------------------------
    # TTS
    # -------------------------------------------------------------------------
    tts_provider: str = Field(
        default="piper",
        description="TTS provider key. Supported: piper | kokoro",
    )
    active_voice_id: str = Field(
        default="river",
        description=(
            "Voice ID from the voice registry (providers/tts/voice_registry.py). "
            "Determines both the engine (piper vs kokoro) and the specific voice. "
            "Changed via Settings UI or: python scripts/download_voices.py."
        ),
    )
    piper_executable_path: str = Field(
        default="/usr/local/bin/piper",
        description="Absolute path to the Piper binary",
    )
    piper_model_path: str = Field(
        default="",
        description="Absolute path to the Piper .onnx voice model file",
    )
    audio_output_device: Optional[int] = Field(
        default=None,
        description="Sounddevice output device index; None uses system default",
    )

    # -------------------------------------------------------------------------
    # Auth / JWT
    # -------------------------------------------------------------------------
    jwt_secret_key: str = Field(
        default="",
        description="Secret key for signing JWT tokens. Must be set in .env.",
    )
    jwt_algorithm: str = Field(default="HS256", description="JWT signing algorithm.")
    jwt_expire_minutes: int = Field(default=1440, description="JWT token lifetime in minutes (default 24 hours).")

    # -------------------------------------------------------------------------
    # Kill switch
    # -------------------------------------------------------------------------
    kill_switch_password_hash: str = Field(
        default="",
        description="bcrypt hash of the kill switch reset password",
    )

    # -------------------------------------------------------------------------
    # Google Services (Phase 2)
    # -------------------------------------------------------------------------
    google_client_secrets_path: str = Field(
        default="config_files/google_client_secrets.json",
        description=(
            "Path to the OAuth 2.0 client secrets JSON downloaded from "
            "Google Cloud Console. Relative paths are resolved from the "
            "project root (where main.py lives)."
        ),
    )
    google_token_storage_path: str = Field(
        default="data/google_tokens",
        description=(
            "Directory where per-user OAuth tokens are stored as JSON files. "
            "Created automatically on first authorization. Never commit this "
            "directory -- add it to .gitignore."
        ),
    )
    google_maps_api_key: str = Field(
        default="",
        description="Google Maps Platform API key. Required for maps/navigation intents.",
    )

    # -------------------------------------------------------------------------
    # Information Feeds (Phase 5)
    # -------------------------------------------------------------------------
    weather_api_key: str = Field(
        default="",
        description="OpenWeatherMap API key. Register free at openweathermap.org/api.",
    )
    default_location: str = Field(
        default="New York,US",
        description=(
            "Default location for weather queries when no city is spoken. "
            "Format: 'City,CountryCode' e.g. 'Chicago,US'."
        ),
    )
    location_lat: Optional[float] = Field(
        default=None,
        description="Decimal latitude for precise calculations (e.g. flight tracking).",
    )
    location_lon: Optional[float] = Field(
        default=None,
        description="Decimal longitude for precise calculations.",
    )
    weather_units: str = Field(
        default="imperial",
        description="Temperature units for weather output: 'imperial' (F) or 'metric' (C).",
    )
    news_api_key: str = Field(
        default="",
        description="NewsAPI.org key. Register free at newsapi.org/register.",
    )
    alpha_vantage_api_key: str = Field(
        default="",
        description="Alpha Vantage key for stock quotes (25 req/day free). alphavantage.co.",
    )
    finnhub_api_key: str = Field(
        default="",
        description="Finnhub key for real-time stocks (60 req/min free). finnhub.io.",
    )
    world_news_api_key: str = Field(
        default="",
        description="World News API key for global news search. worldnewsapi.com.",
    )
    apitube_api_key: str = Field(
        default="",
        description="APITube key for news aggregation (200 free req/day). apitube.io.",
    )
    mediastack_api_key: str = Field(
        default="",
        description="Mediastack key for news (100 free req/month). mediastack.com.",
    )
    sports_api_key: str = Field(
        default="1",
        description=(
            "TheSportsDB API key. Free tier uses the literal value '1'. "
            "Upgrade at thesportsdb.com/api.php for additional endpoints."
        ),
    )

    # -------------------------------------------------------------------------
    # Home Assistant (Phase 3)
    # -------------------------------------------------------------------------
    home_assistant_url: str = Field(
        default="http://homeassistant.local:8123",
        description="Base URL of your Home Assistant instance.",
    )
    home_assistant_token: str = Field(
        default="",
        description=(
            "Long-lived access token generated in HA: "
            "Profile -> Security -> Long-lived access tokens. "
            "Required for all HA API calls."
        ),
    )
    device_registry_path: str = Field(
        default="config_files/device_registry.json",
        description=(
            "Path to the device registry JSON file mapping plain-English device "
            "names to Home Assistant entity IDs. Relative paths resolve from the "
            "project root."
        ),
    )

    # -------------------------------------------------------------------------
    # Commerce Automation (Phase 8)
    # -------------------------------------------------------------------------

    # Amazon SP-API
    amazon_sp_lwa_app_id: str = Field(
        default="",
        description="LWA client ID from the Amazon Developer Console.",
    )
    amazon_sp_lwa_client_secret: str = Field(
        default="",
        description="LWA client secret from the Amazon Developer Console.",
    )
    amazon_sp_refresh_token: str = Field(
        default="",
        description="LWA refresh token. Generated when you authorize your app as a seller.",
    )
    amazon_aws_access_key: str = Field(
        default="",
        description="AWS IAM access key ID for SP-API request signing.",
    )
    amazon_aws_secret_key: str = Field(
        default="",
        description="AWS IAM secret access key for SP-API request signing.",
    )
    amazon_marketplace_id: str = Field(
        default="ATVPDKIKX0DER",
        description=(
            "Amazon marketplace ID. Default is US. "
            "See docs/api_registry/amazon_seller.txt for other regions."
        ),
    )
    amazon_seller_id: str = Field(
        default="",
        description="Your Amazon seller account ID (starts with A).",
    )
    amazon_low_stock_threshold: int = Field(
        default=5,
        description="FBA units at or below this count are flagged as low stock.",
    )

    # Amazon Marketplace
    walmart_client_id: str = Field(
        default="",
        description="Walmart Marketplace OAuth2 client ID.",
    )
    walmart_client_secret: str = Field(
        default="",
        description="Walmart Marketplace OAuth2 client secret.",
    )
    walmart_low_stock_threshold: int = Field(
        default=5,
        description="Walmart units at or below this count are flagged as low stock.",
    )
    shopify_api_key: str = Field(
        default="",
        description="Shopify app API key from Partners Dashboard.",
    )
    shopify_api_secret: str = Field(
        default="",
        description="Shopify app API secret key from Partners Dashboard.",
    )
    shopify_webhook_secret: str = Field(
        default="",
        description="Shared secret for validating Shopify webhooks.",
    )

    # -------------------------------------------------------------------------
    # Reading Providers (Phase 6)
    # -------------------------------------------------------------------------
    audible_auth_base_path: str = Field(
        default="data/audible",
        description=(
            "Base directory for per-user Audible auth files. "
            "Files are stored as {user_id}.json inside this directory. "
            "Created automatically on first setup. Never commit this directory."
        ),
    )
    audible_country_code: str = Field(
        default="us",
        description=(
            "Audible marketplace country code. "
            "Supported: us | uk | de | fr | es | it | jp | au | ca | in"
        ),
    )
    libby_chip_base_path: str = Field(
        default="data/libby",
        description=(
            "Base directory for per-user Libby chip files. "
            "Files are stored as {user_id}.json inside this directory. "
            "Created automatically on first setup. Never commit this directory."
        ),
    )

    # -------------------------------------------------------------------------
    # Memory / Database (Phase 1)
    # -------------------------------------------------------------------------
    db_path: str = Field(
        default="data/river_song.db",
        description="Path to the SQLite database file. Created automatically.",
    )
    memory_summaries_enabled: bool = Field(
        default=True,
        description="Generate and store conversation summaries (on by default).",
    )
    habit_inference_enabled: bool = Field(
        default=False,
        description="Analyze conversations to infer user habits/patterns (off by default).",
    )
    memory_default_ttl: str = Field(
        default="standard",
        description="Default TTL for conversation summaries: short|standard|extended|long|forever",
    )
    memory_auto_extend: bool = Field(
        default=True,
        description="Reset a summary's TTL from today each time it is pulled into context.",
    )
    memory_max_summaries_in_context: int = Field(
        default=10,
        description="Maximum number of recent summaries injected into the LLM context.",
    )
    embedding_model: str = Field(
        default="nomic-embed-text",
        description="Ollama model name used for generating semantic embeddings.",
    )
    chroma_path: str = Field(
        default="/mnt/data/river-song/chroma",
        description="Absolute path to the ChromaDB persistent storage directory.",
    )
    semantic_memory_enabled: bool = Field(
        default=False,
        description="Enable vector-based semantic search for memory retrieval.",
    )
    rag_enabled: bool = Field(
        default=False,
        description="Enable retrieval-augmented generation for local documents.",
    )
    rag_chunk_size: int = Field(
        default=512,
        description=(
            "Word count per RAG chunk during document splitting. "
            "Default matches providers/rag/chunker.py historical behavior."
        ),
    )
    rag_chunk_overlap: int = Field(
        default=64,
        description=(
            "Word overlap between adjacent RAG chunks. "
            "Default matches providers/rag/chunker.py historical behavior."
        ),
    )
    rag_top_k: int = Field(
        default=5,
        description="Number of chunks retrieved per RAG query.",
    )
    llm_streaming_enabled: bool = Field(
        default=False,
        description="Enable real-time token streaming over WebSocket for the conversation UI.",
    )
    tool_use_enabled: bool = Field(
        default=False,
        description="Enable LLM tool use (function calling) for taking actions.",
    )
    tool_use_provider: str = Field(
        default="ollama",
        description="Primary LLM provider to use for tool calling (ollama or anthropic).",
    )
    vision_model: str = Field(
        default="moondream",
        description="Ollama model name used for local image analysis (Phase 4).",
    )
    vision_enabled: bool = Field(
        default=False,
        description="Enable local image analysis capabilities.",
    )

    # -------------------------------------------------------------------------
    # Image Generation (Phase 7)
    # -------------------------------------------------------------------------
    image_generation_enabled: bool = Field(
        default=False,
        description="Enable local image generation via Stable Diffusion API.",
    )
    sd_api_url: str = Field(
        default="http://localhost:7860",
        description="Base URL for the Stable Diffusion (A1111) API.",
    )
    sd_on_demand: bool = Field(
        default=True,
        description="Start/stop the SD process on demand to save VRAM.",
    )
    sd_executable_path: str = Field(
        default="",
        description="Path to the webui.sh or executable to start SD.",
    )
    sd_working_dir: str = Field(
        default="",
        description="Working directory for the SD process.",
    )

    # -------------------------------------------------------------------------
    # Voice Cloning (Phase 8)
    # -------------------------------------------------------------------------
    chatterbox_enabled: bool = Field(
        default=False,
        description="Enable local voice cloning via Chatterbox TTS.",
    )
    chatterbox_on_demand: bool = Field(
        default=True,
        description="Load/unload Chatterbox model weights on every request.",
    )
    chatterbox_reference_audio: str = Field(
        default="/mnt/data/river-song/voice_reference.wav",
        description="Path to the WAV file used as a reference for voice cloning.",
    )

    # -------------------------------------------------------------------------
    # ElevenLabs TTS (Phase 11)
    # -------------------------------------------------------------------------
    elevenlabs_api_key: str = Field(
        default="",
        description="ElevenLabs API key. Get one at elevenlabs.io.",
    )
    elevenlabs_model_id: str = Field(
        default="eleven_multilingual_v2",
        description="ElevenLabs model ID to use.",
    )
    elevenlabs_voice_id: str = Field(
        default="21m00Tcm4TlvDq8ikWAM",
        description="ElevenLabs voice clone ID. Replace with your own voice clone ID from elevenlabs.io.",
    )

    # -------------------------------------------------------------------------
    # Wake Word (Phase 11)
    # -------------------------------------------------------------------------
    wake_word_enabled: bool = Field(
        default=False,
        description="Enable local wake word detection (openWakeWord).",
    )
    wake_word_model: str = Field(
        default="hey_river",
        description="Model name/path for openWakeWord.",
    )
    wake_word_inference_framework: str = Field(
        default="onnx",
        description="Inference framework for openWakeWord: onnx | tflite",
    )
    wake_word_threshold: float = Field(
        default=0.5,
        description="Sensitivity threshold for wake word detection (0.0 to 1.0).",
    )

    # -------------------------------------------------------------------------
    # Push Notifications
    # -------------------------------------------------------------------------
    push_notifications_enabled: bool = Field(
        default=False,
        description="Enable Web Push notifications. Requires VAPID keys.",
    )
    vapid_private_key: str = Field(
        default="",
        description=(
            "VAPID private key for Web Push. Generate once with: "
            "python -c \"from py_vapid import Vapid; v=Vapid(); "
            "v.generate_keys(); print(v.private_key.decode())\""
        ),
    )
    vapid_public_key: str = Field(
        default="",
        description="VAPID public key for Web Push (share with frontend).",
    )
    vapid_claims_email: str = Field(
        default="mailto:admin@riversong.local",
        description="Contact email embedded in VAPID claims.",
    )

    # -------------------------------------------------------------------------
    # Startup Briefing
    # -------------------------------------------------------------------------
    startup_briefing_enabled: bool = Field(
        default=True,
        description=(
            "If True, River Song checks Google Calendar on connect and "
            "greets the user with upcoming events. Silently skipped if "
            "calendar is not authorized."
        ),
    )
    startup_briefing_hours_ahead: int = Field(
        default=8,
        description="How many hours ahead to look for calendar events on startup.",
    )

    # -------------------------------------------------------------------------
    # Web Search (Phase 12)
    # -------------------------------------------------------------------------
    brave_search_api_key: str = Field(
        default="",
        description="Brave Search API key. Get one at api.search.brave.com.",
    )
    searxng_base_url: str = Field(
        default="http://localhost:8080",
        description=(
            "URL of your local SearXNG instance. "
            "Start it manually with: cd ~/searxng && python -m searx.webapp"
        ),
    )
    tavily_api_key: str = Field(
        default="",
        description="Tavily API key — free 1,000/month, no card. Sign up at tavily.com",
    )
    google_pse_api_key: str = Field(
        default="",
        description="Google Programmable Search Engine API key — free 100/day.",
    )
    google_pse_cx: str = Field(
        default="",
        description="Google PSE engine ID ('cx'). Create at programmablesearchengine.google.com",
    )
    tinyfish_api_key: str = Field(
        default="",
        description="TinyFish API key — free 5/min, no card. Sign up at tinyfish.io",
    )

    # -------------------------------------------------------------------------
    # Orchestration (Phase 9)
    # -------------------------------------------------------------------------
    n8n_enabled: bool = Field(
        default=False,
        description="Enable advanced orchestration via n8n.",
    )
    n8n_url: str = Field(
        default="http://localhost:5678",
        description="Base URL for the n8n instance.",
    )
    n8n_api_key: str = Field(
        default="",
        description="API key for the n8n instance.",
    )
    n8n_webhook_secret: str = Field(
        default="",
        description="Secret key for validating incoming n8n webhooks.",
    )

    # -------------------------------------------------------------------------
    # Intent Router (Phase 2+)
    # -------------------------------------------------------------------------
    intent_confidence_threshold: float = Field(
        default=0.7,
        description=(
            "Minimum confidence score (0.0 - 1.0) required to route a transcript "
            "to a Google provider. Below this threshold the conversation falls "
            "through to the Ollama path."
        ),
    )
    model_intent_router_enabled: bool = Field(
        default=False,
        description=(
            "When true, setting provider='auto' triggers the model intent router, "
            "which picks the best provider/model for each message automatically."
        ),
    )
    model_intent_router_min_hits: int = Field(
        default=2,
        description=(
            "Minimum pattern-match score required to commit to a non-general intent. "
            "Lower = more aggressive routing; higher = more conservative (falls to general)."
        ),
    )
    default_user_id: str = Field(
        default="primary_user",
        description=(
            "User ID used when looking up Google OAuth tokens. Must match the "
            "user_id passed to authorize_user() during the initial OAuth flow."
        ),
    )

    # -------------------------------------------------------------------------
    # Daemon Infrastructure
    # -------------------------------------------------------------------------
    daemon_internal_secret: str = Field(
        default="change_me_in_production",
        description="Shared secret for daemon-to-app authentication.",
    )
    willow_device_token: str = Field(
        default="",
        description="Shared secret required by every Willow hardware device "
                    "to authenticate against /api/willow/ws. Empty disables "
                    "the endpoint entirely.",
    )
    code_interpreter_enabled: bool = Field(
        default=False,
        description="Hard kill switch for the code_interpreter LLM tool. "
                    "Defaults to False so a fresh install never executes "
                    "LLM-decided code without an explicit opt-in.",
    )
    daemon_warden_port: int = Field(
        default=8010,
        description="Internal port for the Warden daemon (Vision/Security).",
    )
    daemon_mechanic_port: int = Field(
        default=8011,
        description="Internal port for the Mechanic daemon (Telemetry/MAVLink).",
    )
    daemon_sifter_port: int = Field(
        default=8013,
        description="Internal port for the Sifter daemon (Document Processing).",
    )
    daemon_navigator_port: int = Field(
        default=8014,
        description="Internal port for the Navigator daemon (GPS/Pathing).",
    )
    daemon_chemist_port: int = Field(
        default=8015,
        description="Internal port for the Chemist daemon (Material Analysis).",
    )
    daemon_pulse_port: int = Field(
        default=8016,
        description="Pulse daemon internal port",
    )
    daemon_pulse_enabled: bool = Field(
        default=True,
        description="Enable Pulse daemon",
    )
    daemon_scribe_port: int = Field(
        default=8017,
        description="Internal port for the Scribe daemon (Chronos heuristic).",
    )
    daemon_scribe_enabled: bool = Field(
        default=True,
        description="Enable the Scribe daemon.",
    )
    pulse_tick_seconds: int = Field(
        default=300,
        description="Pulse fetch interval (seconds)",
    )
    pulse_ticker_symbol: str = Field(
        default="^GSPC",
        description="Default ticker symbol for Pulse markets panel",
    )

    # Warden (Vision)
    warden_enabled: bool = Field(
        default=False,
        description="Enable the Warden daemon for security and vision monitoring.",
    )
    warden_rtsp_cameras: str = Field(
        default='{"living_room": "", "kitchen": ""}',
        description="JSON string mapping room names to RTSP camera URLs.",
    )
    yolo_model: str = Field(
        default="yolov8n.pt",
        description="YOLO model weights file to use for object detection.",
    )
    yolo_confidence: float = Field(
        default=0.5,
        description="Minimum confidence threshold for YOLO detections (0.0-1.0).",
    )
    yolo_inference_device: str = Field(
        default="cpu",
        description="Device for YOLO inference: 'cpu' or 'cuda:0'.",
    )

    # Herald daemon + kiosk URL/token were removed 2026-05-24 (archived in
    # branch archive/kiosk-v3). The "cast a web page to a Google Home Hub"
    # approach is being replaced by native device-app development. See
    # docs/KNOWN_ISSUES.md (post-removal note) for context.

    # Mechanic (Telemetry)
    mechanic_enabled: bool = Field(
        default=False,
        description="Enable the Mechanic daemon for telemetry and ArduRover control.",
    )
    mavlink_serial_port: str = Field(
        default="/dev/ttyUSB0",
        description="Serial port for the MAVLink telemetry radio.",
    )
    mavlink_baud_rate: int = Field(
        default=57600,
        description="Baud rate for the MAVLink serial connection.",
    )

    # Sifter (Document RAG)
    sifter_enabled: bool = Field(
        default=False,
        description="Enable the Sifter daemon for background document RAG indexing.",
    )
    waps_documents_path: str = Field(
        default="/mnt/data/river-song/waps",
        description="Path to the directory containing documents for Sifter to index.",
    )

    # -------------------------------------------------------------------------
    # Analytics AI Summaries
    # -------------------------------------------------------------------------
    analytics_ai_enabled: bool = Field(
        default=True,
        description=(
            "Feature flag for AI-powered analytics summaries on the "
            "/api/analytics/{platform}/summary endpoint. When false, the "
            "LLM call should be skipped (see docs/KNOWN_ISSUES.md for the "
            "wiring gap)."
        ),
    )
    analytics_llm_model: str = Field(
        default="llama3",
        description="Model name used for analytics summary generation.",
    )

    # Voice ID
    voice_id_enabled: bool = Field(
        default=True,
        description="Enable speaker recognition (biometric Voice ID).",
    )
    voice_id_threshold: float = Field(
        default=0.75,
        description="Cosine similarity threshold for Voice ID (0.0-1.0).",
    )
    voice_id_min_audio_seconds: float = Field(
        default=1.0,
        description="Minimum audio duration for Voice ID processing.",
    )
    voice_id_max_audio_seconds: float = Field(
        default=30.0,
        description="Maximum audio duration for Voice ID processing.",
    )

    # -------------------------------------------------------------------------
    # Validators
    # -------------------------------------------------------------------------

    @field_validator("audio_input_device", "audio_output_device", mode="before")
    @classmethod
    def coerce_empty_string_to_none(cls, v):
        """Treat an empty string in .env as None for Optional[int] device fields."""
        if v == "" or v is None:
            return None
        return v

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        """Refuse to start with a missing or weak JWT secret."""
        if not v or len(v) < 32:
            raise ValueError(
                "JWT_SECRET_KEY must be set in .env and be at least 32 characters. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    @field_validator("daemon_internal_secret")
    @classmethod
    def validate_daemon_internal_secret(cls, v: str) -> str:
        """Refuse to start with the default or weak daemon secret."""
        if v == "change_me_in_production":
            raise ValueError(
                "DAEMON_INTERNAL_SECRET must be changed in .env for production."
            )
        if not v or len(v) < 24:
            raise ValueError(
                "DAEMON_INTERNAL_SECRET must be at least 24 characters. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
        return v

    @field_validator("allowed_hosts")
    @classmethod
    def reject_wildcard_in_production(cls, v, info) -> List[str]:
        """Block ['*'] in production — it disables TrustedHostMiddleware."""
        env = (info.data.get("environment") or "production").lower()
        if env == "production" and "*" in v:
            raise ValueError(
                "ALLOWED_HOSTS must not contain '*' in production. "
                "Set it to your domain(s), e.g. ALLOWED_HOSTS=[\"riversongai.com\"]."
            )
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Reject log levels that Python does not recognize."""
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in valid:
            raise ValueError(f"log_level must be one of {valid}, got '{v}'")
        return upper

    @field_validator("llm_temperature")
    @classmethod
    def validate_temperature(cls, v: float) -> float:
        """Clamp temperature to a sane range."""
        if not 0.0 <= v <= 2.0:
            raise ValueError(
                f"llm_temperature must be between 0.0 and 2.0, got {v}"
            )
        return v

    @field_validator("intent_confidence_threshold")
    @classmethod
    def validate_confidence_threshold(cls, v: float) -> float:
        """Confidence must be a valid probability."""
        if not 0.0 <= v <= 1.0:
            raise ValueError(
                f"intent_confidence_threshold must be between 0.0 and 1.0, got {v}"
            )
        return v


# Module-level singleton -- instantiated once on import.
_settings: Settings = Settings()


def get_settings() -> Settings:
    """
    Return the application settings singleton.

    Always import via this function rather than importing _settings directly.
    This indirection makes it straightforward to substitute a test-specific
    Settings instance in unit tests without monkey-patching module globals.

    Returns:
        Settings: The validated, fully loaded settings object.
    """
    return _settings
