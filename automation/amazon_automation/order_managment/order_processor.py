from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def process_orders():
    if module_kill_switch.is_active('OrderManagement'):
        print("Order Management module is disabled. Shutting down operation.")
        return
    print("Processing orders...")
    # Your order processing logic here


class OrderProcessor:
    def __init__(self, api_key):
        self.api_key = api_key

    def process_order(self, order_data):
        """Process an individual order."""
        print(f"Processing order: {order_data}")
        return "Order processed successfully."
