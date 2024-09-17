import random

class IndoorLocalization:
    def get_room(self):
        # Simulating indoor localization with dummy room names
        rooms = ["Living Room", Kitchen", "Bedroom", "Office"]
        current_room = random.choice(rooms)
        print(f"User is in {current_room}")
        return current_room
