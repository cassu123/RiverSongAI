import requests

class WalmartAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.walmart.com"

    def get_product_details(self, product_id):
        """Fetch product details by product ID from Walmart API."""
        url = f"{self.base_url}/products/{product_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to get product details for {product_id}, Status Code: {response.status_code}"}

    def place_order(self, order_data):
        """Place an order through Walmart API."""
        url = f"{self.base_url}/orders"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.post(url, json=order_data, headers=headers)
        
        if response.status_code == 201:
            return {"message": "Order placed successfully", "order_id": response.json().get('order_id')}
        else:
            return {"error": f"Failed to place order, Status Code: {response.status_code}"}
