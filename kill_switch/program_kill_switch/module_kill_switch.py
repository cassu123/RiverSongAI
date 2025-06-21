# Path: kill_switch/program_kill_switch/module_kill_switch.py

# ... (imports and logging setup) ...

# Brief Description: This Python file defines a ModuleKillSwitch class.
# Its purpose is to allow the control and monitoring of individual River Song AI modules.
# You can turn these specific modules "off" (stop their operation) or "on" (allow them to resume)
# independently, without shutting down the entire system.
# ... (rest of the code) ...



import os
import json
import logging
import sys

# --- Setup Logging ---
# Get a named logger for this module.
logger = logging.getLogger(__name__)
if not logger.handlers: # Prevent adding handlers multiple times if imported
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO) # Set to INFO by default, can be changed centrally

# --- Module Switch State Management ---
# This file will persistently store the state of individual module switches.
# It's placed in the 'logs' directory, similar to the global kill switch state.
MODULE_SWITCH_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'logs', 'module_switch_state.json')

class ModuleKillSwitch:
    def __init__(self):
        """
        Initializes the ModuleKillSwitch.
        Loads existing module switch states from file, or sets defaults if file not found.
        """
        self.module_switches = {
            'Dropshipping': False,   # Initially inactive due to project scope change, but included for completeness
            'AI Categorization': False, # Example for your husband's tasks
            'Automation': False,     # Generic automation tasks
            'Email Monitoring': False, # For the email_controller functionality
            'Medical Insights': False, # For the medical modules
            # Add more specific modules as needed, e.g., 'Smart Home Control', 'Voice Commands'
        }
        self._load_state() # Attempt to load state on initialization

    def _get_state_file_path(self) -> str:
        """Helper to get the absolute path of the state file and ensure its directory exists."""
        state_dir = os.path.dirname(MODULE_SWITCH_STATE_FILE)
        if not os.path.exists(state_dir):
            os.makedirs(state_dir)
        return MODULE_SWITCH_STATE_FILE

    def _load_state(self):
        """Loads the module switch states from a JSON file."""
        file_path = self._get_state_file_path()
        try:
            with open(file_path, 'r') as f:
                loaded_state = json.load(f)
                # Update existing switches and add new ones from file if they exist
                self.module_switches.update(loaded_state)
                logger.info(f"Loaded module switch states from '{file_path}'.")
        except FileNotFoundError:
            logger.info(f"Module switch state file '{file_path}' not found. Initializing with default states.")
            self._save_state() # Save defaults to create the file
        except json.JSONDecodeError:
            logger.error(f"Error decoding JSON from '{file_path}'. File might be corrupted. Initializing with default states.")
            self._save_state() # Overwrite with defaults
        except Exception as e:
            logger.error(f"An unexpected error occurred while loading module states from '{file_path}': {e}")
            self._save_state() # Attempt to save defaults

    def _save_state(self):
        """Saves the current module switch states to a JSON file."""
        file_path = self._get_state_file_path()
        try:
            with open(file_path, 'w') as f:
                json.dump(self.module_switches, f, indent=4)
            logger.info(f"Saved module switch states to '{file_path}'.")
        except Exception as e:
            logger.error(f"Failed to save module switch states to '{file_path}': {e}")

    def activate_switch(self, module_name: str):
        """
        Activates (stops) a specific module.
        A module being 'active' (True) means it is paused/stopped by the switch.
        """
        if module_name in self.module_switches:
            if not self.module_switches[module_name]: # Only change if it's currently False (running)
                self.module_switches[module_name] = True
                self._save_state()
                logger.warning(f"'{module_name}' module ACTIVATED (stopped) by kill switch.")
            else:
                logger.info(f"'{module_name}' module is already activated (stopped).")
        else:
            logger.error(f"Attempted to activate unknown module: '{module_name}'. Add it to module_switches.")

    def deactivate_switch(self, module_name: str):
        """
        Deactivates (resumes) a specific module.
        A module being 'inactive' (False) means it is allowed to run.
        """
        if module_name in self.module_switches:
            if self.module_switches[module_name]: # Only change if it's currently True (stopped)
                self.module_switches[module_name] = False
                self._save_state()
                logger.info(f"'{module_name}' module DEACTIVATED (resumed) by kill switch.")
            else:
                logger.info(f"'{module_name}' module is already deactivated (resumed).")
        else:
            logger.error(f"Attempted to deactivate unknown module: '{module_name}'. Add it to module_switches.")

    def is_module_active(self, module_name: str) -> bool:
        """
        Checks if a specific module is flagged as active (stopped/paused) by the kill switch.
        Args:
            module_name (str): The name of the module to check.
        Returns:
            bool: True if the module is flagged as stopped, False if allowed to run (or unknown module).
        """
        # Return True if the switch for this module is ON (meaning the module should be inactive)
        return self.module_switches.get(module_name, False) # Default to False if module not explicitly listed

    def get_all_module_states(self) -> dict:
        """Returns a dictionary of all module names and their current switch states."""
        return self.module_switches.copy() # Return a copy to prevent direct modification


# Example of how other modules or a main controller might use this
if __name__ == "__main__":
    module_switcher = ModuleKillSwitch()

    logger.info("Initial module states:")
    print(module_switcher.get_all_module_states())

    # Simulate stopping a module
    module_switcher.activate_switch('AI Categorization')
    module_switcher.activate_switch('NonExistentModule') # Example of unknown module

    logger.info("\nModule states after activation:")
    print(module_switcher.get_all_module_states())

    # Simulate a restart by creating a new instance
    logger.info("\nSimulating restart...")
    restarted_switcher = ModuleKillSwitch()
    logger.info("States after restart (should be persistent):")
    print(restarted_switcher.get_all_module_states())

    # Simulate a module checking its state
    if restarted_switcher.is_module_active('AI Categorization'):
        logger.warning("AI Categorization module detected its switch is active. It should halt operations.")
    else:
        logger.info("AI Categorization module detected its switch is inactive. It can continue operations.")

    # Simulate resuming a module
    restarted_switcher.deactivate_switch('AI Categorization')
    logger.info("\nModule states after deactivation:")
    print(restarted_switcher.get_all_module_states())

    # Clean up the test state file for real operation (optional in a test script)
    try:
        os.remove(MODULE_SWITCH_STATE_FILE)
        logger.info(f"Cleaned up test state file: {MODULE_SWITCH_STATE_FILE}")
    except OSError:
        pass