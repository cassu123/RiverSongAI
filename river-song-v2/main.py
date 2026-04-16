# =============================================================================
# main.py
#
# River Song AI -- FastAPI application entry point.
#
# Responsibilities:
#   - Configure logging
#   - Create the FastAPI app instance
#   - Register CORS middleware
#   - Mount all API routers
#   - Run Uvicorn when executed directly
#
# Usage:
#   Development:   python main.py
#   Production:    uvicorn main:app --host 0.0.0.0 --port 8000
# =============================================================================

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import get_settings
from core.kill_switch import is_kill_switch_active


def _configure_logging(log_level: str) -> None:
    """
    Configure the root logger with a consistent timestamp format.

    Args:
        log_level: One of DEBUG | INFO | WARNING | ERROR | CRITICAL.
                   Validated by Settings before this is called.
    """
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,  # Override any handlers set by imported modules
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    FastAPI lifespan handler.

    Code before yield runs at application startup.
    Code after yield runs at application shutdown.

    Used here for startup logging and kill switch warning. Providers are
    initialized lazily per WebSocket connection in conversation.py, not
    here, so startup is always fast regardless of model size.
    """
    settings = get_settings()
    logger = logging.getLogger(__name__)

    logger.info("River Song AI starting up.")
    logger.info(
        "Providers -- STT: %s | LLM: %s | TTS: %s",
        settings.stt_provider,
        settings.llm_provider,
        settings.tts_provider,
    )
    logger.info("Listening on %s:%d", settings.app_host, settings.app_port)

    if is_kill_switch_active():
        logger.critical(
            "GLOBAL KILL SWITCH IS ACTIVE. "
            "The server will start but all conversation turns will be blocked. "
            "Reset the kill switch and restart to resume normal operation."
        )

    yield  # Application runs here

    logger.info("River Song AI shutting down.")


def create_app() -> FastAPI:
    """
    Build and return the configured FastAPI application instance.

    Called once at module load. All routers and middleware are registered
    here. Import this function in tests to get a fresh app instance.

    Returns:
        FastAPI: Fully configured application ready for Uvicorn.
    """
    settings = get_settings()
    _configure_logging(settings.log_level)

    app = FastAPI(
        title="River Song AI",
        description="Personal AI hub -- Phase 1: Core conversation loop (Mic -> Whisper -> Ollama -> Piper -> Speaker)",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Allow the Vite dev server (and any other configured origins) to connect
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers
    from api.routes.health import router as health_router
    from api.routes.conversation import router as conversation_router

    app.include_router(health_router)
    app.include_router(conversation_router)

    return app


# Module-level app instance -- referenced by Uvicorn as "main:app"
app: FastAPI = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,       # Set to True during development if not using WebSockets
        log_level=settings.log_level.lower(),
        ws_ping_interval=30,
        ws_ping_timeout=20,
    )
