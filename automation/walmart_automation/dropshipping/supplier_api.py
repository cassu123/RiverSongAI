# supplier_api.py

class SupplierAPI:
    def __init__(self, user):
        self.user = user
        self.api_key = user['supplier_api_key']  # User-specific supplier API key
        self.base_url = user['supplier_base_url']

    def fetch_products(self):
        """
        Fetch the products from the supplier's API.
        """
        print(f"Fetching products for user {self.user['name']} from supplier")
        # Simulate API request
        # For actual requests use requests library
        products = [
            {"name": "Product 1", "price": 100, "stock": 50},
            {"name": "Product 2", "price": 200, "stock": 30}
        ]
        return products
