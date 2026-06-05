# =============================================================================
# providers/google/gmail.py
#
# Gmail provider for River Song AI.
#
# Responsibilities:
#   - Fetch unread messages from a user's Gmail inbox.
#   - Read the body of a specific message.
#   - Send an email on behalf of the user.
#   - Format message summaries into natural-language strings for TTS.
#
# All methods are async-compatible. The Gmail API client is synchronous, so
# blocking calls are dispatched to a ThreadPoolExecutor.
#
# Required OAuth scope: https://www.googleapis.com/auth/gmail.modify
#
# Note on message decoding:
#   Gmail API returns message parts as base64url-encoded bytes. This module
#   handles the decoding and prefers the text/plain part when multipart emails
#   are present. HTML-only emails return a placeholder string.
# =============================================================================

from __future__ import annotations

import asyncio
import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from providers.google.auth import GoogleAuth


logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gmail")

# Maximum number of characters to include from a message body in speech output.
_BODY_PREVIEW_CHARS = 300


class GmailProvider:
    """
    Provides Gmail read and send access for a single user.

    Args:
        auth: Initialized GoogleAuth instance with valid stored credentials.
        user_id: The user whose OAuth token is used for all API calls.
    """

    def __init__(self, auth: GoogleAuth, user_id: str) -> None:
        self._auth = auth
        self._user_id = user_id

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    async def get_unread_messages(
        self,
        max_results: int = 5,
        label_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch unread messages from the inbox.

        Returns lightweight message metadata (id, threadId, snippet, from,
        subject) without downloading full bodies.

        Args:
            max_results: Maximum number of messages to return.
            label_ids: Gmail label filter. Defaults to ["INBOX", "UNREAD"].

        Returns:
            List of message summary dicts, each containing:
                'id', 'thread_id', 'snippet', 'from', 'subject', 'date'
        """
        if label_ids is None:
            label_ids = ["INBOX", "UNREAD"]

        def _fetch() -> List[Dict[str, Any]]:
            service = self._auth.build_service(self._user_id, "gmail", "v1")

            # Step 1: list message IDs matching the query.
            list_result = (
                service.users()
                .messages()
                .list(
                    userId="me",
                    labelIds=label_ids,
                    maxResults=max_results,
                )
                .execute()
            )
            messages_raw = list_result.get("messages", [])

            summaries: List[Dict[str, Any]] = []
            for msg_ref in messages_raw:
                msg_id = msg_ref["id"]
                msg = (
                    service.users()
                    .messages()
                    .get(userId="me", id=msg_id, format="metadata",
                         metadataHeaders=["From", "Subject", "Date"])
                    .execute()
                )
                headers = {
                    h["name"]: h["value"]
                    for h in msg.get("payload", {}).get("headers", [])
                }
                summaries.append({
                    "id": msg_id,
                    "thread_id": msg.get("threadId", ""),
                    "snippet": msg.get("snippet", ""),
                    "from": headers.get("From", "Unknown sender"),
                    "subject": headers.get("Subject", "(no subject)"),
                    "date": headers.get("Date", ""),
                })

            return summaries

        loop = asyncio.get_running_loop()
        messages = await loop.run_in_executor(_executor, _fetch)
        logger.info(
            "Fetched %d unread messages for user '%s'.", len(
                messages), self._user_id
        )
        return messages

    async def search_messages(
        self,
        query: str,
        max_results: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Search for messages using a Gmail query (e.g. 'from:Amazon' or 'label:unread').

        Args:
            query: Gmail search query string.
            max_results: Maximum number of results to return.

        Returns:
            List of message summary dicts.
        """
        def _fetch() -> List[Dict[str, Any]]:
            service = self._auth.build_service(self._user_id, "gmail", "v1")
            list_result = (
                service.users()
                .messages()
                .list(
                    userId="me",
                    q=query,
                    maxResults=max_results,
                )
                .execute()
            )
            messages_raw = list_result.get("messages", [])

            summaries: List[Dict[str, Any]] = []
            for msg_ref in messages_raw:
                msg_id = msg_ref["id"]
                msg = (
                    service.users()
                    .messages()
                    .get(userId="me", id=msg_id, format="metadata",
                         metadataHeaders=["From", "Subject", "Date"])
                    .execute()
                )
                headers = {
                    h["name"]: h["value"]
                    for h in msg.get("payload", {}).get("headers", [])
                }
                summaries.append({
                    "id": msg_id,
                    "thread_id": msg.get("threadId", ""),
                    "snippet": msg.get("snippet", ""),
                    "from": headers.get("From", "Unknown sender"),
                    "subject": headers.get("Subject", "(no subject)"),
                    "date": headers.get("Date", ""),
                })
            return summaries

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_executor, _fetch)

    async def get_message_body(self, message_id: str) -> str:
        """
        Fetch and decode the plain-text body of a specific message.

        Args:
            message_id: The Gmail message ID returned by get_unread_messages().

        Returns:
            Decoded plain-text body, truncated to _BODY_PREVIEW_CHARS characters.
            Returns a placeholder if no plain-text part is found.
        """
        def _fetch() -> str:
            service = self._auth.build_service(self._user_id, "gmail", "v1")
            msg = (
                service.users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
            return _extract_plain_text(msg)

        loop = asyncio.get_running_loop()
        body = await loop.run_in_executor(_executor, _fetch)
        logger.debug("Fetched body for message '%s'.", message_id)
        return body[:_BODY_PREVIEW_CHARS]

    async def send_message(
        self,
        to: str,
        subject: str,
        body: str,
        from_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an email from the authenticated user.

        Args:
            to: Recipient email address.
            subject: Email subject line.
            body: Plain-text email body.
            from_address: Sender address. Defaults to the authenticated user's
                primary address (Gmail infers this when omitted).

        Returns:
            The sent message resource dict containing 'id' and 'threadId'.

        Raises:
            googleapiclient.errors.HttpError: On API errors.
        """
        mime_msg = MIMEText(body)
        mime_msg["to"] = to
        mime_msg["subject"] = subject
        if from_address:
            mime_msg["from"] = from_address

        raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

        def _send() -> Dict[str, Any]:
            service = self._auth.build_service(self._user_id, "gmail", "v1")
            sent = (
                service.users()
                .messages()
                .send(userId="me", body={"raw": raw})
                .execute()
            )
            return sent

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _send)
        logger.info(
            "Sent email to '%s' (subject: '%s') for user '%s'.",
            to,
            subject,
            self._user_id,
        )
        return result

    # -------------------------------------------------------------------------
    # Natural-language formatting helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def format_messages_for_speech(messages: List[Dict[str, Any]]) -> str:
        """
        Convert a list of message summary dicts into a TTS-friendly string.

        Args:
            messages: Message summary dicts as returned by get_unread_messages().

        Returns:
            Plain-text summary suitable for speaking aloud.
        """
        if not messages:
            return "You have no unread messages."

        count = len(messages)
        lines: List[str] = [f"You have {count} unread message(s)."]
        for msg in messages:
            sender = msg.get("from", "Unknown sender")
            # Strip any display-name decoration: "Name <email>" -> "Name"
            if "<" in sender:
                sender = sender.split("<")[0].strip().strip('"')
            subject = msg.get("subject", "no subject")
            snippet = msg.get("snippet", "")
            lines.append(f"From {sender}, subject: {subject}. {snippet}")

        return " ".join(lines)


# -------------------------------------------------------------------------
# Internal decoding helpers
# -------------------------------------------------------------------------

def _extract_plain_text(message: Dict[str, Any]) -> str:
    """
    Recursively search a Gmail message payload for a text/plain part.

    Args:
        message: Full message resource dict from the Gmail API.

    Returns:
        Decoded plain-text string, or a placeholder if none found.
    """
    payload = message.get("payload", {})
    return _walk_parts(
        payload) or "[No plain-text body found in this message.]"


def _walk_parts(part: Dict[str, Any]) -> Optional[str]:
    """
    Recursively walk MIME parts looking for text/plain content.

    Args:
        part: A payload or part dict from the Gmail API message resource.

    Returns:
        Decoded text string if a text/plain part is found, else None.
    """
    mime_type = part.get("mimeType", "")

    if mime_type == "text/plain":
        data = part.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(
                data + "==").decode("utf-8", errors="replace")
        return None

    for sub_part in part.get("parts", []):
        result = _walk_parts(sub_part)
        if result is not None:
            return result

    return None


# -----------------------------------------------------------------------------
# Factory
# -----------------------------------------------------------------------------

def build_gmail_provider(user_id: Optional[str] = None) -> GmailProvider:
    """
    Convenience factory that builds a GmailProvider using app settings.

    Args:
        user_id: User ID override. Falls back to settings.default_user_id.

    Returns:
        Configured GmailProvider instance.
    """
    from config.settings import get_settings
    s = get_settings()
    auth = GoogleAuth(
        client_secrets_path=s.google_client_secrets_path,
        token_storage_path=s.google_token_storage_path,
    )
    return GmailProvider(auth=auth, user_id=user_id or s.default_user_id)
