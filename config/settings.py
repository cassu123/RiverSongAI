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
    cors_origins: List[str] = Field(
        default=["http://localhost:5173"],
        description="Allowed CORS origins",
    )

    # -------------------------------------------------------------------------
    # STT
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
        description="LLM provider key. Supported: ollama | anthropic | gemini | openai | mistral_ai",
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
    river_song_system_prompt: str = Field(
        default=(
            "You are River Song, a confident and witty AI assistant with a warm "
            "personality. Keep responses concise and helpful. You have a playful "
            "sense of humor."
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

    # -------------------------------------------------------------------------
    # TTS
    # -------------------------------------------------------------------------
    tts_provider: str = Field(
        default="piper",
        description="TTS provider key. Supported: piper",
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
        description="Alpha Vantage key for stock quotes. Register free at alphavantage.co.",
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

    # Walmart Marketplace
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
    default_user_id: str = Field(
        default="primary_user",
        description=(
            "User ID used when looking up Google OAuth tokens. Must match the "
            "user_id passed to authorize_user() during the initial OAuth flow."
        ),
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
