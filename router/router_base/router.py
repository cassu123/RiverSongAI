import logging
from typing import Any, Callable, Dict, Optional
from threading import Lock

# Import controller components
from controller.communication import Communication
from controller.error_handler import ErrorHandler
from controller.resource_manager import ResourceManager
from controller.scheduler import Scheduler
from controller.security import SecurityManager

# Import AI modules
from ai_modules.text_to_speech import TextToSpeech
from ai_modules.speech_recognition_ai import SpeechRecognitionAI
from ai_modules.medical_image_analysis_ai import MedicalImageAnalysisAI
from ai_modules.gemini_ai import GeminiAI
from ai_modules.smart_home_integration import SmartHomeIntegration
from ai_modules.vision_ai import VisionAI

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class Router:
    """
    Router class responsible for directing inputs to the correct AI model based on input type and managing all AI modules.
    """

    def __init__(self):
        self.routes: Dict[str, Callable] = {}
        self.ai_modules: Dict[str, Any] = {}  # Store all AI module instances
        self.lock = Lock()  # Ensure thread safety
        self.communication = Communication()  # Initialize communication component
        self.error_handler = ErrorHandler()  # Initialize error handling component
        self.resource_manager = ResourceManager()  # Initialize resource management component
        self.scheduler = Scheduler()  # Initialize scheduler component
        self.security_manager = SecurityManager()  # Initialize security manager component
        
        logging.info("Router initialized.")

    def register_ai_module(self, module_name: str, module_instance: Any):
        """
        Registers an AI module instance with the router.

        Args:
            module_name (str): The name of the AI module.
            module_instance (Any): The instance of the AI module to register.
        """
        with self.lock:
            self.ai_modules[module_name] = module_instance
        logging.info(f"AI Module '{module_name}' registered in router.")

    def update_model(self, model_name: str, model: Callable):
        """
        Updates the router with a new model.

        Args:
            model_name (str): The name of the model.
            model (Callable): The callable model function or class.
        """
        with self.lock:
            self.routes[model_name] = model
        logging.info(f"Model '{model_name}' updated in router.")

    def remove_model(self, model_name: str):
        """
        Removes a model from the router.

        Args:
            model_name (str): The name of the model to remove.
        """
        with self.lock:
            if model_name in self.routes:
                del self.routes[model_name]
                logging.info(f"Model '{model_name}' removed from router.")
            else:
                logging.warning(f"Attempted to remove non-existent model '{model_name}' from router.")

    def route_input(self, input_type: str) -> Optional[Callable]:
        """
        Routes the input to the appropriate model based on the input type.

        Args:
            input_type (str): The type of input to route.

        Returns:
            Optional[Callable]: The model function to handle the input.
        """
        with self.lock:
            model = self.routes.get(input_type)
        if model:
            logging.info(f"Input type '{input_type}' routed to model.")
            return model
        else:
            logging.error(f"No route found for input type '{input_type}'.")
            return None

    def initialize_all_modules(self):
        """
        Initializes all AI modules managed by the router.
        """
        logging.info("Initializing all AI modules.")
        # Example: Initializing various AI modules and adding them to the router
        try:
            self.register_ai_module('TextToSpeech', TextToSpeech())
            self.register_ai_module('SpeechRecognitionAI', SpeechRecognitionAI())
            self.register_ai_module('MedicalImageAnalysisAI', MedicalImageAnalysisAI())
            self.register_ai_module('GeminiAI', GeminiAI())
            self.register_ai_module('SmartHomeIntegration', SmartHomeIntegration())
            self.register_ai_module('VisionAI', VisionAI())
            logging.info("All AI modules initialized and registered successfully.")
        except Exception as e:
            logging.error(f"Error initializing AI modules: {e}")
            self.error_handler.handle_error(e)

    def execute_task(self, task_name: str, *args, **kwargs):
        """
        Executes a task by routing it to the appropriate AI module or component.

        Args:
            task_name (str): The name of the task to execute.
            *args: Variable length argument list.
            **kwargs: Arbitrary keyword arguments.
        """
        model = self.route_input(task_name)
        if model:
            try:
                logging.info(f"Executing task '{task_name}' with model '{model.__name__}'.")
                return model(*args, **kwargs)
            except Exception as e:
                logging.error(f"Error executing task '{task_name}': {e}")
                self.error_handler.handle_error(e)
        else:
            logging.warning(f"No model found for task '{task_name}'.")

    def secure_operation(self, operation: Callable, *args, **kwargs):
        """
        Executes an operation with security checks.

        Args:
            operation (Callable): The operation to execute.
            *args: Variable length argument list.
            **kwargs: Arbitrary keyword arguments.
        """
        if self.security_manager.check_permissions(operation.__name__):
            try:
                logging.info(f"Executing secure operation '{operation.__name__}'.")
                return operation(*args, **kwargs)
            except Exception as e:
                logging.error(f"Error executing secure operation '{operation.__name__}': {e}")
                self.error_handler.handle_error(e)
        else:
            logging.warning(f"Permission denied for operation '{operation.__name__}'.")

    def shutdown(self):
        """
        Gracefully shuts down the router and all managed AI modules.
        """
        logging.info("Shutting down Router and all AI modules.")
        for module_name, module in self.ai_modules.items():
            try:
                if hasattr(module, 'shutdown'):
                    module.shutdown()
                logging.info(f"AI Module '{module_name}' shut down successfully.")
            except Exception as e:
                logging.error(f"Error shutting down AI Module '{module_name}': {e}")
                self.error_handler.handle_error(e)
        logging.info("Router shutdown complete.")

# Example usage
if __name__ == "__main__":
    router = Router()
    router.initialize_all_modules()
    # Example task execution
    router.execute_task('TextToSpeech', "Hello, world!")
    router.shutdown()
