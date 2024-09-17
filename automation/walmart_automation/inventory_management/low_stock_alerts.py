# low_stock_alerts.py

def check_and_alert(user):
    """
    Check inventory levels and send low stock alerts to the user.
    """
    print(f"Checking stock for user {user['name']}")
    # Simulated stock check
    low_stock_items = ["Product 1", "Product 2"]
    if low_stock_items:
        send_alert(user, low_stock_items)

def send_alert(user, low_stock_items):
    """
    Send an alert to the user for low stock items.
    """
    print(f"Sending low stock alert to {user['name']} for items: {', '.join(low_stock_items)}")
    # Logic to send alerts via email or SMS
