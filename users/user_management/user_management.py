# Path: users/user_management/user_management.py

import logging
import json
import os
import sys # Import sys for path handling
from typing import Optional, Dict, Any

# Set up logging for this module
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# Path to a JSON file for storing user data.
# In a production system, this would be replaced with a database connection.
# Use os.path.join and os.path.dirname(os.path.abspath(__file__))
# to create a path relative to the current script's location,
# navigating up two directories (..) and then down into 'data'.
USER_DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'user_data.json')

class UserManagement:
    def __init__(self):
        """
        Manages user data, including secure storage and retrieval of credentials.
        For this example, we're using a JSON file for simplicity. In a real system,
        a database (e.g., MySQL, PostgreSQL, MongoDB) would be used for robust, encrypted storage.
        """
        self.user_data = self._load_user_data()

    def _load_user_data(self) -> Dict[str, Any]:
        """Loads user data from a persistent storage (currently a JSON file)."""
        try:
            # Ensure the data directory exists
            data_dir = os.path.dirname(USER_DATA_FILE)
            os.makedirs(data_dir, exist_ok=True)

            with open(USER_DATA_FILE, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            logger.info(f"User data file '{USER_DATA_FILE}' not found. Creating a new one.")
            return {} # Start with an empty dictionary
        except json.JSONDecodeError:
            logger.error(f"Error decoding JSON from '{USER_DATA_FILE}'. Returning empty user data.")
            return {}
        except Exception as e:
            logger.error(f"An unexpected error occurred while loading user data: {e}")
            return {}

    def _save_user_data(self):
        """Saves user data to the persistent storage (currently a JSON file)."""
        try:
            # Ensure the data directory exists before saving
            data_dir = os.path.dirname(USER_DATA_FILE)
            os.makedirs(data_dir, exist_ok=True)

            with open(USER_DATA_FILE, 'w') as f:
                json.dump(self.user_data, f, indent=4)
            logger.info(f"User data saved to '{USER_DATA_FILE}'.")
        except Exception as e:
            logger.error(f"Failed to save user data to '{USER_DATA_FILE}': {e}")

    def create_user(self, user_id: str, initial_data: Dict[str, Any]) -> bool:
        """
        Creates a new user entry.
        For simplicity, this example doesn't include password hashing for user passwords.
        User passwords should be hashed using bcrypt or similar before storing.
        """
        if user_id in self.user_data:
            logger.warning(f"User with ID '{user_id}' already exists.")
            return False
        self.user_data[user_id] = initial_data
        self._save_user_data()
        logger.info(f"Created user with ID '{user_id}'.")
        return True

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves user data for a given user ID."""
        if user_id in self.user_data:
            return self.user_data[user_id]
        else:
            logger.warning(f"User with ID '{user_id}' not found.")
            return None

    def update_user(self, user_id: str, update_data: Dict[str, Any]) -> bool:
        """Updates user data for a given user ID."""
        if user_id in self.user_data:
            self.user_data[user_id].update(update_data)
            self._save_user_data()
            logger.info(f"Updated user data for ID '{user_id}'.")
            return True
        else:
            logger.warning(f"User with ID '{user_id}' not found. Cannot update.")
            return False

    def delete_user(self, user_id: str) -> bool:
        """Deletes user data for a given user ID."""
        if user_id in self.user_data:
            del self.user_data[user_id]
            self._save_user_data()
            logger.info(f"Deleted user with ID '{user_id}'.")
            return True
        else:
            logger.warning(f"User with ID '{user_id}' not found. Cannot delete.")
            return False

    def get_user_google_credentials(self, user_id: str) -> Optional[Dict[str, str]]:
        """
        Retrieves a user's Google OAuth 2.0 credentials (access_token, refresh_token, etc.).
        This function assumes that the user's data structure has a 'google_credentials' field.
        """
        user_data = self.get_user(user_id)
        if user_data and 'google_credentials' in user_data:
            logger.debug(f"Retrieved Google credentials for user '{user_id}'.")
            return user_data['google_credentials']
        else:
            logger.warning(f"No Google credentials found for user '{user_id}'.")
            return None

    def store_user_google_credentials(self, user_id: str, credentials: Dict[str, str]) -> bool:
        """
        Stores a user's Google OAuth 2.0 credentials.
        This function will update the 'google_credentials' field within the user's data.
        """
        user_data = self.get_user(user_id)
        if user_data:
            user_data['google_credentials'] = credentials
            # Pass the updated user_data back to the generic update_user method
            return self.update_user(user_id, user_data)
        else:
            logger.warning(f"User with ID '{user_id}' not found. Cannot store Google credentials.")
            return False

# Example Usage (This would typically be called from main.py or a setup script)
if __name__ == "__main__":
    logger.info("--- UserManagement Module Test ---")
    user_manager = UserManagement()

    # Clear existing data for clean test run
    if os.path.exists(USER_DATA_FILE):
        os.remove(USER_DATA_FILE)
        logger.info(f"Cleaned up existing test data file: {USER_DATA_FILE}")
    user_manager = UserManagement() # Re-initialize after cleaning

    # Example 1: Create a user
    logger.info("\n--- Creating User 'chris_123' ---")
    user_data_1 = {'name': 'Chris', 'email': 'chris@example.com', 'roles': ['manager', 'parent']}
    user_manager.create_user('chris_123', user_data_1)

    # Example 2: Try to create same user again (should warn)
    logger.info("\n--- Attempting to Re-create User 'chris_123' ---")
    user_manager.create_user('chris_123', {'name': 'Chris Duplicate'})

    # Example 3: Create another user
    logger.info("\n--- Creating User 'alex_456' ---")
    user_manager.create_user('alex_456', {'name': 'Alex', 'email': 'alex@example.com', 'roles': ['child']})

    # Example 4: Store Google credentials for 'chris_123'
    logger.info("\n--- Storing Google Credentials for 'chris_123' ---")
    example_creds = {
        'token': 'TEST_ACCESS_TOKEN_CHRIS',
        'refresh_token': 'TEST_REFRESH_TOKEN_CHRIS',
        'token_uri': 'https://oauth2.googleapis.com/token',
        'scopes': ['https://www.googleapis.com/auth/gmail.readonly']
    }
    user_manager.store_user_google_credentials('chris_123', example_creds)

    # Example 5: Retrieve Google credentials for 'chris_123'
    logger.info("\n--- Retrieving Google Credentials for 'chris_123' ---")
    chris_creds = user_manager.get_user_google_credentials('chris_123')
    if chris_creds:
        logger.info(f"Retrieved Chris's Google Credentials: {chris_creds['token'][:10]}...")
    else:
        logger.warning("Could not retrieve Chris's Google credentials.")

    # Example 6: Update user data for 'alex_456'
    logger.info("\n--- Updating User 'alex_456' ---")
    user_manager.update_user('alex_456', {'age': 10, 'preferences': {'lighting': 'dim'}})

    # Example 7: Get updated user data for 'alex_456'
    logger.info("\n--- Retrieving Updated User 'alex_456' ---")
    alex_data = user_manager.get_user('alex_456')
    if alex_data:
        logger.info(f"Alex's data: {alex_data}")

    # Example 8: Try to retrieve credentials for non-existent user
    logger.info("\n--- Retrieving Credentials for Non-Existent User 'non_user' ---")
    non_user_creds = user_manager.get_user_google_credentials('non_user')

    # Example 9: Delete a user
    logger.info("\n--- Deleting User 'alex_456' ---")
    user_manager.delete_user('alex_456')

    # Example 10: Verify deletion
    logger.info("\n--- Verifying Deletion of 'alex_456' ---")
    if not user_manager.get_user('alex_456'):
        logger.info("'alex_456' successfully deleted.")

    logger.info("\n--- UserManagement Module Test Complete ---")