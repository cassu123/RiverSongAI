import httpx
from typing import Optional
from providers.product_lookup.base import BaseProductLookupProvider, ProductLookupResult

class UPCItemDBProvider(BaseProductLookupProvider):
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.base_url = "https://api.upcitemdb.com/prod/trial/lookup"
        # For trial, api_key is not strictly required but we support it
        
    def lookup_upc(self, upc_code: str) -> Optional[ProductLookupResult]:
        try:
            params = {"upc": upc_code}
            headers = {}
            if self.api_key:
                headers["user_key"] = self.api_key
            
            # Using synchronous httpx for simplicity, though async is preferred if called from FastAPI
            # We'll use timeout to avoid blocking forever
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(self.base_url, params=params, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                
                if data.get("code") == "OK" and data.get("items"):
                    item = data["items"][0]
                    return ProductLookupResult(
                        name=item.get("title", ""),
                        manufacturer=item.get("brand") or item.get("publisher"),
                        category=item.get("category"),
                        description=item.get("description"),
                        image_url=item.get("images", [None])[0] if item.get("images") else None,
                        model_number=item.get("model")
                    )
                return None
        except Exception:
            return None
