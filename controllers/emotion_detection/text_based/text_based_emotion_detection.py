# E:\River Song\controller\emotion_detection\text_based.py

import logging
from typing import Dict
from transformers import pipeline

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class TextEmotionDetection:
    """
    A class to handle emotion detection from text input.
    """

    def __init__(self):
        logging.info("Initializing TextEmotionDetection module...")
        # Initialize the emotion detection pipeline with a pre-trained model
        self.nlp = pipeline("sentiment-analysis", model="j-hartmann/emotion-english-distilroberta-base")
        logging.info("TextEmotionDetection module initialized.")

    def detect_emotion(self, text: str) -> Dict[str, float]:
        """
        Detects emotions from the provided text.

        Args:
            text (str): The text input to analyze.

        Returns:
            Dict[str, float]: A dictionary mapping emotions to their confidence scores.
        """
        logging.info(f"Analyzing text for emotions: {text}")
        results = self.nlp(text)
        
        emotions = {result['label'].lower(): result['score'] for result in results}
        
        logging.info(f"Detected emotions: {emotions}")
        return emotions

if __name__ == "__main__":
    # Example usage of TextEmotionDetection
    emotion_detector = TextEmotionDetection()
    result = emotion_detector.detect_emotion("I am so happy today!")
    print(f"Detected emotions: {result}")
