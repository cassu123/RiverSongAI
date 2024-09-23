import requests
from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def make_amazon_api_call():
    if module_kill_switch.is_active('AmazonAPI'):
        print("Amazon API module is disabled. Shutting down operation.")
        return
    print("Making API call to Amazon...")
    # Your Amazon API call logic here


class AmazonAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.amazon.com"

    def get_product_details(self, product_id):
        """Fetch product details by product ID from Amazon API."""
        url = f"{self.base_url}/products/{product_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to get product details for {product_id}, Status Code: {response.status_code}"}

    def place_order(self, order_data):
        """Place an order through Amazon API."""
        url = f"{self.base_url}/orders"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.post(url, json=order_data, headers=headers)
        
        if response.status_code == 201:
            return {"message": "Order placed successfully", "order_id": response.json().get('order_id')}
        else:
            return {"error": f"Failed to place order, Status Code: {response.status_code}"}
