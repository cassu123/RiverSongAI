import numpy as np
from feature_extraction.extract_voice_features import VoiceFeatureExtractor
from models.voice_command_model import VoiceCommandModel

class VoiceCommandsAI:
    def __init__(self):
        self.feature_extractor = VoiceFeatureExtractor()
        self.model = VoiceCommandModel()

    def recognize_command(self, audio_path):
        """
        Recognizes a voice command from the provided audio file.
        """
        features = self.feature_extractor.extract_voice_features(audio_path)
        predicted_command = self.model.predict(features)
        return predicted_command

    def perform_action_based_on_command(self, command):
        """
        Maps voice commands to specific actions.
        """
        action_map = {
            "turn_on_lights": self.turn_on_lights,
            "turn_off_lights": self.turn_off_lights,
            "increase_volume": self.increase_volume,
            "decrease_volume": self.decrease_volume,
        }

        action = action_map.get(command, self.default_action)
        action()

    def turn_on_lights(self):
        print("Turning on lights...")
        # Implement your logic here

    def turn_off_lights(self):
        print("Turning off lights...")
        # Implement your logic here

    def increase_volume(self):
        print("Increasing volume...")
        # Implement your logic here

    def decrease_volume(self):
        print("Decreasing volume...")
        # Implement your logic here

    def default_action(self):
        print("Unknown command. No action performed.")

if __name__ == "__main__":
    voice_ai = VoiceCommandsAI()
    audio_file = "path_to_audio_file.wav"  # Replace with actual audio file path

    command = voice_ai.recognize_command(audio_file)
    print(f"Recognized Command: {command}")
    voice_ai.perform_action_based_on_command(command)
