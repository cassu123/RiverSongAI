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
from . import n8n_webhooks

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
    "n8n_webhooks",
]
