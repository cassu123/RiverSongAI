from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def sync_products():
    if module_kill_switch.is_active('Dropshipping'):
        print("Product sync is disabled. Shutting down operation.")
        return
    print("Syncing products...")
    # Your existing product sync logic

class ProductSync:
    def __init__(self, api_key):
        self.api_key = api_key

    def sync_products(self, product_list):
        """Sync products from supplier to Amazon."""
        for product in product_list:
            # Add logic to sync each product to Amazon
            print(f"Syncing product: {product['name']}")
        return "All products synced successfully."
