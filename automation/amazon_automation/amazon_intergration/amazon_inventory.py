import requests

from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def manage_inventory():
    if module_kill_switch.is_active('AmazonInventory'):
        print("Amazon Inventory module is disabled. Shutting down operation.")
        return
    print("Managing Amazon inventory...")
    # Your inventory management logic here

class AmazonInventory:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.amazon.com/inventory"

    def check_inventory(self, product_id):
        """Check current inventory for a given product ID."""
        url = f"{self.base_url}/{product_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Failed to check inventory for {product_id}, Status Code: {response.status_code}"}

    def update_inventory(self, product_id, quantity):
        """Update the inventory for a product."""
        url = f"{self.base_url}/{product_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        data = {"quantity": quantity}
        response = requests.put(url, json=data, headers=headers)
        
        if response.status_code == 200:
            return {"message": f"Inventory updated for {product_id} to {quantity} units."}
        else:
            return {"error": f"Failed to update inventory for {product_id}, Status Code: {response.status_code}"}
