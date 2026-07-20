import os
from providers.product_lookup.base import BaseProductLookupProvider
from providers.product_lookup.upcitemdb import UPCItemDBProvider

def get_product_lookup_provider() -> BaseProductLookupProvider:
    # Pluggable provider selection based on env vars
    provider_type = os.environ.get("PRODUCT_LOOKUP_PROVIDER", "upcitemdb")
    api_key = os.environ.get("PRODUCT_LOOKUP_API_KEY", None)
    
    if provider_type == "upcitemdb":
        return UPCItemDBProvider(api_key=api_key)
    
    # Fallback to default
    return UPCItemDBProvider(api_key=api_key)
