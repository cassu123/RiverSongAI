# Path: authentication/Google/google_auth_flow.py

import os
import json
import logging
import sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from typing import Optional, Dict, Any, Tuple

# Set up logging for this module
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# Define the scopes needed for Gmail, Calendar, etc.
# These match the scopes in your google_controller.py
DEFAULT_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly', # From google_controller.py
    'https://www.googleapis.com/auth/drive.readonly',    # From google_controller.py
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/tasks'
]

# Path to your client_secrets.json file in the project root
CLIENT_SECRETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'config_files', 'google_client_secrets.json')

class GoogleAuthFlow:
    """
    Manages the Google OAuth 2.0 authentication flow for multiple users.
    Handles authorization, token storage, and refreshing of access tokens.
    """
    def __init__(self, token_storage_path: str = "data/google_tokens", scopes: Optional[List[str]] = None):
        self.scopes = scopes if scopes is not None else DEFAULT_SCOPES
        self.token_storage_path = token_storage_path
        os.makedirs(self.token_storage_path, exist_ok=True)
        logger.info(f"GoogleAuthFlow initialized. Token storage at: {self.token_storage_path}")

    def _get_user_token_file(self, user_id: str) -> str:
        return os.path.join(self.token_storage_path, f"{user_id}.json")

    def authorize_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Initiates the OAuth 2.0 flow for a specific user to get their authorization.
        Returns credentials dictionary suitable for google.oauth2.credentials.Credentials.
        """
        creds = None
        token_file = self._get_user_token_file(user_id)

        if os.path.exists(token_file):
            try:
                creds = Credentials.from_authorized_user_file(token_file, self.scopes)
                logger.info(f"Loaded existing Google credentials for user: {user_id}")
            except Exception as e:
                logger.warning(f"Error loading existing token for {user_id}, re-authenticating: {e}")
                creds = None

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                logger.info(f"Refreshing Google access token for user: {user_id}")
                try:
                    creds.refresh(Request())
                except Exception as e:
                    logger.error(f"Error refreshing token for {user_id}, full re-auth required: {e}")
                    creds = None
            else:
                logger.info(f"Initiating new Google OAuth flow for user: {user_id}")
                try:
                    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, self.scopes)
                    creds = flow.run_local_server(port=0)
                except FileNotFoundError:
                    logger.critical(f"'{CLIENT_SECRETS_FILE}' not found. Google API authentication cannot proceed. Please ensure it's correctly placed and named.")
                    return None
                except Exception as e:
                    logger.error(f"Error during new Google OAuth flow for {user_id}: {e}")
                    return None

        if creds and creds.valid:
            try:
                creds_dict = {
                    'token': creds.token,
                    'refresh_token': creds.refresh_token,
                    'token_uri': creds.token_uri,
                    'scopes': creds.scopes,
                    'id_token': creds.id_token if hasattr(creds, 'id_token') else None
                }
                with open(token_file, 'w') as token:
                    json.dump(creds_dict, token, indent=4)
                logger.info(f"Google credentials saved for user: {user_id} to '{token_file}'.")
                return creds_dict
            except Exception as e:
                logger.error(f"Error saving Google credentials for user {user_id}: {e}")
                return None
        return None

    def get_user_gmail_service(self, user_id: str) -> Optional[Any]:
        """
        Retrieves a Google Gmail API service object for a specific user.
        This function relies on tokens already being authorized and saved.
        """
        token_file = self._get_user_token_file(user_id)
        if not os.path.exists(token_file):
            logger.warning(f"No token file found for user {user_id}. Please authorize user first.")
            return None

        try:
            creds_dict = {}
            with open(token_file, 'r') as f:
                creds_dict = json.load(f)

            # Load client_secrets to get client_id and client_secret for reconstructing Credentials
            with open(CLIENT_SECRETS_FILE, 'r') as cs_file:
                client_secrets_data = json.load(cs_file)['installed']
                client_id = client_secrets_data['client_id']
                client_secret = client_secrets_data['client_secret']

            # Reconstruct Credentials object, providing client_id and client_secret explicitly
            creds = Credentials(
                token=creds_dict.get('token'),
                refresh_token=creds_dict.get('refresh_token'),
                token_uri=creds_dict.get('token_uri'),
                client_id=client_id, # Provide from client_secrets.json
                client_secret=client_secret, # Provide from client_secrets.json
                scopes=creds_dict.get('scopes')
            )
            return build('gmail', 'v1', credentials=creds)
            logger.info(f"Gmail service built for user {user_id}.")
            return service
        except Exception as e:
            logger.error(f"Error building Gmail service for user {user_id}: {e}")
            return None

# --- Conceptual usage by a higher-level controller or main.py ---
if __name__ == "__main__":
    # Example setup: This needs your client_secrets.json file in the root
    # For testing, ensure config_files/client_secrets.json exists with your Google API credentials.
    # Also, ensure 'data/google_tokens' exists or will be created.

    # User IDs for testing (these would come from your user_management module)
    test_user_id_1 = "family_member_chris"
    test_user_id_2 = "family_member_parent"

    # Initialize the authentication flow manager
    google_auth_manager = GoogleAuthFlow(token_storage_path="data/google_tokens")

    logger.info(f"\n--- Authorizing user: {test_user_id_1} ---")
    user1_creds_dict = google_auth_manager.authorize_user(test_user_id_1)
    if user1_creds_dict:
        logger.info(f"User {test_user_id_1} authorized successfully. Tokens saved.")
        # Now use these credentials to get a service
        gmail_service_user1 = google_auth_manager.get_user_gmail_service(test_user_id_1)
        if gmail_service_user1:
            logger.info(f"Gmail service for {test_user_id_1} is ready.")
            # Example: Fetching messages (requires gmail.readonly scope)
            # try:
            #     messages_response = gmail_service_user1.users().messages().list(userId='me', maxResults=1).execute()
            #     logger.info(f"Fetched Gmail messages for {test_user_id_1}: {messages_response}")
            # except HttpError as e:
            #     logger.error(f"Error fetching messages for {test_user_id_1}: {e}")
        else:
            logger.error(f"Failed to get Gmail service for {test_user_id_1}.")
    else:
        logger.error(f"Failed to authorize user: {test_user_id_1}. Check logs for details.")

    logger.info(f"\n--- Authorizing user: {test_user_id_2} ---")
    user2_creds_dict = google_auth_manager.authorize_user(test_user_id_2)
    if user2_creds_dict:
        logger.info(f"User {test_user_id_2} authorized successfully. Tokens saved.")
        gmail_service_user2 = google_auth_manager.get_user_gmail_service(test_user_id_2)
        if gmail_service_user2:
            logger.info(f"Gmail service for {test_user_id_2} is ready.")
        else:
            logger.error(f"Failed to get Gmail service for {test_user_id_2}.")
    else:
        logger.error(f"Failed to authorize user: {test_user_id_2}. Check logs for details.")

    # You could also consider a function here to generate initial client_secrets.json if it doesn't exist.
    # from google_auth_oauthlib.flow import InstalledAppFlow
    # if not os.path.exists(CLIENT_SECRETS_FILE):
    #     logger.warning(f"Client secrets file not found at {CLIENT_SECRETS_FILE}. This is needed for OAuth flow.")
    #     # Guide user to Google Cloud Console to download client_secrets.json