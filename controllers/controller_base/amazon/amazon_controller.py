# amazon/amazon_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class AmazonController(ControllerBase):
    def __init__(self):
        """
        Initializes the AmazonController with environment variables and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('AMAZON_API_KEY')

        if not self.api_key:
            self.logger.error("Amazon API key not found in environment variables.")
            raise ValueError("Amazon API key is missing.")

        self.base_url = "https://api.amazon.com/"
        self.logger.info("AmazonController initialized.")

    def execute(self, task_name: str, user_id: Optional[str] = None):
        """
        Executes a task for Amazon operations.

        Args:
            task_name (str): The name of the task to execute.
            user_id (Optional[str]): The ID of the user initiating the task (if applicable).
        """
        try:
            self.logger.info(f"Executing Amazon task '{task_name}' for user '{user_id}'.")
            task_dispatcher = {
                "fetch_product_data": self.fetch_product_data,
                "update_inventory": self.update_inventory
            }

            task_func = task_dispatcher.get(task_name)
            if task_func:
                task_func(user_id)
            else:
                self.logger.error(f"Unknown task: {task_name}")

        except Exception as e:
            self._handle_error(e, user_id)

    def fetch_product_data(self, user_id: Optional[str] = None):
        """
        Fetches product data from Amazon.

        Args:
            user_id (Optional[str]): The ID of the user requesting product data (if applicable).
        """
        endpoint = f"{self.base_url}products"
        response = self._make_api_request(endpoint)

        if response:
            self.logger.info(f"Product data fetched for user '{user_id}': {response}")
            # Process product data here
        else:
            self.logger.error(f"Failed to fetch product data for user '{user_id}'.")

    def update_inventory(self, user_id: Optional[str] = None):
        """
        Updates inventory data on Amazon.

        Args:
            user_id (Optional[str]): The ID of the user requesting inventory update (if applicable).
        """
        endpoint = f"{self.base_url}inventory"
        response = self._make_api_request(endpoint, method="POST")

        if response:
            self.logger.info(f"Inventory updated for user '{user_id}'.")
            # Process inventory update response here
        else:
            self.logger.error(f"Failed to update inventory for user '{user_id}'.")

    def _make_api_request(self, endpoint: str, method: str = "GET", data: Optional[Dict] = None) -> Optional[Dict]:
        """
        Makes an API request to Amazon.

        Args:
            endpoint (str): The API endpoint to call.
            method (str): The HTTP method (GET, POST, etc.).
            data (Optional[Dict]): The data to send in the request body for POST/PUT requests.

        Returns:
            Optional[Dict]: The JSON response from the API or None if an error occurs.
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        try:
            if method == "GET":
                response = requests.get(endpoint, headers=headers)
            elif method == "POST":
                response = requests.post(endpoint, headers=headers, json=data)
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
        # Optionally send error notification to user or further handle the error.
