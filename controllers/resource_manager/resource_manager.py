import logging
import os
import json
from typing import Any, Dict, Optional

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class ResourceManager:
    """
    A class to manage resources such as files and configurations.
    """

    def __init__(self):
        """
        Initialize the ResourceManager class with basic setup and logging.
        """
        logging.info("Resource Manager initialized.")

    def read_file(self, file_path: str) -> Optional[str]:
        """
        Reads the contents of a file and returns it as a string.

        Args:
            file_path (str): The path to the file.

        Returns:
            Optional[str]: The file contents or None if an error occurs.
        """
        try:
            with open(file_path, 'r') as file:
                return file.read()
        except FileNotFoundError:
            logging.error(f"File not found: {file_path}")
        except PermissionError:
            logging.error(f"Permission denied when trying to read file: {file_path}")
        except IOError as e:
            logging.error(f"Error reading file {file_path}: {e}")
        return None

    def write_file(self, file_path: str, content: str) -> bool:
        """
        Writes content to a file.

        Args:
            file_path (str): The path to the file.
            content (str): The content to write.

        Returns:
            bool: True if write was successful, False otherwise.
        """
        try:
            with open(file_path, 'w') as file:
                file.write(content)
            logging.info(f"File written successfully: {file_path}")
            return True
        except PermissionError:
            logging.error(f"Permission denied when trying to write file: {file_path}")
        except IOError as e:
            logging.error(f"Error writing to file {file_path}: {e}")
            return False

    def load_config(self, config_path: str) -> Optional[Dict[str, Any]]:
        """
        Loads a JSON configuration file.

        Args:
            config_path (str): The path to the config file.

        Returns:
            Optional[Dict[str, Any]]: The configuration dictionary or None if an error occurs.
        """
        try:
            with open(config_path, 'r') as file:
                return json.load(file)
        except FileNotFoundError:
            logging.error(f"Config file not found: {config_path}")
        except json.JSONDecodeError as e:
            logging.error(f"Error parsing JSON config {config_path}: {e}")
        except PermissionError:
            logging.error(f"Permission denied when trying to read config file: {config_path}")
        except IOError as e:
            logging.error(f"Error reading config file {config_path}: {e}")
        return None

    def save_config(self, config_path: str, config: Dict[str, Any]) -> bool:
        """
        Saves a configuration dictionary to a JSON file.

        Args:
            config_path (str): The path to the config file.
            config (Dict[str, Any]): The configuration dictionary.

        Returns:
            bool: True if save was successful, False otherwise.
        """
        try:
            with open(config_path, 'w') as file:
                json.dump(config, file, indent=4)
            logging.info(f"Config file saved successfully: {config_path}")
            return True
        except PermissionError:
            logging.error(f"Permission denied when trying to write config file: {config_path}")
        except IOError as e:
            logging.error(f"Error writing to config file {config_path}: {e}")
            return False

    def delete_file(self, file_path: str) -> bool:
        """
        Deletes a file from the file system.

        Args:
            file_path (str): The path to the file to delete.

        Returns:
            bool: True if the file was successfully deleted, False otherwise.
        """
        try:
            os.remove(file_path)
            logging.info(f"File deleted successfully: {file_path}")
            return True
        except FileNotFoundError:
            logging.error(f"File not found: {file_path}")
        except PermissionError:
            logging.error(f"Permission denied when trying to delete file: {file_path}")
        except OSError as e:
            logging.error(f"Error deleting file {file_path}: {e}")
        return False
