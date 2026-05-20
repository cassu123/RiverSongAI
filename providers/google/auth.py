# =============================================================================
# providers/google/auth.py
#
# Google OAuth 2.0 authorization flow and credential management.
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

DEFAULT_SCOPES: List[str] = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/tasks",
]


class GoogleAuth:
    """
    Manages Google OAuth 2.0 credentials for one or more users.
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
                f"Google client secrets file not found: {self._secrets_path}"
            )

        self._storage_path.mkdir(parents=True, exist_ok=True)

    def authorize_user(self, user_id: str) -> Credentials:
        token_path = self._token_path(user_id)
        creds: Optional[Credentials] = self._load_credentials(token_path)

        if creds and creds.valid:
            return creds

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            self._save_credentials(token_path, creds)
            return creds

        flow = InstalledAppFlow.from_client_secrets_file(
            str(self._secrets_path), self._scopes
        )
        creds = flow.run_local_server(port=0)
        self._save_credentials(token_path, creds)
        return creds

    def get_credentials(self, user_id: str) -> Credentials:
        token_path = self._token_path(user_id)
        creds = self._load_credentials(token_path)

        if creds is None:
            raise RuntimeError(f"No stored token found for user '{user_id}'.")

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            self._save_credentials(token_path, creds)

        return creds

    def build_service(self, user_id: str, service_name: str, version: str):
        creds = self.get_credentials(user_id)
        return build(service_name, version, credentials=creds)

    # -------------------------------------------------------------------------
    # Web OAuth Flow
    # -------------------------------------------------------------------------

    def get_authorization_url(self, redirect_uri: str, state: Optional[str] = None) -> str:
        flow = Flow.from_client_secrets_file(
            str(self._secrets_path),
            scopes=self._scopes,
            redirect_uri=redirect_uri
        )
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            state=state,
            prompt="consent"
        )
        return auth_url

    def fetch_token_from_code(self, user_id: str, code: str, redirect_uri: str) -> Credentials:
        flow = Flow.from_client_secrets_file(
            str(self._secrets_path),
            scopes=self._scopes,
            redirect_uri=redirect_uri
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        self._save_credentials(self._token_path(user_id), creds)
        return creds

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _token_path(self, user_id: str) -> Path:
        return self._storage_path / f"{user_id}.json"

    def _load_credentials(self, token_path: Path) -> Optional[Credentials]:
        if not token_path.exists():
            return None
        try:
            with token_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            return Credentials.from_authorized_user_info(data, self._scopes)
        except Exception:
            return None

    def _save_credentials(self, token_path: Path, creds: Credentials) -> None:
        tmp_path = token_path.with_suffix(".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as fh:
                fh.write(creds.to_json())
            tmp_path.replace(token_path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise

    def save_credentials_from_dict(self, user_id: str, data: dict) -> None:
        """Manually save credential data (e.g. from a login flow) to the user's token file."""
        token_path = self._token_path(user_id)
        # We need to ensure the scopes match what the provider expects
        creds = Credentials.from_authorized_user_info(data, self._scopes)
        self._save_credentials(token_path, creds)

    def delete_credentials(self, user_id: str) -> bool:
        """Delete the user's stored token file. Returns True if deleted, False if not found."""
        token_path = self._token_path(user_id)
        if token_path.exists():
            token_path.unlink()
            return True
        return False


def _build_google_auth_from_settings() -> "GoogleAuth":
    from config.settings import get_settings
    s = get_settings()
    return GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", default="primary_user")
    args = parser.parse_args()
    auth = _build_google_auth_from_settings()
    auth.authorize_user(args.user_id)
