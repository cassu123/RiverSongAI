class EnvironmentalState:
    def __init__(self):
        self.environment_data = {}

    def update_environment(self, key, value):
        """
        Updates environmental factors like temperature, noise level, or light state.
        """
        self.environment_data[key] = value
        print(f"Environment updated: {key} = {value}")

    def get_environment(self, key):
        """
        Retrieves a specific environmental state.
        """
        return self.environment_data.get(key, "No data available")

if __name__ == "__main__":
    env_state = EnvironmentalState()
    env_state.update_environment('temperature', '21C')
    env_state.update_environment('noise_level', 'Quiet')
    print(f"Temperature: {env_state.get_environment('temperature')}")
