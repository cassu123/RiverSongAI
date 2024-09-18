# facebook/facebook_controller.py
import os
import logging
import time
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

# Constants
MAX_RETRIES = 3
RETRY_DELAY = 60  # Retry delay in seconds for rate limit issues

class FacebookController(ControllerBase):
    def __init__(self):
        """
        Initializes the FacebookController with API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('FACEBOOK_API_KEY')

        if not self.api_key:
            self.logger.error("Facebook API key not found in environment variables.")
            raise ValueError("Facebook API key is missing.")
        
        self.base_url = "https://graph.facebook.com/v12.0/"
        self.logger.info("FacebookController initialized.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[dict] = None):
        """
        Executes a specific Facebook-related task.
        
        Args:
            task_name (str): The name of the task to execute.
            user_id (Optional[str]): The ID of the user initiating the task (if applicable).
            task_data (Optional[dict]): Additional data required for the task (e.g., post details).
        """
        try:
            self.logger.info(f"Executing Facebook task '{task_name}' for user '{user_id}'.")
            if task_name == "post_status":
                if task_data:
                    self.post_status(task_data, user_id)
                else:
                    self.logger.error("Missing task data for 'post_status' task.")
            elif task_name == "get_posts":
                self.get_posts(user_id)
            else:
                self.logger.error(f"Unknown Facebook task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def post_status(self, task_data: dict, user_id: Optional[str] = None):
        """
        Posts a status update to Facebook.

        Args:
            task_data (dict): The data for the post (e.g., message, page ID).
            user_id (Optional[str]): The ID of the user making the post.
        """
        endpoint = f"{self.base_url}{task_data.get('page_id')}/feed"
        data = {
            "message": task_data.get("message"),
            "access_token": self.api_key
        }
        response = self._make_api_request(endpoint, method="POST", data=data)
        
        if response:
            self.logger.info(f"Status posted successfully for user '{user_id}' with response: {response}")
        else:
            self.logger.error(f"Failed to post status for user '{user_id}'.")

    def get_posts(self, user_id: Optional[str] = None):
        """
        Retrieves posts from Facebook.

        Args:
            user_id (Optional[str]): The ID of the user requesting the posts.
        """
        endpoint = f"{self.base_url}/me/feed"
        params = {
            "access_token": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)
        
        if response:
            self.logger.info(f"Posts retrieved for user '{user_id}': {response}")
            # Process the retrieved posts as needed
        else:
            self.logger.error(f"Failed to retrieve posts for user '{user_id}'.")

    def _make_api_request(self, endpoint: str, method: str = "GET", params: Optional[dict] = None, data: Optional[dict] = None) -> Optional[dict]:
        """
        Makes an API request to Facebook's Graph API.

        Args:
            endpoint (str): The API endpoint to call.
            method (str): The HTTP method (GET, POST, etc.).
            params (Optional[dict]): URL parameters for GET requests.
            data (Optional[dict]): The data for POST/PUT requests.

        Returns:
            Optional[dict]: The JSON response from the API or None if an error occurs.
        """
        headers = {
            "Content-Type": "application/json"
        }

        for attempt in range(MAX_RETRIES):
            try:
                response = requests.request(method, endpoint, headers=headers, params=params, json=data)
                response.raise_for_status()
                self.logger.info(f"API request to {endpoint} succeeded.")
                return response.json()
            except requests.exceptions.RequestException as e:
                self.logger.error(f"Facebook API request failed (Attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                if "rate limit" in str(e).lower() and attempt < MAX_RETRIES - 1:
                    self.logger.warning(f"Rate limit exceeded. Retrying in {RETRY_DELAY} seconds.")
                    time.sleep(RETRY_DELAY)
                else:
                    self.logger.error(f"Max retries reached. API request failed.")
                    break

        return None

    def _handle_error(self, error: Exception, user_id: Optional[str] = None):
        """
        Handles errors by logging them and possibly notifying users.

        Args:
            error (Exception): The error encountered.
            user_id (Optional[str]): The ID of the user associated with the error (if applicable).
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Optionally handle the error further (e.g., notify the user, retry logic, etc.)
