# Path: controllers/controller_base/email/email_controller.py

import os
import logging
from typing import Optional, List, Dict
from controllers.controller_base.controller_base import ControllerBase # Corrected import path based on project_tree.txt
from dotenv import load_dotenv # Still useful for base/global app settings, but not for user-specific creds here
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.utils import formatdate
from email.mime.base import MIMEBase
from email import encoders
import imaplib
from email.parser import BytesParser

# Set up logging for this module (if not done centrally)
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

class EmailController(ControllerBase):
    def __init__(self):
        """
        Initializes the EmailController. It will not load user-specific
        credentials globally, but expect them per-operation.
        """
        super().__init__()
        # Removed loading of SMTP/IMAP credentials here.
        # These will be passed to send_email and check_inbox methods.
        logger.info("EmailController initialized, ready for user-specific operations.")
        # Any global email settings (e.g., for system notifications) could still be loaded here if needed.

    def execute(self, task_name: str, user_id: Optional[str] = None, email_data: Optional[Dict] = None):
        """
        Executes a specific email-related task, such as sending an email or checking inbox.

        Args:
            task_name (str): The task to execute ('send_email', 'check_inbox').
            user_id (Optional[str]): The ID of the user requesting the task.
            email_data (Optional[Dict]): Data required for the task (e.g., email details including credentials).
                                         Expected keys for credentials:
                                         'smtp_server', 'smtp_port', 'smtp_user', 'smtp_password'
                                         'imap_server', 'imap_port', 'imap_user', 'imap_password'
        """
        if not email_data or not isinstance(email_data, dict):
            logger.error(f"Missing or invalid email_data for task '{task_name}' for user '{user_id}'.")
            self._handle_error(ValueError("Missing or invalid email data."), user_id)
            return

        # Extract credentials from email_data for this specific operation
        # This requires the calling module (e.g., User Management, Router) to provide these securely
        smtp_server = email_data.get('smtp_server')
        smtp_port = int(email_data.get('smtp_port', 587))
        smtp_user = email_data.get('smtp_user')
        smtp_password = email_data.get('smtp_password')
        imap_server = email_data.get('imap_server')
        imap_port = int(email_data.get('imap_port', 993))
        imap_user = email_data.get('imap_user')
        imap_password = email_data.get('imap_password')

        if not all([smtp_user, smtp_password, imap_user, imap_password]):
            logger.error(f"Missing email credentials in email_data for task '{task_name}' for user '{user_id}'.")
            self._handle_error(ValueError("Email credentials are missing."), user_id)
            return

        try:
            logger.info(f"Executing email task '{task_name}' for user '{user_id}'.")
            if task_name == "send_email":
                self.send_email(email_data, smtp_server, smtp_port, smtp_user, smtp_password)
            elif task_name == "check_inbox":
                emails = self.check_inbox(user_id, imap_server, imap_port, imap_user, imap_password)
                if emails:
                    logger.info(f"Fetched {len(emails)} emails for user '{user_id}'.")
            else:
                logger.error(f"Unknown email task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def send_email(self, email_data: Dict, smtp_server: str, smtp_port: int, smtp_user: str, smtp_password: str):
        """
        Sends an email using SMTP.
        Args:
            email_data (Dict): The email details (to, subject, body, attachments, etc.).
            smtp_server (str): The SMTP server address.
            smtp_port (int): The SMTP server port.
            smtp_user (str): The SMTP username (sender's email).
            smtp_password (str): The SMTP password.
        """
        try:
            msg = MIMEMultipart()
            msg['From'] = smtp_user # Use the passed smtp_user as 'From' address
            msg['To'] = email_data.get('to')
            msg['Subject'] = email_data.get('subject')
            msg['Date'] = formatdate(localtime=True)

            body = email_data.get('body', '')
            if email_data.get('is_html'):
                msg.attach(MIMEText(body, 'html'))
            else:
                msg.attach(MIMEText(body, 'plain'))

            for file_path in email_data.get('attachments', []):
                try:
                    with open(file_path, 'rb') as file:
                        file_data = file.read()
                        file_name = os.path.basename(file_path)
                        attachment = MIMEApplication(file_data, Name=file_name)
                        attachment['Content-Disposition'] = f'attachment; filename="{file_name}"'
                        msg.attach(attachment)
                except IOError as e:
                    logger.error(f"Error reading attachment {file_path}: {e}")

            with smtplib.SMTP(smtp_server, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.send_message(msg)
                logger.info(f"Email sent successfully from {smtp_user} to {email_data.get('to')}.")

        except Exception as e:
            logger.error(f"Failed to send email from {smtp_user} to {email_data.get('to')}: {e}")
            self._handle_error(e)

    def check_inbox(self, user_id: Optional[str] = None, imap_server: str = None, imap_port: int = None, imap_user: str = None, imap_password: str = None) -> List[Dict]:
        """
        Checks the inbox for new emails using IMAP.
        Args:
            user_id (Optional[str]): The ID of the user for whom to check the inbox.
            imap_server (str): The IMAP server address.
            imap_port (int): The IMAP server port.
            imap_user (str): The IMAP username (email address).
            imap_password (str): The IMAP password.
        Returns:
            List[Dict]: A list of emails in the user's inbox.
        """
        if not all([imap_server, imap_port, imap_user, imap_password]):
            logger.error(f"Missing IMAP credentials for user '{user_id}'. Cannot check inbox.")
            self._handle_error(ValueError("IMAP credentials are missing for check_inbox."), user_id)
            return []

        logger.info(f"Checking inbox for user '{user_id}' at {imap_user}...")
        emails = []
        try:
            with imaplib.IMAP4_SSL(imap_server, imap_port) as imap:
                imap.login(imap_user, imap_password)
                imap.select('inbox')
                status, search_data = imap.search(None, 'UNSEEN')
                if status == 'OK':
                    for num in search_data[0].split():
                        status, data = imap.fetch(num, '(RFC822)')
                        if status == 'OK':
                            message = BytesParser().parsebytes(data[0][1])
                            # Basic parsing, can be enhanced for multipart messages
                            body_payload = message.get_payload(decode=True)
                            body_text = ""
                            if isinstance(body_payload, list): # Handle multipart messages
                                for part in body_payload:
                                    if part.get_content_type() == 'text/plain':
                                        try:
                                            body_text = part.get_payload(decode=True).decode(part.get_content_charset() or 'utf-8')
                                            break
                                        except Exception:
                                            body_text = " undecodable" # Placeholder for complex cases
                            else: # Non-multipart
                                try:
                                    body_text = body_payload.decode(message.get_content_charset() or 'utf-8')
                                except Exception:
                                    body_text = " undecodable" # Placeholder for complex cases

                            emails.append({
                                'subject': message['subject'],
                                'from': message['from'],
                                'to': message['to'], # Added 'to' field for completeness
                                'date': message['date'], # Added 'date' field
                                'body': body_text
                            })
                            # Mark as seen after processing if desired
                            # imap.store(num, '+FLAGS', '\\Seen')
        except Exception as e:
            logger.error(f"Failed to check inbox for user '{user_id}' at {imap_user}: {e}")
            self._handle_error(e, user_id)

        return emails

    def save_draft(self, email_data: Dict, user_id: Optional[str] = None):
        """
        Saves an email as a draft. This functionality would typically interact with
        IMAP 'Drafts' folder via the provided user credentials.
        Args:
            email_data (Dict): The email details to save as a draft.
            user_id (Optional[str]): The ID of the user for whom the draft is saved.
        """
        logger.info(f"Draft saving logic for user '{user_id}' with subject '{email_data.get('subject')}' needs implementation.")
        # TODO: Implement logic to save draft using IMAP or an API like Gmail API.
        # This would require user-specific IMAP credentials to be passed here as well.

    def list_emails(self, email_data: Dict, user_id: Optional[str] = None) -> List[Dict]:
        """
        Lists emails in the user's inbox. This functionality would typically interact with
        IMAP via the provided user credentials.
        Args:
            email_data (Dict): Contains the necessary IMAP credentials.
            user_id (Optional[str]): The ID of the user requesting the email list.
        Returns:
            List[Dict]: A list of emails in the user's inbox.
        """
        # This would also require user-specific IMAP credentials to be passed here.
        logger.info(f"Listing emails for user '{user_id}' needs implementation with dynamic credentials.")
        # TODO: Implement logic to list emails using IMAP or another method, requiring credentials.
        return []