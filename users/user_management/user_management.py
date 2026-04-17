"""
File: users/user_management/user_management.py
Purpose: Manages user data storage and retrieval.
Author: River Song Project
"""

import logging
import json
import os
from typing import Optional, Dict, Any

# Set up logging for this module
logger = logging.getLogger(__name__)

# Path to a JSON file for storing user data.
USER_DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'user_data.json')

class UserManagement:
    """
    Manages user data operations including creation, retrieval, updates, and deletion.
    Utilizes a local JSON file for data persistence.
    """

    def __init__(self) -> None:
        """
        Initialize the UserManagement system and load existing user data.
        """
        self.user_data: Dict[str, Any] = self._load_user_data()

    def _load_user_data(self) -> Dict[str, Any]:
        """
        Load user data from persistent storage (JSON file).
        
        Returns:
            Dict[str, Any]: A dictionary containing all stored user data.
        """
        try:
            data_dir = os.path.dirname(USER_DATA_FILE)
            os.makedirs(data_dir, exist_ok=True)

            with open(USER_DATA_FILE, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            logger.info(f"User data file '{USER_DATA_FILE}' not found. Creating a new one.")
            return {}
        except json.JSONDecodeError:
            logger.error(f"Error decoding JSON from '{USER_DATA_FILE}'. Returning empty user data.")
            return {}
        except Exception as e:
            logger.error(f"An unexpected error occurred while loading user data: {e}")
            return {}

    def _save_user_data(self) -> None:
        """
        Save current user data to persistent storage (JSON file).
        """
        try:
            data_dir = os.path.dirname(USER_DATA_FILE)
            os.makedirs(data_dir, exist_ok=True)

            with open(USER_DATA_FILE, 'w') as f:
                json.dump(self.user_data, f, indent=4)
            logger.info(f"User data saved to '{USER_DATA_FILE}'.")
        except Exception as e:
            logger.error(f"Failed to save user data to '{USER_DATA_FILE}': {e}")

    def create_user(self, user_id: str, initial_data: Dict[str, Any]) -> bool:
        """
        Create a new user entry.

        Args:
            user_id (str): The unique identifier for the new user.
            initial_data (Dict[str, Any]): The starting data profile for the user.

        Returns:
            bool: True if created successfully, False if the user already exists.
        """
        if user_id in self.user_data:
            logger.warning(f"User with ID '{user_id}' already exists.")
            return False
        self.user_data[user_id] = initial_data
        self._save_user_data()
        logger.info(f"Created user with ID '{user_id}'.")
        return True

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve data for a specific user.

        Args:
            user_id (str): The unique identifier of the user to retrieve.

        Returns:
            Optional[Dict[str, Any]]: The user's data dictionary, or None if not found.
        """
        if user_id in self.user_data:
            return self.user_data[user_id]
        
        logger.warning(f"User with ID '{user_id}' not found.")
        return None

    def update_user(self, user_id: str, update_data: Dict[str, Any]) -> bool:
        """
        Update specific fields of an existing user's data.

        Args:
            user_id (str): The unique identifier of the user to update.
            update_data (Dict[str, Any]): A dictionary containing the fields to update.

        Returns:
            bool: True if the update was successful, False if the user was not found.
        """
        if user_id in self.user_data:
            self.user_data[user_id].update(update_data)
            self._save_user_data()
            logger.info(f"Updated user data for ID '{user_id}'.")
            return True
        
        logger.warning(f"User with ID '{user_id}' not found. Cannot update.")
        return False

    def delete_user(self, user_id: str) -> bool:
        """
        Delete a user from the system.

        Args:
            user_id (str): The unique identifier of the user to delete.

        Returns:
            bool: True if the deletion was successful, False if the user was not found.
        """
        if user_id in self.user_data:
            del self.user_data[user_id]
            self._save_user_data()
            logger.info(f"Deleted user with ID '{user_id}'.")
            return True
        
        logger.warning(f"User with ID '{user_id}' not found. Cannot delete.")
        return False

    def get_user_google_credentials(self, user_id: str) -> Optional[Dict[str, str]]:
        """
        Retrieve Google OAuth credentials for a specific user.

        Args:
            user_id (str): The unique identifier of the user.

        Returns:
            Optional[Dict[str, str]]: A dictionary of credentials if found, None otherwise.
        """
        user_data = self.get_user(user_id)
        if user_data and 'google_credentials' in user_data:
            logger.debug(f"Retrieved Google credentials for user '{user_id}'.")
            return user_data['google_credentials']
        
        logger.warning(f"No Google credentials found for user '{user_id}'.")
        return None

    def store_user_google_credentials(self, user_id: str, credentials: Dict[str, str]) -> bool:
        """
        Store or update Google OAuth credentials for a specific user.

        Args:
            user_id (str): The unique identifier of the user.
            credentials (Dict[str, str]): A dictionary of Google OAuth credentials.

        Returns:
            bool: True if successfully stored, False if the user was not found.
        """
        user_data = self.get_user(user_id)
        if user_data is not None: # Use 'is not None' because user_data could theoretically be an empty dict
            user_data['google_credentials'] = credentials
            return self.update_user(user_id, user_data)
        
        logger.warning(f"User with ID '{user_id}' not found. Cannot store Google credentials.")
        return False
