# =============================================================================
# providers/google/auth.py
#
# Google OAuth 2.0 authorization flow and credential management.
#
# Responsibilities:
#   - Initiate the InstalledAppFlow (browser-based desktop OAuth) for a user.
#   - Persist tokens as JSON files under GOOGLE_TOKEN_STORAGE_PATH so users
#     are not re-prompted on every startup.
#   - Automatically refresh expired tokens using the stored refresh_token.
#   - Return ready-to-use google.oauth2.credentials.Credentials objects that
#     googleapiclient.discovery.build() accepts directly.
#
# Token storage layout:
#   {GOOGLE_TOKEN_STORAGE_PATH}/
#     {user_id}.json    -- one file per user, contains access + refresh tokens
#
# Usage (one-time per user, run from project root):
#   python -m providers.google.auth --user-id primary_user
#
# Porting notes (fixed from authentication/google/google_auth_flow.py):
#   1. Added missing `List` import from typing (was used in __init__ signature
#      but never imported, causing a NameError at runtime).
#   2. Fixed unreachable code in get_credentials(): original returned the
#      service object before a log line and a second return statement. Fixed
#      by assigning to a variable, logging, then returning once.
# =============================================================================

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import List, Optional

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow, Flow
from googleapiclient.discovery import build


logger = logging.getLogger(__name__)

# Scopes requested during initial OAuth flow.
# If these are changed, delete existing token files and re-authorize.
DEFAULT_SCOPES: List[str] = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/youtube",
]


class GoogleAuth:
    """
    Manages Google OAuth 2.0 credentials for one or more users.

    Credentials are loaded from disk on each call and refreshed automatically
    when expired. The token files are written atomically by replacing the file
    only after the full JSON is written, so a crash mid-write cannot corrupt
    an existing token.

    Args:
        client_secrets_path: Path to the client_secret_*.json file downloaded
            from Google Cloud Console (Desktop app type).
        token_storage_path: Directory where per-user token JSON files are stored.
            Created automatically if it does not exist.
        scopes: OAuth scopes to request. Defaults to DEFAULT_SCOPES.
    """

    def __init__(
        self,
        client_secrets_path: str,
        token_storage_path: str,
        scopes: Optional[List[str]] = None,
    ) -> None:
        self._secrets_path = Path(client_secrets_path)
        self._storage_path = Path(token_storage_path)
        self._scopes: List[str] = scopes if scopes is not None else DEFAULT_SCOPES

        if not self._secrets_path.exists():
            raise FileNotFoundError(
                f"Google client secrets file not found: {self._secrets_path}\n"
                "Download it from Google Cloud Console -> APIs & Services -> Credentials."
            )

        self._storage_path.mkdir(parents=True, exist_ok=True)
        logger.info(
            "GoogleAuth initialized. Token storage: %s", self._storage_path
        )

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def authorize_user(self, user_id: str) -> Credentials:
        """
        Run the full OAuth 2.0 authorization flow for a user.

        If a valid (or refreshable) token already exists on disk, the flow is
        skipped and the existing credentials are returned immediately. Otherwise
        the browser-based InstalledAppFlow is launched and the user must grant
        access.

        Args:
            user_id: Unique identifier for this user. Determines the token file
                name on disk ({token_storage_path}/{user_id}.json).

        Returns:
            google.oauth2.credentials.Credentials ready for use with any Google
            API client built via googleapiclient.discovery.build().

        Raises:
            FileNotFoundError: If the client secrets file is missing.
            google.auth.exceptions.GoogleAuthError: If the OAuth flow fails.
        """
        token_path = self._token_path(user_id)
        creds: Optional[Credentials] = self._load_credentials(token_path)

        if creds and creds.valid:
            logger.debug("Loaded valid credentials for user '%s'.", user_id)
            return creds

        if creds and creds.expired and creds.refresh_token:
            logger.info("Refreshing expired credentials for user '%s'.", user_id)
            creds.refresh(Request())
            self._save_credentials(token_path, creds)
            return creds

        # No usable token -- run the browser-based flow.
        logger.info(
            "No valid credentials for user '%s'. Launching OAuth flow.", user_id
        )
        flow = InstalledAppFlow.from_client_secrets_file(
            str(self._secrets_path), self._scopes
        )
        creds = flow.run_local_server(port=0)
        self._save_credentials(token_path, creds)
        logger.info("Authorization complete for user '%s'.", user_id)
        return creds

    def get_credentials(self, user_id: str) -> Credentials:
        """
        Return valid credentials for a user, refreshing if necessary.

        Unlike authorize_user(), this method does NOT launch the browser flow.
        If no stored token exists the user must call authorize_user() first.

        Args:
            user_id: Unique user identifier.

        Returns:
            Valid Credentials object.

        Raises:
            RuntimeError: If no stored token is found for this user.
            google.auth.exceptions.RefreshError: If the refresh token is revoked.
        """
        token_path = self._token_path(user_id)
        creds = self._load_credentials(token_path)

        if creds is None:
            raise RuntimeError(
                f"No stored token found for user '{user_id}'. "
                "Run authorize_user() first to complete the OAuth flow."
            )

        if creds.expired and creds.refresh_token:
            logger.info("Refreshing credentials for user '%s'.", user_id)
            creds.refresh(Request())
            self._save_credentials(token_path, creds)

        return creds

    def build_service(self, user_id: str, service_name: str, version: str):
        """
        Build and return a Google API service client for a given user.

        Args:
            user_id: Unique user identifier.
            service_name: Google API name, e.g. 'gmail', 'calendar', 'drive'.
            version: API version string, e.g. 'v1', 'v3'.

        Returns:
            A googleapiclient Resource object ready for API calls.

        Raises:
            RuntimeError: If no stored token is found for this user.
        """
        creds = self.get_credentials(user_id)
        service = build(service_name, version, credentials=creds)
        logger.debug(
            "Built '%s' v%s service for user '%s'.", service_name, version, user_id
        )
        return service

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _token_path(self, user_id: str) -> Path:
        """Return the path to the token file for a given user_id."""
        return self._storage_path / f"{user_id}.json"

    def _load_credentials(self, token_path: Path) -> Optional[Credentials]:
        """Load Credentials from a token JSON file. Returns None if missing."""
        if not token_path.exists():
            return None
        try:
            with token_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            creds = Credentials.from_authorized_user_info(data, self._scopes)
            return creds
        except Exception as exc:
            logger.warning(
                "Could not load credentials from '%s': %s. Will re-authorize.",
                token_path,
                exc,
            )
            return None

    def _save_credentials(self, token_path: Path, creds: Credentials) -> None:
        """Persist Credentials to a token JSON file."""
        tmp_path = token_path.with_suffix(".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
            tmp_path.replace(token_path)
            logger.debug("Token saved to '%s'.", token_path)
        except Exception as exc:
            logger.error("Failed to save token to '%s': %s", token_path, exc)
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise


# =============================================================================
# Standalone authorization helper
# Run: python -m providers.google.auth --user-id primary_user
# =============================================================================

def _build_google_auth_from_settings() -> "GoogleAuth":
    """Build a GoogleAuth instance using current application settings."""
    from config.settings import get_settings
    s = get_settings()
    return GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(
        description="Authorize a user for Google Services."
    )
    parser.add_argument(
        "--user-id",
        default="primary_user",
        help="User ID to authorize (default: primary_user)",
    )
    args = parser.parse_args()

    auth = _build_google_auth_from_settings()
    credentials = auth.authorize_user(args.user_id)
    print(f"Authorization complete for user '{args.user_id}'.")
    print(f"Token saved to: {auth._token_path(args.user_id)}")
: %s. Will re-authorize.",
                token_path,
                exc,
            )
            return None

    def _save_credentials(self, token_path: Path, creds: Credentials) -> None:
        """Persist Credentials to a token JSON file."""
        tmp_path = token_path.with_suffix(".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
            tmp_path.replace(token_path)
            logger.debug("Token saved to '%s'.", token_path)
        except Exception as exc:
            logger.error("Failed to save token to '%s': %s", token_path, exc)
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise


# =============================================================================
# Standalone authorization helper
# Run: python -m providers.google.auth --user-id primary_user
# =============================================================================

def _build_google_auth_from_settings() -> "GoogleAuth":
    """Build a GoogleAuth instance using current application settings."""
    from config.settings import get_settings
    s = get_settings()
    return GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(
        description="Authorize a user for Google Services."
    )
    parser.add_argument(
        "--user-id",
        default="primary_user",
        help="User ID to authorize (default: primary_user)",
    )
    args = parser.parse_args()

    auth = _build_google_auth_from_settings()
    credentials = auth.authorize_user(args.user_id)
    print(f"Authorization complete for user '{args.user_id}'.")
    print(f"Token saved to: {auth._token_path(args.user_id)}")
