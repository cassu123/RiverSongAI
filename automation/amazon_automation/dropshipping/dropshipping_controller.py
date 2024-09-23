from amazon_automation.dropshipping.product_sync import ProductSync
from amazon_automation.dropshipping.supplier_api import SupplierAPI
from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def manage_dropshipping():
    if module_kill_switch.is_active('Dropshipping'):
        print("Dropshipping module is disabled. Shutting down operation.")
        return
    # Continue with the dropshipping process if the kill switch is not active
    print("Running Dropshipping module...")
    # Your existing logic for managing dropshipping here

class DropshippingController:
    def __init__(self, api_key):
        self.product_sync = ProductSync(api_key)
        self.supplier_api = SupplierAPI(api_key)

    def manage_dropshipping(self):
        """Manage the entire dropshipping process by syncing products from suppliers to Amazon."""
        supplier_products = self.supplier_api.get_supplier_products()
        self.product_sync.sync_products(supplier_products)
        return "Dropshipping process completed."
