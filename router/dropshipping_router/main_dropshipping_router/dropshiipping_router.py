from router_base.router import Router
from dropshipping.dropshipping_controller import DropshippingController

class DropshippingRouter(Router):
    def __init__(self, api_key):
        super().__init__()
        self.controller = DropshippingController(api_key)
        self.add_route("sync_supplier_products", self.sync_supplier_products)
        self.add_route("sync_orders", self.sync_orders)

    def sync_supplier_products(self):
        """Sync supplier products with Amazon."""
        return self.controller.sync_supplier_data()

    def sync_orders(self):
        """Sync orders from suppliers to Amazon."""
        return self.controller.sync_products()
