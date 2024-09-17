import os
import shutil
import logging
import threading
import time
from typing import Optional
import psutil  # For resource monitoring

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class ResourceManager:
    """
    A thread-safe resource manager for handling file operations such as reading, writing, deleting files.
    Includes file backups and optional system resource monitoring.
    """
    
    def __init__(self, backup_dir: str = 'backups', enable_monitoring: bool = False):
        """
        Initializes the resource manager with a backup directory and optional monitoring.
        
        Args:
            backup_dir (str): Directory where backups are stored.
            enable_monitoring (bool): Enables resource monitoring (file I/O, CPU, memory).
        """
        self._lock = threading.Lock()
        self.backup_dir = backup_dir
        self.enable_monitoring = enable_monitoring
        if not os.path.exists(self.backup_dir):
            os.makedirs(self.backup_dir)
        if self.enable_monitoring:
            self.monitor_thread = threading.Thread(target=self._monitor_resources, daemon=True)
            self.monitor_thread.start()

        logging.info("Resource Manager initialized.")

    def _backup_file(self, file_path: str):
        """
        Creates a backup of the specified file before overwriting or deleting it.
        Uses versioning to prevent overwriting older backups.
        
        Args:
            file_path (str): The file path to backup.
        """
        with self._lock:
            if os.path.exists(file_path):
                backup_file_path = self._get_versioned_backup(file_path)
                shutil.copy2(file_path, backup_file_path)
                logging.info(f"Backup created: {backup_file_path}")

    def _get_versioned_backup(self, file_path: str) -> str:
        """
        Creates a versioned backup filename to avoid overwriting older backups.
        
        Args:
            file_path (str): The file path to backup.
        
        Returns:
            str: The path of the versioned backup file.
        """
        base_name = os.path.basename(file_path)
        file_name, ext = os.path.splitext(base_name)
        version = 1
        backup_file_path = os.path.join(self.backup_dir, f"{file_name}_v{version}{ext}")

        while os.path.exists(backup_file_path):
            version += 1
            backup_file_path = os.path.join(self.backup_dir, f"{file_name}_v{version}{ext}")

        return backup_file_path

    def read_file(self, file_path: str) -> Optional[str]:
        """
        Reads the contents of a file in a thread-safe manner.
        
        Args:
            file_path (str): The file path to read.
        
        Returns:
            Optional[str]: The file contents or None if an error occurs.
        """
        with self._lock:
            try:
                with open(file_path, 'r') as file:
                    data = file.read()
                    logging.info(f"File read successfully: {file_path}")
                    return data
            except Exception as e:
                logging.error(f"Error reading file {file_path}: {e}")
                return None

    def write_file(self, file_path: str, data: str, overwrite: bool = True) -> None:
        """
        Writes data to a file in a thread-safe manner. Creates a backup before overwriting.
        
        Args:
            file_path (str): The file path to write to.
            data (str): The data to write.
            overwrite (bool): Whether to overwrite the file if it exists (default: True).
        """
        with self._lock:
            try:
                if os.path.exists(file_path) and overwrite:
                    self._backup_file(file_path)
                
                with open(file_path, 'w' if overwrite else 'a') as file:
                    file.write(data)
                    logging.info(f"File written successfully: {file_path}")
            except Exception as e:
                logging.error(f"Error writing to file {file_path}: {e}")

    def delete_file(self, file_path: str) -> None:
        """
        Deletes a file in a thread-safe manner. Creates a backup before deletion.
        
        Args:
            file_path (str): The file path to delete.
        """
        with self._lock:
            try:
                if os.path.exists(file_path):
                    self._backup_file(file_path)
                    os.remove(file_path)
                    logging.info(f"File deleted successfully: {file_path}")
                else:
                    logging.warning(f"File {file_path} does not exist.")
            except Exception as e:
                logging.error(f"Error deleting file {file_path}: {e}")

    def _monitor_resources(self):
        """
        Monitors system resources (CPU, memory, disk I/O) and logs usage.
        This runs as a background thread if monitoring is enabled.
        """
        logging.info("Resource monitoring started.")
        while True:
            try:
                cpu_usage = psutil.cpu_percent(interval=1)
                memory_usage = psutil.virtual_memory().percent
                disk_io = psutil.disk_io_counters()

                logging.info(f"CPU Usage: {cpu_usage}%, Memory Usage: {memory_usage}%, Disk I/O: {disk_io.read_bytes / 1024 / 1024:.2f} MB read, {disk_io.write_bytes / 1024 / 1024:.2f} MB written")
                time.sleep(5)  # Adjust the interval for monitoring as needed
            except Exception as e:
                logging.error(f"Resource monitoring error: {e}")
                break

# Example usage of the ResourceManager
if __name__ == "__main__":
    resource_manager = ResourceManager(enable_monitoring=True)

    # Example file operations
    resource_manager.write_file("test_file.txt", "This is a test content.", overwrite=True)
    content = resource_manager.read_file("test_file.txt")
    if content:
        print(f"File Content: {content}")
    resource_manager.delete_file("test_file.txt")
