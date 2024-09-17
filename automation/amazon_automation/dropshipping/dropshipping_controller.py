from amazon_automation.dropshipping.product_sync import ProductSync
from amazon_automation.dropshipping.supplier_api import SupplierAPI

class DropshippingController:
    def __init__(self, api_key):
        self.product_sync = ProductSync(api_key)
        self.supplier_api = SupplierAPI(api_key)

    def manage_dropshipping(self):
        """Manage the entire dropshipping process by syncing products from suppliers to Amazon."""
        supplier_products = self.supplier_api.get_supplier_products()
        self.product_sync.sync_products(supplier_products)
        return "Dropshipping process completed."
