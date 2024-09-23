from amazon_automation.inventory_management.inventory_sync import InventorySync
from amazon_automation.inventory_management.low_stock_alerts import LowStockAlerts

from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def manage_inventory():
    if module_kill_switch.is_active('InventoryManagement'):
        print("Inventory Management module is disabled. Shutting down operation.")
        return
    print("Managing inventory...")
    # Your inventory management logic here


class InventoryController:
    def __init__(self, api_key):
        self.inventory_sync = InventorySync(api_key)
        self.low_stock_alerts = LowStockAlerts(api_key)

    def manage_inventory(self):
        """Manage inventory by syncing and checking for low stock alerts."""
        self.inventory_sync.sync_inventory()
        self.low_stock_alerts.check_for_low_stock()
        return "Inventory management completed."
