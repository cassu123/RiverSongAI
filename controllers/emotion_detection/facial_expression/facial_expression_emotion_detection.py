# E:\River Song\controller\emotion_detection\facial_expression.py

import logging
from typing import Dict
import cv2
from deepface import DeepFace

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class FacialExpressionEmotionDetection:
    """
    A class to handle emotion detection from facial expressions.
    """

    def __init__(self):
        logging.info("Initializing FacialExpressionEmotionDetection module...")
        logging.info("FacialExpressionEmotionDetection module initialized.")

    def detect_emotion(self, image_path: str) -> Dict[str, float]:
        """
        Detects emotions from the provided image file.

        Args:
            image_path (str): Path to the image file.

        Returns:
            Dict[str, float]: A dictionary mapping emotions to their confidence scores.
        """
        logging.info(f"Analyzing image for emotions: {image_path}")
        analysis = DeepFace.analyze(img_path=image_path, actions=['emotion'])
        
        emotions = analysis['emotion']
        logging.info(f"Detected emotions: {emotions}")
        return emotions

if __name__ == "__main__":
    # Example usage of FacialExpressionEmotionDetection
    emotion_detector = FacialExpressionEmotionDetection()
    result = emotion_detector.detect_emotion("path_to_image_file.jpg")
    print(f"Detected emotions: {result}")
