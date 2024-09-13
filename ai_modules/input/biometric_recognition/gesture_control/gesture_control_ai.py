import cv2
import numpy as np
from feature_extraction.extract_gesture_features import GestureFeatureExtractor
from models.gesture_model import GestureModel

class GestureControlAI:
    def __init__(self):
        self.feature_extractor = GestureFeatureExtractor()
        self.model = GestureModel()

    def recognize_gesture(self, video_path):
        """
        Recognizes gestures from the provided video.
        """
        features = self.feature_extractor.extract_gesture_features(video_path)
        predicted_gesture = self.model.predict(features)
        return predicted_gesture

    def perform_action_based_on_gesture(self, gesture):
        """
        Maps gestures to specific actions.
        """
        action_map = {
            "swipe_left": self.perform_swipe_left_action,
            "swipe_right": self.perform_swipe_right_action,
            "zoom_in": self.perform_zoom_in_action,
            "zoom_out": self.perform_zoom_out_action,
        }
        
        action = action_map.get(gesture, self.default_action)
        action()

    def perform_swipe_left_action(self):
        print("Performing swipe left action...")
        # Implement your logic here

    def perform_swipe_right_action(self):
        print("Performing swipe right action...")
        # Implement your logic here

    def perform_zoom_in_action(self):
        print("Performing zoom in action...")
        # Implement your logic here

    def perform_zoom_out_action(self):
        print("Performing zoom out action...")
        # Implement your logic here

    def default_action(self):
        print("Unknown gesture. No action performed.")

if __name__ == "__main__":
    gesture_ai = GestureControlAI()
    video_file = "path_to_gesture_video.mp4"  # Replace with the actual video path

    gesture = gesture_ai.recognize_gesture(video_file)
    print(f"Recognized Gesture: {gesture}")
    gesture_ai.perform_action_based_on_gesture(gesture)
