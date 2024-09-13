import json
import os

class LightSensor:
    def __init__(self):
        # Define the path to the user preferences file
        self.user_preferences_path = os.path.join('riversong', 'users', 'user_preferences', 'user_preferences.json')
        self.sensor_status = True  # Default status is 'on'
        self.user_preferences = self.load_user_preferences()

    def load_user_preferences(self):
        # Ensure the directory and file exist, if not, create them
        os.makedirs(os.path.dirname(self.user_preferences_path), exist_ok=True)
        
        # Check if the user preferences file exists, if not create it
        if not os.path.isfile(self.user_preferences_path):
            with open(self.user_preferences_path, 'w') as file:
                json.dump({}, file)

        # Load the existing preferences
        with open(self.user_preferences_path, 'r') as file:
            return json.load(file)

    def save_user_preferences(self):
        # Save user preferences to the JSON file
        with open(self.user_preferences_path, 'w') as file:
            json.dump(self.user_preferences, file)

    def set_sensor_status(self, user, status):
        """Enable or disable the sensor for a specific user."""
        self.user_preferences[user] = status
        self.save_user_preferences()
    
    def get_sensor_status(self, user):
        """Check if the sensor is enabled for a user."""
        return self.user_preferences.get(user, True)  # Default to True if no preference found
    
    def detect_light(self):
        """Simulate light detection (actual hardware interaction would be here)."""
        if self.sensor_status:
            # Simulate reading light sensor data (replace with actual sensor code)
            return self.read_light_sensor()
        else:
            return None
    
    def read_light_sensor(self):
        """Placeholder for actual sensor reading logic."""
        # Simulate light sensor reading
        simulated_light_level = 100  # Replace with real sensor data
        return simulated_light_level
    
    def check_light_for_user(self, user):
        """Check light level if the sensor is active for the user."""
        if self.get_sensor_status(user):
            return self.detect_light()
        else:
            return "Sensor is disabled for this user."

# Example usage
if __name__ == "__main__":
    light_sensor = LightSensor()
    user = 'christian'

    # Check light level for the user
    print(f"Light level for {user}: {light_sensor.check_light_for_user(user)}")

    # Change the sensor status for a user
    light_sensor.set_sensor_status(user, False)
    print(f"Sensor status for {user}: {light_sensor.get_sensor_status(user)}")

    # Re-enable the sensor
    light_sensor.set_sensor_status(user, True)
    print(f"Sensor status for {user}: {light_sensor.get_sensor_status(user)}")
