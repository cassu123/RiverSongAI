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

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config.settings import get_settings
from core.limiter import limiter
from core.kill_switch import is_kill_switch_active
from core.memory_manager import MemoryManager
from providers.memory.sqlite_store import SQLiteStore

logger = logging.getLogger(__name__)

# Module-level variable to store the app instance for circular dependency resolution.
_app_instance: FastAPI | None = None

def get_app() -> FastAPI | None:
    """Returns the globally initialized FastAPI application instance."""
    return _app_instance


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

    Initializes the SQLiteStore and MemoryManager once at startup and stores
    them on app.state so WebSocket routes can access the shared instances.
    LLM/STT/TTS providers are still initialized lazily per-connection.
    """
    import os
    import main as _main_module
    _main_module._app_instance = app

    settings = get_settings()

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

    # Initialize memory layer
    os.makedirs(os.path.dirname(settings.db_path) or ".", exist_ok=True)
    store = SQLiteStore(settings.db_path)
    memory_manager = MemoryManager(store)
    await memory_manager.initialize()
    app.state.memory_manager = memory_manager
    app.state.active_connections = {} # user_id -> List[WebSocket]
    app.state.ws_tickets = {} # ticket_uuid -> {"user_id": str, "expires_at": float, "is_kiosk": bool}
    logger.info("Memory layer ready (db=%s).", settings.db_path)

    # Daemon registry (Task A)
    from daemons.registry import DaemonRegistry
    app.state.daemon_registry = DaemonRegistry()
    logger.info("Daemon registry ready.")

    # Context engine (Task B)
    from core.context_engine import ContextEngine
    app.state.context_engine = ContextEngine()
    logger.info("Context engine ready.")

    # Rover telemetry (Task Rover)
    app.state.rover_telemetry = {}
    logger.info("Rover telemetry initialized.")

    # Load persistent AI feature flags and admin-saved config
    try:
        from api.routes.features import AI_FEATURE_MAP
        config = await store.get_admin_config()
        ai_config = config.get("ai_features", {})
        for flag_name, attr in AI_FEATURE_MAP.items():
            if flag_name in ai_config:
                setattr(settings, attr, ai_config[flag_name])
                logger.info("Applied persistent flag: %s = %s", flag_name, ai_config[flag_name])

        # ElevenLabs
        el_config = config.get("elevenlabs_config", {})
        if el_config:
            if el_config.get("api_key"): settings.elevenlabs_api_key = el_config["api_key"]
            if el_config.get("voice_id"): settings.elevenlabs_voice_id = el_config["voice_id"]
            if el_config.get("model_id"): settings.elevenlabs_model_id = el_config["model_id"]
            logger.info("Applied persistent ElevenLabs settings.")

        # Persona
        p_config = config.get("persona_config", {})
        if p_config:
            if p_config.get("system_prompt"): settings.river_song_system_prompt = p_config["system_prompt"]
            logger.info("Applied persistent Persona system prompt.")

        # Wake Word
        ww_config = config.get("wake_word_config", {})
        if ww_config:
            if "enabled" in ww_config: settings.wake_word_enabled = ww_config["enabled"]
            if ww_config.get("phrase"): settings.wake_word_model = ww_config["phrase"]
            if "sensitivity" in ww_config: settings.wake_word_threshold = ww_config["sensitivity"]
            logger.info("Applied persistent Wake Word settings.")

        # Integrations (Task 7)
        integrations = config.get("integrations", {})
        if integrations:
            for k, v in integrations.items():
                if v: os.environ[k] = str(v)
            logger.info("Injected %d persistent integrations into environment.", len(integrations))

    except Exception as e:
        logger.warning("Failed to apply persistent settings: %s", e)

    # Purge expired revoked tokens (Task 1)
    try:
        deleted = await store.delete_expired_tokens()
        if deleted > 0:
            logger.info("Purged %d expired revoked token(s).", deleted)
    except Exception as e:
        logger.warning("Failed to purge expired tokens: %s", e)

    # Start routine scheduler
    from core.routines_scheduler import start_scheduler
    scheduler_task = asyncio.create_task(start_scheduler(app))

    # CHRONOS: Start vault watcher
    from providers.vault.vault_provider import start_vault_watcher
    start_vault_watcher(app)

    yield  # Application runs here

    # CHRONOS: Stop vault watcher
    from providers.vault.vault_provider import stop_vault_watcher
    stop_vault_watcher()

    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    store.close()
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

    is_dev = settings.environment.lower() == "development"

    app = FastAPI(
        title="River Song AI",
        description="Personal AI hub -- Phase 1: Core conversation loop (Mic -> Whisper -> Ollama -> Piper -> Speaker)",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/openapi.json" if is_dev else None,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Reject requests from unexpected hostnames (protects against Host header attacks)
    if settings.allowed_hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    # Forward real client IP from Cloudflare's CF-Connecting-IP header
    import ipaddress
    from datetime import datetime, timedelta

    _last_warning = datetime.min
    
    def _is_cloudflare_ip(ip: str) -> bool:
        if not settings.trust_cloudflare_headers:
            return False
        try:
            addr = ipaddress.ip_address(ip)
            ranges = (settings.cloudflare_ip_ranges_v4 if addr.version == 4 
                      else settings.cloudflare_ip_ranges_v6)
            for r in ranges:
                if addr in ipaddress.ip_network(r):
                    return True
        except ValueError:
            pass
        return False

    class _CloudflareIPMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: StarletteRequest, call_next):
            cf_ip = request.headers.get("CF-Connecting-IP")
            if cf_ip:
                client_host = request.client.host if request.client else None
                if client_host and _is_cloudflare_ip(client_host):
                    request.scope["client"] = (cf_ip, 0)
                else:
                    nonlocal _last_warning
                    if datetime.now() - _last_warning > timedelta(minutes=1):
                        logger.warning(
                            "Ignored CF-Connecting-IP from non-Cloudflare peer: %s", 
                            client_host
                        )
                        _last_warning = datetime.now()
            return await call_next(request)

    # Allow the Vite dev server (and any other configured origins) to connect
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(_CloudflareIPMiddleware)

    # Register API routers
    from api.routes import (
        auth_router, health_router, dashboard_router, memory_router,
        killswitch_router, home_router, conversation_router, settings_router,
        admin_router, routines_router, inventory_router, commerce_router,
        vehicles_router, feeds_router, reading_router, features_router,
        parent_router, analytics_router, culinary_router, location_router, google_router,
        vision_router, vault_router, pulse_router, n8n_webhooks, shopify_webhooks_router, image_router, push_router,
        legal_router, rag_router, daemons_router, context_router, broadcast_router, rover_router
    )

    app.include_router(auth_router)
    app.include_router(health_router)
    app.include_router(dashboard_router)
    app.include_router(memory_router)
    app.include_router(killswitch_router)
    app.include_router(home_router)
    app.include_router(conversation_router)
    app.include_router(settings_router)
    app.include_router(admin_router)
    app.include_router(routines_router)
    app.include_router(inventory_router)
    app.include_router(commerce_router)
    app.include_router(vehicles_router)
    app.include_router(feeds_router)
    app.include_router(reading_router)
    app.include_router(features_router)
    app.include_router(parent_router)
    app.include_router(analytics_router)
    app.include_router(culinary_router)
    app.include_router(location_router)
    app.include_router(google_router)
    app.include_router(vision_router)
    app.include_router(vault_router)
    app.include_router(pulse_router)
    app.include_router(shopify_webhooks_router)
    app.include_router(image_router)
    app.include_router(push_router)
    app.include_router(legal_router)
    app.include_router(rag_router)
    app.include_router(daemons_router)
    app.include_router(context_router)
    app.include_router(broadcast_router)
    app.include_router(rover_router)

    # Serve the built React frontend — must be last so API routes take priority
    import os
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    _dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    if os.path.isdir(_dist):
        app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            # Serve static files from dist root (e.g. avatar.glb, favicon.ico)
            static_file = os.path.join(_dist, full_path)
            if full_path and os.path.isfile(static_file):
                return FileResponse(static_file)
            index = os.path.join(_dist, "index.html")
            return FileResponse(index)

    return app


# Module-level app instance -- referenced by Uvicorn as "main:app"
app: FastAPI = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,
        log_level=settings.log_level.lower(),
        ws_ping_interval=30,
        ws_ping_timeout=20,
    )
