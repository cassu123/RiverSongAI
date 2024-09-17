from abc import ABC, abstractmethod
from logging import Logger
from typing import Any, Dict

class ControllerBase(ABC):
    """
    Base class for all controllers in a multiuser AI system.
    Provides a standard interface for implementing controllers with 
    configuration and logging.
    """

    def __init__(self, config: Dict[str, Any], logger: Logger):
        """
        Initialize the base controller with configuration and logger.

        Args:
            config (Dict[str, Any]): Configuration dictionary for the controller.
            logger (Logger): Logger instance for logging events.
        """
        self.config = config
        self.logger = logger

    @abstractmethod
    def execute(self) -> None:
        """
        Abstract method to execute the controller's tasks.
        Must be implemented by all subclasses.
        """
        pass


class AmazonController(ControllerBase):
    """
    Amazon controller class inheriting from ControllerBase.
    Implements specific logic for controlling Amazon-related tasks.
    """

    def __init__(self, config: Dict[str, Any], logger: Logger):
        """
        Initialize the Amazon controller with configuration and logger.

        Args:
            config (Dict[str, Any]): Configuration dictionary for the controller.
            logger (Logger): Logger instance for logging events.
        """
        super().__init__(config, logger)

    def execute(self) -> None:
        """
        Execute the Amazon controller's tasks.
        Contains the logic specific to Amazon tasks.
        """
        self.logger.info("Executing Amazon controller tasks.")
        # Add controller-specific logic here
