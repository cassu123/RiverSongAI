# E:\River Song\controller\controller_module.py

import logging
from typing import Any, Callable, Dict, Optional
from threading import Lock
from controller.communication import Communication
from controller.error_handler import ErrorHandler
from controller.resource_manager import ResourceManager
from controller.scheduler import Scheduler
from controller.security import SecurityManager
from controller.router.router import Router
from controller.emotion_detection.text_based import TextEmotionDetection
from controller.emotion_detection.speech_based import SpeechEmotionDetection
from controller.emotion_detection.facial_expression import FacialExpressionEmotionDetection
from controller.text_to_speech.text_to_speech import TextToSpeech  # Import TTS module

# Setup logging with secure practices
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class Controller:
    """
    A central controller to manage inputs, route them to appropriate AI models,
    maintain context, handle errors, and integrate all system components.
    """

    def __init__(self):
        """
        Initializes the Controller class with all components.
        """
        self._lock = Lock()  # Ensuring thread safety
        self._communication = Communication()
        self._error_handler = ErrorHandler()
        self._resource_manager = ResourceManager()
        self._scheduler = Scheduler()
        self._security_manager = SecurityManager()
        self._text_emotion_detection = TextEmotionDetection()
        self._speech_emotion_detection = SpeechEmotionDetection()
        self._facial_expression_emotion_detection = FacialExpressionEmotionDetection()
        self._text_to_speech = TextToSpeech()  # Initialize TTS module
        self._context = {}  # A dictionary to maintain context/state
        self._models: Dict[str, Callable] = {}  # A dictionary to manage AI models
        self._router = Router()  # Router instance for routing input to models

        logging.info("Controller initialized with all components.")

    def add_model(self, model_name: str, model: Callable):
        """
        Adds an AI model to the controller.

        Args:
            model_name (str): The name of the model.
            model (Callable): The model callable (e.g., function or class instance).
        """
        with self._lock:
            if model_name in self._models:
                logging.warning(f"Model '{model_name}' already exists. Replacing the existing model.")
            self._models[model_name] = model
            self._router.update_model(model_name, model)  # Keep router in sync with models
        logging.info(f"Model '{model_name}' added to the controller.")

    def remove_model(self, model_name: str):
        """
        Removes an AI model from the controller.

        Args:
            model_name (str): The name of the model to remove.
        """
        with self._lock:
            if model_name in self._models:
                del self._models[model_name]
                self._router.remove_model(model_name)  # Keep router in sync with models
                logging.info(f"Model '{model_name}' removed from the controller.")
            else:
                logging.warning(f"Attempted to remove non-existent model '{model_name}'.")

    def process_input(self, input_data: Any, input_type: str) -> Optional[Any]:
        """
        Processes an input by routing it to the appropriate model.

        Args:
            input_data (Any): The input data to process.
            input_type (str): The type of input (e.g., 'text', 'voice', 'image').

        Returns:
            Optional[Any]: The response from the AI model or None if an error occurs.
        """
        with self._lock:
            model = self._router.route_input(input_type)  # Use router to get the model
            if model:
                try:
                    response = model(input_data)
                    logging.info(f"Processed input of type '{input_type}' successfully.")
                    return response
                except Exception as e:
                    logging.error(f"Error processing input: {e}")
                    self._handle_error(e)
                    return None
            elif input_type == 'text':
                return self._text_emotion_detection.detect_emotion(input_data)
            elif input_type == 'speech':
                return self._speech_emotion_detection.detect_emotion(input_data)
            elif input_type == 'image':
                return self._facial_expression_emotion_detection.detect_emotion(input_data)
            elif input_type == 'tts':
                return self._text_to_speech.text_to_speech(input_data)
            else:
                logging.error(f"No model found for input type '{input_type}'.")
                self._handle_error(f"No model found for input type '{input_type}'.")
                return None

    def _handle_error(self, error: Any):
        """
        Handles errors that occur during processing.

        Args:
            error (Any): The error or exception that occurred.
        """
        self._error_handler.log_error(str(error))
        # Implement additional error handling or recovery logic here

    def update_context(self, key: str, value: Any):
        """
        Updates the context state.

        Args:
            key (str): The context key.
            value (Any): The value to update in the context.
        """
        with self._lock:
            self._context[key] = value
        logging.info(f"Context updated: {key} = {value}")

    def start(self):
        """
        Starts the controller by initiating any required components or workflows.
        """
        self._scheduler.run()
        logging.info("Controller started.")

    def stop(self):
        """
        Stops the controller by terminating any ongoing components or workflows.
        """
        self._scheduler.stop()
        logging.info("Controller stopped.")

if __name__ == "__main__":
    # Example usage of Controller
    controller = Controller()

    # Add models to the controller
    controller.add_model('TextModel', controller._text_emotion_detection.detect_emotion)
    controller.add_model('SpeechModel', controller._speech_emotion_detection.detect_emotion)
    controller.add_model('FacialExpressionModel', controller._facial_expression_emotion_detection.detect_emotion)
    controller.add_model('TextToSpeech', controller._text_to_speech.text_to_speech)

    # Process inputs
    print(controller.process_input("Hello, this is a text input.", 'text'))
    print(controller.process_input("path_to_audio_file.wav", 'speech'))
    print(controller.process_input("path_to_image_file.jpg", 'image'))
    audio_file = controller.process_input("Hello, welcome to River Song!", 'tts')
    print(f"Generated audio file: {audio_file}")

    # Start and stop the controller
    try:
        controller.start()
    except KeyboardInterrupt:
        controller.stop()
