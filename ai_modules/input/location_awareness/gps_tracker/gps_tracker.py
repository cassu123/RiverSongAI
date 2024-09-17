import geocoder

class GPSTracker:
    def get_location(self):
        g = geocoder.ip('me')  # Using IP address to get an approximate location
        if g.ok:
            return g.latlng  # Returns [latitude, longitude]
        else:
            return None

    def track_user_location(self):
        location = self.get_location()
        if location:
            print(f"User is located at {location}")
        else:
            print("Could not retrieve GPS location.")
