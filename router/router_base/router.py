import logging
from typing import Any, Callable, Dict, Optional
from threading import Lock

# ---------------------------------------------------------------------------
# Controller imports
# Fixed: package name was 'controller' (wrong), correct name is 'controllers'.
# Each submodule also needed its full dotted path.
# ---------------------------------------------------------------------------
from controllers.communication.communication import Communication
from controllers.resource_manager.resource_manager import ResourceManager
from controllers.scheduler.scheduler import Scheduler
from controllers.security.security import SecurityManager

# ErrorHandler: the file exists at controllers/error_handler/error_handler.py
# but defines only module-level functions, not an ErrorHandler class.
# Stubbed here so this module remains importable until a class is added.
try:
    from controllers.error_handler.error_handler import ErrorHandler
except ImportError:
    class ErrorHandler:  # type: ignore[no-redef]
        """Stub -- controllers/error_handler/error_handler.py has no ErrorHandler class."""
        def handle_error(self, error: Exception) -> None:
            raise NotImplementedError("ErrorHandler class not yet implemented in error_handler.py")

# ---------------------------------------------------------------------------
# AI module imports
# Fixed: TextToSpeech path corrected to its actual location.
# The remaining four classes do not exist anywhere in the codebase.
# Each is stubbed with a NotImplementedError so this file stays importable.
# Replace each stub import with the real path when the module is implemented.
# ---------------------------------------------------------------------------
from ai_modules.output.text_to_speech.text_to_speech_ai import TextToSpeech

try:
    from ai_modules.input.biometric_recognition.voice_commands.voice_commands_ai import SpeechRecognitionAI
except ImportError:
    class SpeechRecognitionAI:  # type: ignore[no-redef]
        """Stub -- no SpeechRecognitionAI class found in ai_modules."""
        def __init__(self):
            raise NotImplementedError("SpeechRecognitionAI not yet implemented")

try:
    from ai_modules.models.medical_image_analysis.medical_notes.medical_notes_ai import MedicalImageAnalysisAI
except ImportError:
    class MedicalImageAnalysisAI:  # type: ignore[no-redef]
        """Stub -- no MedicalImageAnalysisAI class found in ai_modules."""
        def __init__(self):
            raise NotImplementedError("MedicalImageAnalysisAI not yet implemented")

try:
    from ai_modules.models.Gemini import GeminiAI
except ImportError:
    class GeminiAI:  # type: ignore[no-redef]
        """Stub -- no GeminiAI class found in ai_modules.models.Gemini."""
        def __init__(self):
            raise NotImplementedError("GeminiAI not yet implemented")

try:
    from ai_modules.input.smart_home_inputs.appliance_control.appliance_control import SmartHomeIntegration
except ImportError:
    class SmartHomeIntegration:  # type: ignore[no-redef]
        """Stub -- no SmartHomeIntegration class found in ai_modules."""
        def __init__(self):
            raise NotImplementedError("SmartHomeIntegration not yet implemented")

try:
    from ai_modules.models.image_video.video_analytics.video_analytics_ai import VisionAI
except ImportError:
    class VisionAI:  # type: ignore[no-redef]
        """Stub -- no VisionAI class found in ai_modules."""
        def __init__(self):
            raise NotImplementedError("VisionAI not yet implemented")

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class Router:
    """
    A unified Router class that combines both basic task routing and advanced AI module management.
    It also supports security checks, scheduling, and thread safety.
    """

    def __init__(self):
        self.routes: Dict[str, Callable] = {}  # Store routes for task handlers
        self.ai_modules: Dict[str, Any] = {}  # Store all AI module instances
        self.lock = Lock()  # Ensure thread safety
        self.communication = Communication()  # Initialize communication component
        self.error_handler = ErrorHandler()  # Initialize error handler
        self.resource_manager = ResourceManager()  # Initialize resource manager
        self.scheduler = Scheduler()  # Initialize scheduler component
        self.security_manager = SecurityManager()  # Initialize security manager
        logging.info("Router initialized.")

    def add_route(self, task_type: str, handler: Callable):
        """Add a route to a specific task."""
        with self.lock:
            self.routes[task_type] = handler
        logging.info(f"Task route added for type '{task_type}'.")

    def route(self, task_type: str, **kwargs):
        """Route a task based on the task type."""
        with self.lock:
            handler = self.routes.get(task_type)
        
        if not handler:
            logging.error(f"No handler found for task type: {task_type}")
            return None
        
        try:
            logging.info(f"Routing task: {task_type}")
            return handler(**kwargs)
        except Exception as e:
            logging.error(f"Error routing task {task_type}: {e}")
            self.error_handler.handle_error(e)
            return None

    def register_ai_module(self, module_name: str, module_instance: Any):
        """Registers an AI module instance with the router."""
        with self.lock:
            self.ai_modules[module_name] = module_instance
        logging.info(f"AI Module '{module_name}' registered.")

    def initialize_all_modules(self):
        """Initializes all AI modules managed by the router."""
        try:
            self.register_ai_module('TextToSpeech', TextToSpeech())
            self.register_ai_module('SpeechRecognitionAI', SpeechRecognitionAI())
            self.register_ai_module('MedicalImageAnalysisAI', MedicalImageAnalysisAI())
            self.register_ai_module('GeminiAI', GeminiAI())
            self.register_ai_module('SmartHomeIntegration', SmartHomeIntegration())
            self.register_ai_module('VisionAI', VisionAI())
            logging.info("All AI modules initialized successfully.")
        except Exception as e:
            logging.error(f"Error initializing AI modules: {e}")
            self.error_handler.handle_error(e)

    def execute_task(self, task_name: str, *args, **kwargs):
        """Execute a task by routing it to the appropriate AI module."""
        model = self.route(task_name)
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
        """Executes an operation with security checks."""
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
        """Gracefully shuts down the router and all managed AI modules."""
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
