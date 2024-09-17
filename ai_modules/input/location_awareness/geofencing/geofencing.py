class Geofencing:
    def __init__(self, home_coordinates):
        self.home_coordinates = home_coordinates  # Example: [latitude, longitude]

    def is_within_geofence(self, current_coordinates, radius_km=1):
        # Placeholder function: Assume user is always inside geofence for now
        return True

    def check_geofence(self, current_coordinates):
        if self.is_within_geofence(current_coordinates):
            print("User is within geofence.")
            return True
        else:
            print("User is outside the geofence.")
            return False
