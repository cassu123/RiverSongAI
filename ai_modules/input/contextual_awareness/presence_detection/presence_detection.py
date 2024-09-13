import random

class PresenceDetection:
    def __init__(self):
        self.users_present = {}

    def detect_presence(self, user_name):
        """
        Simulates detection of a user’s presence.
        """
        present = random.choice([True, False])  # Simulating presence detection
        self.users_present[user_name] = present
        status = "present" if present else "not present"
        print(f"{user_name} is {status}.")
        return present

    def get_presence_status(self, user_name):
        """
        Retrieves the last known presence status of a user.
        """
        return self.users_present.get(user_name, "No data available")

if __name__ == "__main__":
    presence_detector = PresenceDetection()
    presence_detector.detect_presence('Chris')
    print(f"Chris Presence: {presence_detector.get_presence_status('Chris')}")
