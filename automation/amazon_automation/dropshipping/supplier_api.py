import requests

class SupplierAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.supplier.com"

    def get_supplier_products(self):
        """Fetch a list of products from the supplier."""
        url = f"{self.base_url}/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to fetch products, Status Code: {response.status_code}"}
