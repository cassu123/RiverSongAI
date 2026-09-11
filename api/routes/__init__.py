# System routes
from .system.health import router as health_router
from .system.daemons import router as daemons_router
from .system.killswitch import router as killswitch_router
from .system.features import router as features_router
from .system.models_settings import router as settings_router
from .system.usage import router as usage_router
from .system.admin import router as admin_router
from .system.remote_ollama import router as remote_ollama_router
from .system.sweeps import router as sweeps_router

# Auth routes
from .auth.auth import router as auth_router
from .auth.face_id import router as face_id_router
from .auth.voice_id import router as voice_id_router
from .auth.webhook_tokens import router as webhook_tokens_router
from .auth.shopify_auth import router as shopify_auth_router

# AI routes
from .ai.conversation import router as conversation_router
from .ai.chat_sessions import router as chat_sessions_router
from .ai.session_presets import router as session_presets_router
from .ai.proactive import router as proactive_router
from .ai.initiative import router as initiative_router
from .ai.skills import router as skills_router
from .ai.research import router as research_router
from .ai.rag import router as rag_router
from .ai.image import router as image_router
from .ai.cad import router as cad_router
from .ai.memory import router as memory_router
from .ai.vault import router as vault_router
from .ai.slae import router as slae_router
from .ai.context import router as context_router

# Domain routes
from .domains.analytics import router as analytics_router
from .domains.briefing import router as briefing_router
from .domains.commerce import router as commerce_router
from .domains.culinary import router as culinary_router
from .domains.culinary_sessions import router as culinary_sessions_router
from .domains.dashboard import router as dashboard_router
from .domains.home import router as home_router
from .domains.inventory import router as inventory_router
from .domains.reading import router as reading_router
from .domains.routines import router as routines_router
from .domains.vehicles import router as vehicles_router

# Fleet routes
from .fleet.fleet import fleet_routers
from .fleet.kova import router as kova_router
from .fleet.rover import router as rover_router
from .fleet.vector_fleet import router as vector_fleet_router
from .fleet.vexa import router as vexa_router
from .fleet.vortex import router as vortex_router

# Webhooks routes
from .webhooks import n8n_webhooks
from .webhooks.push import router as push_router
from .webhooks.shopify_webhooks import router as shopify_webhooks_router

# Feeds routes
from .feeds.compare import router as compare_router
from .feeds.documents import router as documents_router
from .feeds.feeds import router as feeds_router
from .feeds.google import router as google_router
from .feeds.integrations import router as integrations_router
from .feeds.legal import router as legal_router
from .feeds.location import router as location_router
from .feeds.parent import router as parent_router
from .feeds.pulse import router as pulse_router
from .feeds.vision import router as vision_router

__all__ = [
    "admin_router",
    "analytics_router",
    "auth_router",
    "briefing_router",
    "cad_router",
    "chat_sessions_router",
    "commerce_router",
    "compare_router",
    "context_router",
    "conversation_router",
    "culinary_router",
    "culinary_sessions_router",
    "daemons_router",
    "dashboard_router",
    "documents_router",
    "face_id_router",
    "features_router",
    "feeds_router",
    "fleet_routers",
    "google_router",
    "health_router",
    "home_router",
    "image_router",
    "initiative_router",
    "integrations_router",
    "inventory_router",
    "killswitch_router",
    "kova_router",
    "legal_router",
    "location_router",
    "memory_router",
    "n8n_webhooks",
    "parent_router",
    "proactive_router",
    "pulse_router",
    "push_router",
    "rag_router",
    "reading_router",
    "remote_ollama_router",
    "research_router",
    "routines_router",
    "rover_router",
    "session_presets_router",
    "settings_router",
    "shopify_auth_router",
    "shopify_webhooks_router",
    "skills_router",
    "slae_router",
    "sweeps_router",
    "usage_router",
    "vault_router",
    "vector_fleet_router",
    "vehicles_router",
    "vexa_router",
    "vision_router",
    "voice_id_router",
    "vortex_router",
    "webhook_tokens_router",
]
