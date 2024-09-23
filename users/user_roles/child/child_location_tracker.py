# /user_roles/child/child_location_tracker.py

import time
from random import randint

# Simulate getting GPS location data
def get_child_location():
    # Simulate random GPS coordinates (in reality, you'd fetch this from a device)
    latitude = 37.7749 + (randint(-100, 100) / 1000.0)  # Adjusting within a small range
    longitude = -122.4194 + (randint(-100, 100) / 1000.0)
    return (latitude, longitude)

# Log the location history for future reference
def log_location_history():
    location_history = []
    for _ in range(5):  # Simulate 5 location updates
        location = get_child_location()
        location_history.append(location)
        print(f"Logged location: {location}")
        time.sleep(1)  # Simulate time passing between location updates

    return location_history
