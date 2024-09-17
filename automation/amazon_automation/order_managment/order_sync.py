class OrderSync:
    def __init__(self, api_key):
        self.api_key = api_key

    def sync_orders(self):
        """Sync orders with Amazon."""
        print("Syncing orders with Amazon.")
        return "Order sync completed."
