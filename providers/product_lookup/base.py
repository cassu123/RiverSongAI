from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel

class ProductLookupResult(BaseModel):
    name: str
    manufacturer: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    model_number: Optional[str] = None

class BaseProductLookupProvider(ABC):
    @abstractmethod
    def lookup_upc(self, upc_code: str) -> Optional[ProductLookupResult]:
        """
        Look up product details using a UPC code.
        Returns a ProductLookupResult if found, else None.
        """
        pass
