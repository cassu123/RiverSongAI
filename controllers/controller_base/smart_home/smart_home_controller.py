# smart_home/smart_home_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class SmartHomeController(ControllerBase):
    def __init__(self):
        """
        Initializes the SmartHomeController with the API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('SMART_HOME_API_KEY')
        self.base_url = "https://api.smarthomeplatform.com/v1/"
        
        if not self.api_key:
            self.logger.error("Smart Home API key not found in environment variables.")
            raise ValueError("Smart Home API key is missing.")
        
        self.logger.info("SmartHomeController initialized with API key.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific smart home-related task, such as controlling a device or checking device status.

        Args:
            task_name (str): The name of the task to execute (e.g., 'control_device', 'check_device_status').
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task (e.g., device ID, action).
        """
        try:
            self.logger.info(f"Executing smart home task '{task_name}' for user '{user_id}'.")
            if task_name == "control_device":
                if task_data:
                    self.control_device(task_data.get("device_id"), task_data.get("action"), user_id)
                else:
                    self.logger.error("Missing task data for 'control_device' task.")
            elif task_name == "check_device_status":
                if task_data:
                    self.check_device_status(task_data.get("device_id"), user_id)
                else:
                    self.logger.error("Missing task data for 'check_device_status' task.")
            else:
                self.logger.error(f"Unknown smart home task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def control_device(self, device_id: str, action: str, user_id: Optional[str] = None):
        """
        Sends a command to control a smart home device.

        Args:
            device_id (str): The ID of the device to control.
            action (str): The action to perform (e.g., 'turn_on', 'turn_off').
            user_id (Optional[str]): The ID of the user requesting the control.
        """
        endpoint = f"{self.base_url}/devices/{device_id}/actions"
        data = {
            "action": action,
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, method="POST", data=data)
        
        if response:
            self.logger.info(f"Device '{device_id}' controlled successfully for user '{user_id}' with action '{action}'.")
        else:
            self.logger.error(f"Failed to control device '{device_id}' for user '{user_id}'.")

    def check_device_status(self, device_id: str, user_id: Optional[str] = None):
        """
        Checks the status of a smart home device.

        Args:
            device_id (str): The ID of the device to check.
            user_id (Optional[str]): The ID of the user requesting the status.
        """
        endpoint = f"{self.base_url}/devices/{device_id}/status"
        params = {
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)
        
        if response:
            self.logger.info(f"Device status for '{device_id}' for user '{user_id}': {response}")
        else:
            self.logger.error(f"Failed to check status of device '{device_id}' for user '{user_id}'.")

    def _make_api_request(self, endpoint: str, method: str = "GET", params: Optional[Dict] = None, data: Optional[Dict] = None) -> Optional[Dict]:
        """
        Makes an API request to the smart home platform.

        Args:
            endpoint (str): The API endpoint to call.
            method (str): The HTTP method (GET, POST, etc.).
            params (Optional[Dict]): URL parameters for GET requests.
            data (Optional[Dict]): The data for POST/PUT requests.

        Returns:
            Optional[Dict]: The JSON response from the API or None if an error occurs.
        """
        try:
            if method == "GET":
                response = requests.get(endpoint, params=params)
            elif method == "POST":
                response = requests.post(endpoint, json=data)
            else:
                self.logger.error(f"Unsupported HTTP method: {method}")
                return None

            response.raise_for_status()
            self.logger.info(f"API request to {endpoint} successful.")
            return response.json()

        except requests.exceptions.HTTPError as e:
            self.logger.error(f"HTTP error occurred: {e}")
            self._handle_error(e)
        except requests.exceptions.ConnectionError as e:
            self.logger.error(f"Connection error occurred: {e}")
            self._handle_error(e)
        except requests.exceptions.Timeout as e:
            self.logger.error(f"Request timed out: {e}")
            self._handle_error(e)
        except requests.exceptions.RequestException as e:
            self.logger.error(f"API request error: {e}")
            self._handle_error(e)

        return None

    def _handle_error(self, error: Exception, user_id: Optional[str] = None):
        """
        Handles errors by logging them and possibly notifying users.

        Args:
            error (Exception): The error encountered.
            user_id (Optional[str]): The ID of the user associated with the error (if applicable).
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic could be added here.
