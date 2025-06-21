# Path: kill_switch/global_kill_switch/global_kill_switch.py

import os
import sys
import logging
from dotenv import load_dotenv
import bcrypt # Ensure 'bcrypt' is installed via requirements.txt

# --- Setup Logging ---
# It's good practice to get a named logger for modules.
# Basic configuration might be done in a central config.py or main.py.
# For now, we'll set up a basic logger here so this module works standalone if tested.
logger = logging.getLogger(__name__)
if not logger.handlers: # Prevent adding handlers multiple times if imported
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# --- Global Kill Switch State Management ---
# This file will persistently store the kill switch state
# Adjusted path to point to the 'logs' directory as requested
KILL_SWITCH_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'logs', 'kill_switch_state.txt')

# In-memory state of the kill switch, read from file on startup
_is_kill_switch_active = False

def _read_kill_switch_state() -> bool:
    """
    Reads the persistent kill switch state from a file.
    Returns True if 'GLOBAL KILL ACTIVATED', False otherwise.
    """
    try:
        if not os.path.exists(os.path.dirname(KILL_SWITCH_STATE_FILE)):
            os.makedirs(os.path.dirname(KILL_SWITCH_STATE_FILE)) # Create logs directory if it doesn't exist

        with open(KILL_SWITCH_STATE_FILE, 'r') as f:
            state = f.read().strip()
            if state == 'GLOBAL KILL ACTIVATED':
                logger.warning(f"Kill switch state file indicates GLOBAL KILL IS ACTIVE at '{KILL_SWITCH_STATE_FILE}'.")
                return True
            elif state == 'GLOBAL KILL RESET':
                logger.info(f"Kill switch state file indicates GLOBAL KILL IS RESET at '{KILL_SWITCH_STATE_FILE}'.")
                return False
    except FileNotFoundError:
        logger.info(f"Kill switch state file '{KILL_SWITCH_STATE_FILE}' not found. Assuming reset state.")
        _write_kill_switch_state('GLOBAL KILL RESET') # Create the file with initial reset state
    except Exception as e:
        logger.error(f"Error reading kill switch state file '{KILL_SWITCH_STATE_FILE}': {e}")
    return False # Default to False if file not found or error


def _write_kill_switch_state(state: str):
    """
    Writes the kill switch state to the designated file.
    Args:
        state (str): The state to write ('GLOBAL KILL ACTIVATED' or 'GLOBAL KILL RESET').
    """
    try:
        # Ensure the directory for the state file exists before writing
        if not os.path.exists(os.path.dirname(KILL_SWITCH_STATE_FILE)):
            os.makedirs(os.path.dirname(KILL_SWITCH_STATE_FILE))

        with open(KILL_SWITCH_STATE_FILE, 'w') as f:
            f.write(state + '\n')
        logger.debug(f"Kill switch state '{state}' written to '{KILL_SWITCH_STATE_FILE}'.")
    except Exception as e:
        logger.critical(f"CRITICAL ERROR: Could not write kill switch state to file '{KILL_SWITCH_STATE_FILE}': {e}")

# Load the initial state when the module is imported
# This ensures that if the system was killed, it remains so on restart
_is_kill_switch_active = _read_kill_switch_state()

# --- Password Handling (CRITICAL IMPROVEMENT for secure reset) ---
# The hashed password will be loaded from an environment variable.
# It should NEVER be stored in plain text in code or .env.
_PASSWORD_HASH_STORED = None

def _load_password_hash_from_env():
    """
    Loads the securely hashed password from the environment variable 'KILL_SWITCH_PASSWORD_HASH'.
    This hash is what the input password will be compared against.
    """
    global _PASSWORD_HASH_STORED
    load_dotenv() # Ensures .env file is loaded at this point
    _PASSWORD_HASH_STORED = os.getenv('KILL_SWITCH_PASSWORD_HASH')
    if not _PASSWORD_HASH_STORED:
        logger.critical("CRITICAL: KILL_SWITCH_PASSWORD_HASH environment variable not set. Kill switch reset is unprotected or non-functional!")
        logger.critical("Please set KILL_SWITCH_PASSWORD_HASH in your .env file with a bcrypt hash of your desired password.")
        logger.critical("Example: To generate a hash for 'mysecretpassword', run: `python -c \"import bcrypt; print(bcrypt.hashpw(b'mysecretpassword', bcrypt.gensalt()))\"`")
    else:
        logger.info("Kill switch password hash loaded successfully.")

# Load the password hash when the module is imported
_load_password_hash_from_env()

def is_kill_switch_active() -> bool:
    """
    Returns the current in-memory state of the global kill switch.
    Other modules should call this regularly to check if they need to shut down.
    """
    return _is_kill_switch_active

def activate_global_kill_switch(origin: str = "Unknown"):
    """
    Activates the global kill switch. This signals the entire River Song AI system
    to initiate a graceful shutdown. The state is made persistent.
    Args:
        origin (str): A string indicating who or what triggered the activation
                      (e.g., "User", "Intrusion Detection System", "Critical Error").
    """
    global _is_kill_switch_active
    _is_kill_switch_active = True
    _write_kill_switch_state('GLOBAL KILL ACTIVATED')
    logger.critical(f"GLOBAL KILL SWITCH ACTIVATED by '{origin}'! System signaling for graceful shutdown.")
    # In a full multi-process/thread system, you might also want to send
    # an explicit signal here (e.g., via a multiprocessing.Event or a Queue)
    # that your main application loop (e.g., in users/main.py) is listening for.
    # For now, relying on periodic checks of is_kill_switch_active() is standard.


def reset_global_kill_switch(input_password: str) -> bool:
    """
    Resets the global kill switch, allowing the system to restart normally on next launch.
    Requires successful password verification using bcrypt.
    Args:
        input_password (str): The plain-text password entered by the user for reset.
    Returns:
        bool: True if reset was successful, False otherwise.
    """
    global _is_kill_switch_active
    global _PASSWORD_HASH_STORED

    if not _PASSWORD_HASH_STORED:
        logger.error("Cannot reset kill switch: No password hash loaded. Kill switch remains active.")
        return False

    try:
        # bcrypt.checkpw expects bytes for both arguments
        if bcrypt.checkpw(input_password.encode('utf-8'), _PASSWORD_HASH_STORED.encode('utf-8')):
            _is_kill_switch_active = False
            _write_kill_switch_state('GLOBAL KILL RESET')
            logger.info("Global kill switch reset. System can now restart normally.")
            return True
        else:
            logger.warning("Incorrect password for kill switch reset. Access denied.")
            return False
    except ValueError as ve:
        logger.error(f"Error during password hash comparison (e.g., invalid hash format): {ve}")
        return False
    except Exception as e:
        logger.error(f"An unexpected error occurred during kill switch reset: {e}")
        return False

# When this module is imported, it immediately checks the persistent state.
# If the kill switch is active, a warning is logged.
# The actual stopping of the main application will happen in users/main.py
# (or the main application loop) by checking is_kill_switch_active().