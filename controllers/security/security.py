import os
import base64
import logging
import threading
from typing import Optional
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
import bcrypt
import platform

# Setup logging with secure practices
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("security_manager.log"), logging.StreamHandler()]
)

class SecurityManager:
    """
    A class to handle security-related operations such as encryption, decryption, and password management.
    """

    def __init__(self, key: Optional[bytes] = None):
        """
        Initializes the SecurityManager class.

        Args:
            key (Optional[bytes]): An optional encryption key. If not provided, a new key will be generated.
        """
        self.lock = threading.Lock()  # Ensuring thread safety
        if key:
            self.key = key
            logging.info("Security Manager initialized with provided encryption key.")
        else:
            self.key = self.generate_key()
            logging.info("Security Manager initialized with new encryption key.")
        self.cipher_suite = Fernet(self.key)

    def generate_key(self) -> bytes:
        """
        Generates a new Fernet encryption key.

        Returns:
            bytes: The generated encryption key.
        """
        return Fernet.generate_key()

    def derive_key_from_password(self, password: str, salt: bytes) -> bytes:
        """
        Derives a key from a password using PBKDF2HMAC.

        Args:
            password (str): The password to derive the key from.
            salt (bytes): A salt to use for key derivation.

        Returns:
            bytes: The derived key.
        """
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        return base64.urlsafe_b64encode(kdf.derive(password.encode()))

    def rotate_key(self, password: str) -> None:
        """
        Rotates the encryption key using a new key derived from the provided password.

        Args:
            password (str): The password to derive the new key from.
        """
        salt = os.urandom(16)  # Secure random salt
        self.key = self.derive_key_from_password(password, salt)
        self.cipher_suite = Fernet(self.key)
        logging.info("Encryption key rotated successfully.")

    def encrypt(self, data: str) -> str:
        """
        Encrypts a string using Fernet symmetric encryption.

        Args:
            data (str): The plaintext data to encrypt.

        Returns:
            str: The encrypted data in base64 encoded format.
        """
        with self.lock:
            if not isinstance(data, str):
                logging.error("Data to encrypt must be a string.")
                raise ValueError("Data to encrypt must be a string.")
            encrypted_data = self.cipher_suite.encrypt(data.encode())
            logging.info("Data encrypted successfully.")
            return base64.urlsafe_b64encode(encrypted_data).decode()

    def decrypt(self, token: str) -> str:
        """
        Decrypts an encrypted string using Fernet symmetric encryption.

        Args:
            token (str): The base64 encoded encrypted data.

        Returns:
            str: The decrypted plaintext data.
        """
        with self.lock:
            if not isinstance(token, str):
                logging.error("Token to decrypt must be a string.")
                raise ValueError("Token to decrypt must be a string.")
            encrypted_data = base64.urlsafe_b64decode(token.encode())
            try:
                decrypted_data = self.cipher_suite.decrypt(encrypted_data).decode()
                logging.info("Data decrypted successfully.")
                return decrypted_data
            except Exception as e:
                logging.error(f"Decryption failed: {e}")
                raise ValueError("Invalid token or decryption failed.") from e

    def hash_password(self, password: str) -> str:
        """
        Hashes a password using bcrypt.

        Args:
            password (str): The password to hash.

        Returns:
            str: The hashed password in base64 encoded format.
        """
        if not isinstance(password, str):
            logging.error("Password must be a string.")
            raise ValueError("Password must be a string.")
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password.encode(), salt)
        logging.info("Password hashed successfully using bcrypt.")
        return hashed_password.decode()

    def verify_password(self, stored_password: str, provided_password: str) -> bool:
        """
        Verifies a provided password against a stored hashed password using bcrypt.

        Args:
            stored_password (str): The hashed password stored in the system.
            provided_password (str): The plaintext password provided by the user.

        Returns:
            bool: True if the provided password matches the stored hashed password, False otherwise.
        """
        if not all(isinstance(p, str) for p in [stored_password, provided_password]):
            logging.error("Passwords must be strings.")
            raise ValueError("Passwords must be strings.")
        is_valid = bcrypt.checkpw(provided_password.encode(), stored_password.encode())
        logging.info("Password verification completed.")
        return is_valid

    def save_key_to_file(self, file_path: str) -> bool:
        """
        Saves the encryption key to a file securely.

        Args:
            file_path (str): The path to the file where the key will be saved.

        Returns:
            bool: True if the key was successfully saved, False otherwise.
        """
        with self.lock:
            try:
                fd = os.open(file_path, os.O_WRONLY | os.O_CREAT, 0o600)
                with os.fdopen(fd, 'wb') as file:
                    file.write(self.key)
                logging.info("Encryption key saved to file successfully.")
                return True
            except IOError as e:
                logging.error(f"Error saving encryption key to file: {e}")
                return False

    def load_key_from_file(self, file_path: str) -> bool:
        """
        Loads an encryption key from a file securely.

        Args:
            file_path (str): The path to the file where the key is stored.

        Returns:
            bool: True if the key was successfully loaded, False otherwise.
        """
        with self.lock:
            try:
                # Check file permissions only on Unix-based systems
                if platform.system() != 'Windows':
                    if os.stat(file_path).st_mode & 0o777 != 0o600:
                        logging.error("Insecure file permissions for the key file.")
                        return False

                with open(file_path, 'rb') as file:
                    self.key = file.read()
                    self.cipher_suite = Fernet(self.key)
                logging.info("Encryption key loaded from file successfully.")
                return True
            except IOError as e:
                logging.error(f"Error loading encryption key from file: {e}")
                return False

if __name__ == "__main__":
    # Example usage of SecurityManager
    sec_manager = SecurityManager()

    # Encryption example
    encrypted_data = sec_manager.encrypt("Sensitive Data")
    print(f"Encrypted Data: {encrypted_data}")
    decrypted_data = sec_manager.decrypt(encrypted_data)
    print(f"Decrypted Data: {decrypted_data}")

    # Password hashing example
    hashed_password = sec_manager.hash_password("securepassword123")
    print(f"Hashed Password: {hashed_password}")
    is_valid = sec_manager.verify_password(hashed_password, "securepassword123")
    print(f"Password is valid: {is_valid}")

    # Saving and loading the encryption key example
    sec_manager.save_key_to_file('encryption_key.key')
    sec_manager.load_key_from_file('encryption_key.key')
