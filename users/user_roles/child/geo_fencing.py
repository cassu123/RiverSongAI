# /user_roles/child/geo_fencing.py

def is_within_zone(current_location, zone_center, radius):
    # A simple distance check between current location and zone center (approximation)
    distance = ((current_location[0] - zone_center[0]) ** 2 + (current_location[1] - zone_center[1]) ** 2) ** 0.5
    return distance <= radius

# Example usage
def monitor_geofence():
    # Define a zone (e.g., home at lat: 37.7749, lon: -122.4194)
    home_zone = (37.7749, -122.4194)
    radius = 0.02  # Approx radius in degrees

    current_location = get_child_location()  # Get child's simulated location

    if is_within_zone(current_location, home_zone, radius):
        print("Child is within the safe zone (home).")
    else:
        print("Alert! Child has left the safe zone!")
