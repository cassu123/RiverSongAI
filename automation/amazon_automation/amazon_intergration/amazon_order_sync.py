import requests

from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def sync_orders():
    if module_kill_switch.is_active('AmazonOrderSync'):
        print("Amazon Order Sync module is disabled. Shutting down operation.")
        return
    print("Syncing orders with Amazon...")
    # Your order sync logic here

class AmazonOrderSync:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.amazon.com/orders"

    def sync_orders(self):
        """Sync orders from Amazon to local system."""
        url = f"{self.base_url}/sync"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to sync orders, Status Code: {response.status_code}"}

    def sync_order_by_id(self, order_id):
        """Sync a specific order by order ID."""
        url = f"{self.base_url}/{order_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to sync order {order_id}, Status Code: {response.status_code}"}
