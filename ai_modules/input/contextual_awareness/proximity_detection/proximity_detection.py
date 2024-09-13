import random

class ProximityDetection:
    def __init__(self):
        self.proximity_status = {}

    def detect_proximity(self, device_name, max_distance=5):
        """
        Detects proximity to a device or object and returns the distance.
        """
        distance = random.uniform(0, max_distance)  # Simulating proximity detection
        self.proximity_status[device_name] = distance
        print(f"Detected {device_name} at {distance:.2f} meters.")
        return distance

    def get_proximity_status(self, device_name):
        """
        Returns the last known distance to the specified device.
        """
        return self.proximity_status.get(device_name, "Device not detected")

if __name__ == "__main__":
    proximity_detector = ProximityDetection()
    proximity_detector.detect_proximity('TV')
    print(f"TV Proximity: {proximity_detector.get_proximity_status('TV')}")
