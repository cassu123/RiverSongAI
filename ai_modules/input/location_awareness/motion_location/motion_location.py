class MotionLocation:
    def __init__(self):
        self.last_known_location = "Unknown"

    def detect_motion(self, room_name):
        print(f"Motion detected in {room_name}.")
        self.last_known_location = room_name

    def get_last_known_location(self):
        print(f"Last known location: {self.last_known_location}")
        return self.last_known_location
