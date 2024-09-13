import os
import json
import logging
from time import sleep
from common_utils import setup_logging

# Set up logging
setup_logging('ai_modules/input/logs/motion_detector_log.txt')

def detect_motion():
    """
    Simulates motion detection.
    Returns True if motion is detected, False otherwise.
    """
    from random import randint
    return bool(randint(0, 1))

def save_motion_data(status):
    """
    Saves motion detection status (True/False) to a JSON file.
    """
    file_path = 'ai_modules/input/environmental_sensors/motion_detector/motion_data.json'
    
    if os.path.exists(file_path):
        with open(file_path, 'r') as json_file:
            motion_data = json.load(json_file)
    else:
        motion_data = []

    from datetime import datetime
    motion_data.append({
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'motion_detected': status
    })

    with open(file_path, 'w') as json_file:
        json.dump(motion_data, json_file, indent=4)
    logging.info(f"Motion detection status saved: {status}")

def monitor_motion():
    """
    Continuously monitors motion and logs events.
    """
    while True:
        motion_status = detect_motion()
        if motion_status:
            logging.info("Motion detected!")
        else:
            logging.info("No motion detected.")
        
        save_motion_data(motion_status)
        sleep(5)  # Monitor every 5 seconds

if __name__ == "__main__":
    monitor_motion()
