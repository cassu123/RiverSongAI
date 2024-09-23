from router_base.router import Router
from amazon_automation.amazon_integration.amazon_api import AmazonAPI

class AmazonRouter(Router):
    def __init__(self, api_key):
        super().__init__()
        self.api = AmazonAPI(api_key)
        self.add_route("sync_inventory", self.sync_inventory)
        self.add_route("process_order", self.process_order)

    def sync_inventory(self, **kwargs):
        """Sync inventory with Amazon."""
        return self.api.sync_inventory()

    def process_order(self, order_data):
        """Process an order on Amazon."""
        return self.api.place_order(order_data)
