class OrderProcessor:
    def __init__(self, api_key):
        self.api_key = api_key

    def process_order(self, order_data):
        """Process an individual order."""
        print(f"Processing order: {order_data}")
        return "Order processed successfully."
