# email/email_controller.py
import os
import logging
from typing import Optional, List, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.utils import formatdate
from email.mime.base import MIMEBase
from email import encoders
import imaplib
from email.parser import BytesParser

class EmailController(ControllerBase):
    def __init__(self):
        """
        Initializes the EmailController with environment variables for API keys or email server details.
        """
        super().__init__()
        load_dotenv()
        self.smtp_server = os.getenv('SMTP_SERVER')
        self.smtp_port = int(os.getenv('SMTP_PORT', 587))
        self.smtp_user = os.getenv('SMTP_USER')
        self.smtp_password = os.getenv('SMTP_PASSWORD')
        self.imap_server = os.getenv('IMAP_SERVER')
        self.imap_port = int(os.getenv('IMAP_PORT', 993))
        self.imap_user = os.getenv('IMAP_USER')
        self.imap_password = os.getenv('IMAP_PASSWORD')

        if not self.smtp_user or not self.smtp_password:
            self.logger.error("SMTP user or password is missing in environment variables.")
            raise ValueError("SMTP credentials are missing.")

        if not self.imap_user or not self.imap_password:
            self.logger.error("IMAP user or password is missing in environment variables.")
            raise ValueError("IMAP credentials are missing.")

        self.logger.info("EmailController initialized with SMTP and IMAP settings.")

    def execute(self, task_name: str, user_id: Optional[str] = None, email_data: Optional[Dict] = None):
        """
        Executes a specific email-related task, such as sending an email or checking inbox.

        Args:
            task_name (str): The task to execute ('send_email', 'check_inbox').
            user_id (Optional[str]): The ID of the user requesting the task.
            email_data (Optional[Dict]): Data required for the task (e.g., email details).
        """
        try:
            self.logger.info(f"Executing email task '{task_name}' for user '{user_id}'.")
            if task_name == "send_email":
                if email_data:
                    self.send_email(email_data)
                else:
                    self.logger.error("Missing email data for 'send_email' task.")
            elif task_name == "check_inbox":
                emails = self.check_inbox(user_id)
                if emails:
                    self.logger.info(f"Fetched {len(emails)} emails for user '{user_id}'.")
            else:
                self.logger.error(f"Unknown email task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def send_email(self, email_data: Dict):
        """
        Sends an email using SMTP.

        Args:
            email_data (Dict): The email details (to, subject, body, etc.).
        """
        try:
            msg = MIMEMultipart()
            msg['From'] = self.smtp_user
            msg['To'] = email_data.get('to')
            msg['Subject'] = email_data.get('subject')
            msg['Date'] = formatdate(localtime=True)

            # Set email body
            body = email_data.get('body', '')
            if email_data.get('is_html'):
                msg.attach(MIMEText(body, 'html'))
            else:
                msg.attach(MIMEText(body, 'plain'))

            # Handling attachments
            for file_path in email_data.get('attachments', []):
                try:
                    with open(file_path, 'rb') as file:
                        file_data = file.read()
                        file_name = os.path.basename(file_path)
                        attachment = MIMEApplication(file_data, Name=file_name)
                        attachment['Content-Disposition'] = f'attachment; filename="{file_name}"'
                        msg.attach(attachment)
                except IOError as e:
                    self.logger.error(f"Error reading attachment {file_path}: {e}")

            # Send email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)
                self.logger.info(f"Email sent successfully to {email_data.get('to')}.")

        except Exception as e:
            self.logger.error(f"Failed to send email to {email_data.get('to')}: {e}")
            self._handle_error(e)

    def check_inbox(self, user_id: Optional[str] = None) -> List[Dict]:
        """
        Checks the inbox for new emails using IMAP.

        Args:
            user_id (Optional[str]): The ID of the user for whom to check the inbox.

        Returns:
            List[Dict]: A list of emails in the user's inbox.
        """
        self.logger.info(f"Checking inbox for user '{user_id}'...")
        emails = []
        try:
            with imaplib.IMAP4_SSL(self.imap_server, self.imap_port) as imap:
                imap.login(self.imap_user, self.imap_password)
                imap.select('inbox')
                status, search_data = imap.search(None, 'UNSEEN')
                if status == 'OK':
                    for num in search_data[0].split():
                        status, data = imap.fetch(num, '(RFC822)')
                        if status == 'OK':
                            message = BytesParser().parsebytes(data[0][1])
                            emails.append({
                                'subject': message['subject'],
                                'from': message['from'],
                                'body': message.get_payload(decode=True).decode('utf-8')
                            })
        except Exception as e:
            self.logger.error(f"Failed to check inbox for user '{user_id}': {e}")
            self._handle_error(e)

        return emails

    def save_draft(self, email_data: Dict, user_id: Optional[str] = None):
        """
        Saves an email as a draft.

        Args:
            email_data (Dict): The email details to save as a draft.
            user_id (Optional[str]): The ID of the user for whom the draft is saved.
        """
        self.logger.info(f"Draft saved for user '{user_id}' with subject '{email_data.get('subject')}'.")

    def list_emails(self, user_id: Optional[str] = None) -> List[Dict]:
        """
        Lists emails in the user's inbox.

        Args:
            user_id (Optional[str]): The ID of the user requesting the email list.

        Returns:
            List[Dict]: A list of emails in the user's inbox.
        """
        self.logger.info(f"Listing emails for user '{user_id}'...")
        # TODO: Implement logic to list emails using IMAP or another method.
        return []
