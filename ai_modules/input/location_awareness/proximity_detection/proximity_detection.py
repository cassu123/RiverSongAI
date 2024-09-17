import random

class ProximityDetection:
    def detect_device_proximity(self, device_name):
        # Simulating device proximity with a random boolean (True/False)
        is_nearby = random.choice([True, False])
        if is_nearby:
            print(f"{device_name} is nearby.")
        else:
            print(f"{device_name} is not nearby.")
        return is_nearby
