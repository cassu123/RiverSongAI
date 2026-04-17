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
        description="LLM provider key. Supported: ollama",
    )
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Base URL for the Ollama REST API",
    )
    llm_model: str = Field(
        default="llama3.1:8b",
        description="Ollama model tag (must be pulled before use)",
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
    # Intent Router (Phase 2)
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
