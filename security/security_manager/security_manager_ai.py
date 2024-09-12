import logging
import os
import base64
import bcrypt
import hmac
from typing import Optional, List, Dict, Any
from cryptography.fernet import Fernet
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import json
import yaml

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("security_manager.log"), logging.StreamHandler()]
)

class SecurityManager:
    """
    A class that uses AI for managing security tasks such as user authentication,
    access control, anomaly detection, threat prevention, and logging.
    """

    def __init__(self, encryption_key: Optional[str] = None):
        """
        Initialize the SecurityManager class.

        Args:
            encryption_key (str, optional): The encryption key to use for data protection.
        """
        if encryption_key:
            self.encryption_key = encryption_key
        else:
            self.encryption_key = Fernet.generate_key().decode()
        self.model = IsolationForest()
        self.scaler = StandardScaler()
        self.users = {}  # A simple dictionary for user data storage
        self.logging = logging
        logging.info("SecurityManager initialized.")

    def encrypt(self, data: str) -> str:
        """Encrypt data using the encryption key."""
        if not self.encryption_key:
            raise ValueError("Encryption key is not set")
        f = Fernet(self.encryption_key.encode())
        return f.encrypt(data.encode()).decode()

    def decrypt(self, encrypted_data: str) -> str:
        """Decrypt data using the encryption key."""
        if not self.encryption_key:
            raise ValueError("Encryption key is not set")
        f = Fernet(self.encryption_key.encode())
        return f.decrypt(encrypted_data.encode()).decode()

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt."""
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode(), salt).decode()

    def verify_password(self, hashed_password: str, password: str) -> bool:
        """Verify a password against a stored hashed password."""
        return bcrypt.checkpw(password.encode(), hashed_password.encode())

    def add_user(self, username: str, password: str, role: str) -> None:
        """Add a new user with a hashed password and role."""
        if username in self.users:
            logging.warning("User already exists.")
            return
        self.users[username] = {
            'password': self.hash_password(password),
            'role': role
        }
        logging.info(f"User '{username}' added with role '{role}'.")

    def remove_user(self, username: str) -> None:
        """Remove an existing user."""
        if username in self.users:
            del self.users[username]
            logging.info(f"User '{username}' removed.")
        else:
            logging.warning("User does not exist.")

    def authenticate_user(self, username: str, password: str) -> bool:
        """Authenticate a user by verifying the password."""
        user = self.users.get(username)
        if not user:
            logging.warning("User not found.")
            return False
        if self.verify_password(user['password'], password):
            logging.info(f"User '{username}' authenticated successfully.")
            return True
        else:
            logging.warning("Authentication failed.")
            return False

    def train_anomaly_detector(self, data: np.ndarray) -> None:
        """Train the anomaly detection model using Isolation Forest."""
        self.scaler.fit(data)
        scaled_data = self.scaler.transform(data)
        self.model.fit(scaled_data)
        logging.info("Anomaly detection model trained.")

    def detect_anomalies(self, data: np.ndarray) -> np.ndarray:
        """Detect anomalies in the provided data."""
        scaled_data = self.scaler.transform(data)
        predictions = self.model.predict(scaled_data)
        anomalies = np.where(predictions == -1)[0]
        logging.info(f"Anomalies detected: {len(anomalies)}")
        return anomalies

    def save_key_to_file(self, filename: str) -> None:
        """Save the encryption key to a file."""
        with open(filename, "wb") as f:
            f.write(base64.b64encode(self.encryption_key.encode()))
        logging.info(f"Encryption key saved to {filename}")

    def load_key_from_file(self, filename: str) -> None:
        """Load the encryption key from a file."""
        with open(filename, "rb") as f:
            self.encryption_key = base64.b64decode(f.read()).decode()
        logging.info(f"Encryption key loaded from {filename}")

    def save_user_data(self, filename: str, file_format: str = 'json') -> None:
        """Save user data to a file."""
        with open(filename, 'w') as f:
            if file_format == 'json':
                json.dump(self.users, f)
            elif file_format == 'yaml':
                yaml.dump(self.users, f)
            else:
                raise ValueError("Unsupported file format. Use 'json' or 'yaml'.")
        logging.info(f"User data saved to {filename}")

    def load_user_data(self, filename: str, file_format: str = 'json') -> None:
        """Load user data from a file."""
        with open(filename, 'r') as f:
            if file_format == 'json':
                self.users = json.load(f)
            elif file_format == 'yaml':
                self.users = yaml.safe_load(f)
            else:
                raise ValueError("Unsupported file format. Use 'json' or 'yaml'.")
        logging.info(f"User data loaded from {filename}")

# Example usage
if __name__ == "__main__":
    sm = SecurityManager()
    sm.add_user('admin', 'securepassword', 'admin')
    sm.authenticate_user('admin', 'securepassword')
    data = np.random.randn(100, 2)
    sm.train_anomaly_detector(data)
    anomalies = sm.detect_anomalies(data)
    print(f"Anomalies detected at indices: {anomalies}")
    sm.save_key_to_file('encryption_key.key')
    sm.load_key_from_file('encryption_key.key')
    sm.save_user_data('user_data.json')
    sm.load_user_data('user_data.json')
