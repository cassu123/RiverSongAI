# inventory_controller.py

import inventory_sync
import low_stock_alerts
from user_preferences import get_user_preferences

class InventoryController:
    def __init__(self):
        self.users = get_user_preferences()

    def sync_inventory_for_all_users(self):
        for user in self.users:
            inventory_sync.sync_inventory(user)

    def check_for_low_stock(self):
        for user in self.users:
            low_stock_alerts.check_and_alert(user)

if __name__ == "__main__":
    controller = InventoryController()
    controller.sync_inventory_for_all_users()
    controller.check_for_low_stock()
