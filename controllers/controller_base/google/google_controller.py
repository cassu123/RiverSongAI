# google/google_controller.py
import os
import logging
from typing import Optional, Dict
from google.auth.transport.requests import Request
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

class GoogleController(ControllerBase):
    SCOPES = ['https://www.googleapis.com/auth/calendar.readonly',
              'https://www.googleapis.com/auth/drive.readonly',
              'https://www.googleapis.com/auth/gmail.readonly']

    def __init__(self):
        """
        Initializes the GoogleController with environment variables and OAuth credentials.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('GOOGLE_API_KEY')
        self.credentials = None
        self.logger.info("GoogleController initialized.")
        
        # Initialize OAuth flow for authentication
        self.credentials = self.authenticate_with_oauth()

    def authenticate_with_oauth(self) -> Optional[Credentials]:
        """
        Handles OAuth2 authentication to access Google APIs.

        Returns:
            Optional[Credentials]: OAuth2 credentials after successful authentication.
        """
        try:
            creds = None
            token_path = "token.json"
            if os.path.exists(token_path):
                creds = Credentials.from_authorized_user_file(token_path, self.SCOPES)

            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                else:
                    flow = InstalledAppFlow.from_client_secrets_file('credentials.json', self.SCOPES)
                    creds = flow.run_local_server(port=0)

                with open(token_path, 'w') as token:
                    token.write(creds.to_json())

            return creds
        except Exception as e:
            self.logger.error(f"Error during Google OAuth authentication: {e}")
            return None

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific Google-related task, such as interacting with Google Calendar, Google Drive, or Gmail.

        Args:
            task_name (str): The name of the task to execute.
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task.
        """
        try:
            self.logger.info(f"Executing Google task '{task_name}' for user '{user_id}'.")
            if task_name == "get_calendar_events":
                self.get_calendar_events(user_id)
            elif task_name == "get_drive_files":
                self.get_drive_files(user_id)
            elif task_name == "get_gmail_messages":
                self.get_gmail_messages(user_id)
            else:
                self.logger.error(f"Unknown Google task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def get_calendar_events(self, user_id: Optional[str] = None):
        """
        Retrieves upcoming events from Google Calendar.

        Args:
            user_id (Optional[str]): The ID of the user requesting the calendar events.
        """
        try:
            service = build('calendar', 'v3', credentials=self.credentials)
            events_result = service.events().list(calendarId='primary', maxResults=10, singleEvents=True,
                                                  orderBy='startTime').execute()
            events = events_result.get('items', [])

            if not events:
                self.logger.info(f"No upcoming events found for user '{user_id}'.")
                return

            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                self.logger.info(f"Event: {start} - {event['summary']}")
        except HttpError as error:
            self.logger.error(f"Error retrieving calendar events: {error}")
            self._handle_error(error)

    def get_drive_files(self, user_id: Optional[str] = None):
        """
        Retrieves files from Google Drive.

        Args:
            user_id (Optional[str]): The ID of the user requesting the Drive files.
        """
        try:
            service = build('drive', 'v3', credentials=self.credentials)
            results = service.files().list(pageSize=10, fields="nextPageToken, files(id, name)").execute()
            items = results.get('files', [])

            if not items:
                self.logger.info(f"No files found for user '{user_id}'.")
                return

            for item in items:
                self.logger.info(f"File found: {item['name']} (ID: {item['id']})")
        except HttpError as error:
            self.logger.error(f"Error retrieving Drive files: {error}")
            self._handle_error(error)

    def get_gmail_messages(self, user_id: Optional[str] = None):
        """
        Retrieves messages from Gmail.

        Args:
            user_id (Optional[str]): The ID of the user requesting Gmail messages.
        """
        try:
            service = build('gmail', 'v1', credentials=self.credentials)
            results = service.users().messages().list(userId='me', maxResults=10).execute()
            messages = results.get('messages', [])

            if not messages:
                self.logger.info(f"No Gmail messages found for user '{user_id}'.")
                return

            for message in messages:
                msg = service.users().messages().get(userId='me', id=message['id']).execute()
                snippet = msg.get('snippet', '')
                self.logger.info(f"Message: {snippet}")
        except HttpError as error:
            self.logger.error(f"Error retrieving Gmail messages: {error}")
            self._handle_error(error)

    def _handle_error(self, error: Exception, user_id: Optional[str] = None):
        """
        Handles errors by logging them and possibly notifying users.

        Args:
            error (Exception): The error encountered.
            user_id (Optional[str]): The ID of the user associated with the error.
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic could be added here.
