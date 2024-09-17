import os
import base64
import logging
import threading
import time
import platform
from typing import Optional
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
import bcrypt

# Setup logging with secure practices
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("security_manager.log"), logging.StreamHandler()]
)

class SecurityManager:
    """
    A class to handle security-related operations such as encryption, decryption, key management, and password hashing.
    """

    def __init__(self, key: Optional[bytes] = None, rotations: int = 10000, rotation_time: int = 3600):
        """
        Initializes the SecurityManager class.

        Args:
            key (Optional[bytes]): An optional encryption key. If not provided, a new key will be generated.
            rotations (int): The number of times the key should be rotated before triggering a new rotation.
            rotation_time (int): The time in seconds after which the key should be rotated.
        """
        self.lock = threading.Lock()  # Ensuring thread safety
        self.key = key or self.generate_key()
        self.cipher_suite = Fernet(self.key)
        self.key_version = 1  # Track the version of the key for rotation
        self.rotation_count = 0  # Count the number of encryption operations
        self.rotation_time = rotation_time  # Time in seconds after which the key should be rotated
        self.last_rotation = time.time()  # Track the last rotation time
        self.rotations = rotations  # The number of times the key should be rotated before triggering a new rotation
        logging.info("Security Manager initialized.")

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

    def rotate_key(self, password: Optional[str] = None) -> None:
        """
        Rotates the encryption key using a new key derived from the provided password or a new random key.
        The new key is stored securely, and the version is updated.

        Args:
            password (Optional[str]): The password to derive the new key from. If None, a random key is used.
        """
        with self.lock:
            if self.rotation_count >= self.rotations or time.time() - self.last_rotation > self.rotation_time:
                salt = os.urandom(16)
                if password:
                    self.key = self.derive_key_from_password(password, salt)
                else:
                    self.key = self.generate_key()
                self.cipher_suite = Fernet(self.key)
                self.key_version += 1
                self.rotation_count = 0
                self.last_rotation = time.time()
                logging.info(f"Encryption key rotated successfully. New version: {self.key_version}")

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
            self.rotation_count += 1
            self.rotate_key()
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
        Hashes a password using bcrypt after validating its strength.

        Args:
            password (str): The password to hash.

        Returns:
            str: The hashed password in base64 encoded format.
        """
        if not isinstance(password, str):
            logging.error("Password must be a string.")
            raise ValueError("Password must be a string.")
        
        # Validate password strength
        if not self.validate_password_strength(password):
            logging.error("Password does not meet strength requirements.")
            raise ValueError("Password does not meet strength requirements.")
        
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password.encode(), salt)
        logging.info("Password hashed successfully using bcrypt.")
        return hashed_password.decode()

    def validate_password_strength(self, password: str) -> bool:
        """
        Validates the strength of a password by checking its length and complexity.

        Args:
            password (str): The password to validate.

        Returns:
            bool: True if the password is strong enough, False otherwise.
        """
        if len(password) < 8:
            return False
        if not any(c.isdigit() for c in password):
            return False
        if not any(c.isalpha() for c in password):
            return False
        if not any(c in "!@#$%^&*()-_=+[]{};:,.<>?/|" for c in password):
            return False
        return True

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
    hashed_password = sec_manager.hash_password("Secure@Password123")
    print(f"Hashed Password: {hashed_password}")
    is_valid = sec_manager.verify_password(hashed_password, "Secure@Password123")
    print(f"Password is valid: {is_valid}")

    # Saving and loading the encryption key example
    sec_manager.save_key_to_file('encryption_key.key')
    sec_manager.load_key_from_file('encryption_key.key')
