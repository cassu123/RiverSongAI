# controller_base/controller_base.py
import logging
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
import requests

class ControllerBase(ABC):
    """
    Base class for all controllers. Defines common methods and utilities for handling tasks, errors, logging, and context.
    """

    def __init__(self):
        """
        Initializes the ControllerBase with common setup like logging and context management.
        """
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.setLevel(logging.INFO)
        
        # Dictionary to hold context or state data, shared across controllers.
        self.context: Dict[str, Any] = {}
        self.logger.info(f"{self.__class__.__name__} initialized.")
    
    @abstractmethod
    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Abstract method that must be implemented by all subclasses to execute specific tasks.
        
        Args:
            task_name (str): The name of the task to execute.
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task.
        """
        pass

    def _handle_error(self, error: Any, user_id: Optional[str] = None, task_name: Optional[str] = None, task_data: Optional[Dict] = None, retry_count: int = 0):
        """
        Handles errors that occur during task execution. Handles rate limiting by retrying if applicable.
        
        Args:
            error (Any): The error that occurred.
            user_id (Optional[str]): The ID of the user who encountered the error.
            task_name (Optional[str]): The task name that failed.
            task_data (Optional[Dict]): Additional task data passed during task execution.
            retry_count (int): The number of retries to attempt in case of rate limiting errors.
        """
        self.logger.error(f"Error occurred for user '{user_id}': {error}")

        if retry_count > 0 and isinstance(error, requests.exceptions.HTTPError) and error.response.status_code == 429:
            # Handle rate limit (HTTP 429)
            retry_after = int(error.response.headers.get("Retry-After", retry_count))
            self.logger.info(f"Rate limit exceeded. Retrying in {retry_after} seconds.")
            time.sleep(retry_after)
            self.logger.info(f"Retrying task '{task_name}' for user '{user_id}' (Retry count: {retry_count-1})")
            self.execute(task_name, user_id, task_data)
        else:
            # Non-recoverable error or no retries left
            self.logger.error(f"Error not recoverable: {error}")
            # Additional error handling or reporting can be added here

    def update_context(self, key: str, value: Any):
        """
        Updates the shared context or state with a key-value pair.
        
        Args:
            key (str): The context key.
            value (Any): The value to update in the context.
        """
        self.context[key] = value
        self.logger.info(f"Context updated: {key} = {value}")

    def get_context(self, key: str) -> Optional[Any]:
        """
        Retrieves a value from the shared context.
        
        Args:
            key (str): The context key.
            
        Returns:
            Optional[Any]: The value associated with the key, or None if not found.
        """
        return self.context.get(key)

    def clear_context(self):
        """
        Clears all entries in the context.
        """
        self.context.clear()
        self.logger.info("Context cleared.")

    def format_timestamp(self, timestamp: int) -> str:
        """
        Formats a Unix-style timestamp into a human-readable string format.
        
        Args:
            timestamp (int): The timestamp to format.
            
        Returns:
            str: The formatted timestamp string.
        """
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))

