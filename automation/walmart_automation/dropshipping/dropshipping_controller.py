# dropshipping_controller.py

import product_sync
import supplier_api
from user_preferences import get_user_preferences

class DropshippingController:
    def __init__(self):
        self.users = get_user_preferences()

    def sync_products_for_all_users(self):
        for user in self.users:
            supplier = supplier_api.SupplierAPI(user)
            products = supplier.fetch_products()
            product_sync.sync_products(user, products)

    def schedule_sync(self, interval):
        # Placeholder for scheduling product sync at regular intervals
        print(f"Scheduling product sync every {interval} minutes")
        # Use something like `schedule` library to automate the sync process

if __name__ == "__main__":
    controller = DropshippingController()
    controller.sync_products_for_all_users()
    controller.schedule_sync(60)
