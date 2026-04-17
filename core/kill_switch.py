# =============================================================================
# core/kill_switch.py
#
# Global kill switch for River Song AI.
#
# Sourced from the original kill_switch/global_kill_switch/global_kill_switch.py
# in the legacy repo. Logic is preserved exactly as written. Only the path
# to the state file has been adjusted for the new directory layout:
# this file lives at core/kill_switch.py, so one `..` reaches the project root
# where the `logs/` directory resides (versus two `..` in the original).
#
# How it works:
#   - On import, the kill switch reads its last known state from a file in logs/.
#   - Any module can call is_kill_switch_active() to check if shutdown is needed.
#   - activate_global_kill_switch() writes GLOBAL KILL ACTIVATED to the state
#     file and sets the in-memory flag. The main loop must poll is_kill_switch_active().
#   - reset_global_kill_switch() requires a bcrypt password (hash stored in .env)
#     and writes GLOBAL KILL RESET to the file. The system must be restarted
#     after reset.
# =============================================================================

import os
import sys
import logging
from dotenv import load_dotenv
import bcrypt

# --- Setup Logging ---
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# --- Global Kill Switch State Management ---
# State file lives in river-song-v2/logs/ (one level up from core/)
KILL_SWITCH_STATE_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..',
    'logs',
    'kill_switch_state.txt'
)

# In-memory state of the kill switch, read from file on startup
_is_kill_switch_active = False


def _read_kill_switch_state() -> bool:
    """
    Read the persistent kill switch state from a file.
    Returns True if 'GLOBAL KILL ACTIVATED', False otherwise.
    """
    try:
        if not os.path.exists(os.path.dirname(KILL_SWITCH_STATE_FILE)):
            os.makedirs(os.path.dirname(KILL_SWITCH_STATE_FILE))

        with open(KILL_SWITCH_STATE_FILE, 'r') as f:
            state = f.read().strip()
            if state == 'GLOBAL KILL ACTIVATED':
                logger.warning(
                    "Kill switch state file indicates GLOBAL KILL IS ACTIVE at '%s'.",
                    KILL_SWITCH_STATE_FILE,
                )
                return True
            elif state == 'GLOBAL KILL RESET':
                logger.info(
                    "Kill switch state file indicates GLOBAL KILL IS RESET at '%s'.",
                    KILL_SWITCH_STATE_FILE,
                )
                return False
    except FileNotFoundError:
        logger.info(
            "Kill switch state file '%s' not found. Assuming reset state.",
            KILL_SWITCH_STATE_FILE,
        )
        _write_kill_switch_state('GLOBAL KILL RESET')
    except Exception as e:
        logger.error(
            "Error reading kill switch state file '%s': %s",
            KILL_SWITCH_STATE_FILE, e,
        )
    return False


def _write_kill_switch_state(state: str):
    """
    Write the kill switch state to the designated file.

    Args:
        state (str): 'GLOBAL KILL ACTIVATED' or 'GLOBAL KILL RESET'.
    """
    try:
        if not os.path.exists(os.path.dirname(KILL_SWITCH_STATE_FILE)):
            os.makedirs(os.path.dirname(KILL_SWITCH_STATE_FILE))

        with open(KILL_SWITCH_STATE_FILE, 'w') as f:
            f.write(state + '\n')
        logger.debug("Kill switch state '%s' written to '%s'.", state, KILL_SWITCH_STATE_FILE)
    except Exception as e:
        logger.critical(
            "CRITICAL ERROR: Could not write kill switch state to '%s': %s",
            KILL_SWITCH_STATE_FILE, e,
        )


# Load state on module import so the system honours a prior kill on restart
_is_kill_switch_active = _read_kill_switch_state()

# --- Password Handling ---
_PASSWORD_HASH_STORED = None


def _load_password_hash_from_env():
    """
    Load the bcrypt password hash from the KILL_SWITCH_PASSWORD_HASH env var.
    This hash is what input passwords are compared against for reset.
    """
    global _PASSWORD_HASH_STORED
    load_dotenv()
    _PASSWORD_HASH_STORED = os.getenv('KILL_SWITCH_PASSWORD_HASH')
    if not _PASSWORD_HASH_STORED:
        logger.critical(
            "CRITICAL: KILL_SWITCH_PASSWORD_HASH environment variable not set. "
            "Kill switch reset is unprotected or non-functional!"
        )
        logger.critical(
            "Set KILL_SWITCH_PASSWORD_HASH in .env with a bcrypt hash. "
            "Generate one with: "
            "python -c \"import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()))\""
        )
    else:
        logger.info("Kill switch password hash loaded successfully.")


_load_password_hash_from_env()


def is_kill_switch_active() -> bool:
    """
    Return the current in-memory state of the global kill switch.

    Other modules should call this at the start of each operation to
    determine whether they should abort and initiate graceful shutdown.

    Returns:
        bool: True if the kill switch has been activated, False otherwise.
    """
    return _is_kill_switch_active


def activate_global_kill_switch(origin: str = "Unknown"):
    """
    Activate the global kill switch, signalling the system to shut down.

    The state is written to disk immediately so it persists across restarts.
    The actual shutdown must be triggered by the main application loop
    checking is_kill_switch_active() on each iteration.

    Args:
        origin (str): Who or what triggered the activation (for logging).
    """
    global _is_kill_switch_active
    _is_kill_switch_active = True
    _write_kill_switch_state('GLOBAL KILL ACTIVATED')
    logger.critical(
        "GLOBAL KILL SWITCH ACTIVATED by '%s'! System signalling for graceful shutdown.",
        origin,
    )


def reset_global_kill_switch(input_password: str) -> bool:
    """
    Reset the global kill switch after successful password verification.

    Requires the correct plain-text password whose bcrypt hash is stored
    in the KILL_SWITCH_PASSWORD_HASH environment variable. After a
    successful reset, the system must be restarted to resume normal operation.

    Args:
        input_password (str): Plain-text password entered by the user.

    Returns:
        bool: True if reset succeeded, False if password was wrong or hash missing.
    """
    global _is_kill_switch_active
    global _PASSWORD_HASH_STORED

    if not _PASSWORD_HASH_STORED:
        logger.error("Cannot reset kill switch: no password hash loaded.")
        return False

    try:
        if bcrypt.checkpw(
            input_password.encode('utf-8'),
            _PASSWORD_HASH_STORED.encode('utf-8'),
        ):
            _is_kill_switch_active = False
            _write_kill_switch_state('GLOBAL KILL RESET')
            logger.info("Global kill switch reset. Restart the system to resume operation.")
            return True
        else:
            logger.warning("Incorrect password for kill switch reset. Access denied.")
            return False
    except ValueError as ve:
        logger.error("Error during password hash comparison (invalid hash format?): %s", ve)
        return False
    except Exception as e:
        logger.error("Unexpected error during kill switch reset: %s", e)
        return False
