class ContextDetection:
    def __init__(self):
        self.context_data = {}

    def update_context(self, key, value):
        """
        Updates the context with new key-value pairs (e.g., room temperature, lighting).
        """
        self.context_data[key] = value
        print(f"Context updated: {key} = {value}")

    def get_context(self, key):
        """
        Retrieves a specific context value.
        """
        return self.context_data.get(key, "No data available")

    def clear_context(self):
        """
        Clears all contextual data.
        """
        self.context_data = {}
        print("Context data cleared.")

if __name__ == "__main__":
    context_detector = ContextDetection()
    context_detector.update_context('room_temperature', '22C')
    context_detector.update_context('lighting', 'Dimmed')
    print(f"Room Temperature: {context_detector.get_context('room_temperature')}")
