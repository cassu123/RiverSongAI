from .health import router as health_router
from .auth import router as auth_router
from .conversation import router as conversation_router
from .models_settings import router as settings_router
from .dashboard import router as dashboard_router
from .memory import router as memory_router
from .killswitch import router as killswitch_router
from .home import router as home_router
from .admin import router as admin_router
from .routines import router as routines_router
from .inventory import router as inventory_router
from .commerce import router as commerce_router
from .vehicles import router as vehicles_router
from .feeds import router as feeds_router
from .reading import router as reading_router
from .features import router as features_router
from .parent import router as parent_router
from .analytics import router as analytics_router
from .culinary import router as culinary_router
from .location import router as location_router
from .google import router as google_router
from .vision import router as vision_router
from .shopify_webhooks import router as shopify_webhooks_router
from .shopify_auth import router as shopify_auth_router
from .image import router as image_router
from .push import router as push_router
from .rag import router as rag_router
from .daemons import router as daemons_router
from .context import router as context_router
from .rover import router as rover_router
from .vault import router as vault_router
from .pulse import router as pulse_router
from .voice_id import router as voice_id_router
from .willow import router as willow_router
from . import n8n_webhooks
from .legal import router as legal_router
from .usage import router as usage_router
from .integrations import router as integrations_router
from .vector_fleet import router as vector_fleet_router
from .vexa import router as vexa_router
from .kova import router as kova_router
from .documents import router as documents_router
from .fleet import fleet_routers
from .initiative import router as initiative_router
from .skills import router as skills_router
from .session_presets import router as session_presets_router
from .webhook_tokens import router as webhook_tokens_router
from .research import router as research_router
from .compare import router as compare_router
from .remote_ollama import router as remote_ollama_router
from .slae import router as slae_router
from .chat_sessions import router as chat_sessions_router
from .proactive import router as proactive_router
from .sweeps import router as sweeps_router

__all__ = [
    "health_router",
    "auth_router",
    "conversation_router",
    "settings_router",
    "dashboard_router",
    "memory_router",
    "killswitch_router",
    "home_router",
    "admin_router",
    "routines_router",
    "inventory_router",
    "commerce_router",
    "vehicles_router",
    "feeds_router",
    "reading_router",
    "features_router",
    "parent_router",
    "analytics_router",
    "culinary_router",
    "location_router",
    "google_router",
    "vision_router",
    "shopify_webhooks_router",
    "shopify_auth_router",
    "image_router",
    "push_router",
    "rag_router",
    "daemons_router",
    "context_router",
    "rover_router",
    "vault_router",
    "pulse_router",
    "voice_id_router",
    "willow_router",
    "n8n_webhooks",
    "legal_router",
    "usage_router",
    "integrations_router",
    "vector_fleet_router",
    "vexa_router",
    "kova_router",
    "documents_router",
    "fleet_routers",
    "initiative_router",
    "skills_router",
    "session_presets_router",
    "webhook_tokens_router",
    "research_router",
    "compare_router",
    "remote_ollama_router",
    "slae_router",
    "chat_sessions_router",
    "proactive_router",
    "sweeps_router",
]
