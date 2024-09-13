import os
import json
import logging
from time import sleep
from common_utils import setup_logging

# Set up logging
setup_logging('ai_modules/input/logs/humidity_sensor_log.txt')

def get_humidity():
    """
    Simulates a humidity sensor reading.
    Returns a random humidity percentage.
    """
    from random import uniform
    return round(uniform(30.0, 70.0), 2)

def save_humidity_data(humidity):
    """
    Saves humidity data to a JSON file.
    """
    file_path = 'ai_modules/input/environmental_sensors/humidity_sensor/humidity_data.json'
    
    if os.path.exists(file_path):
        with open(file_path, 'r') as json_file:
            humidity_data = json.load(json_file)
    else:
        humidity_data = []

    from datetime import datetime
    humidity_data.append({
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'humidity': humidity
    })

    with open(file_path, 'w') as json_file:
        json.dump(humidity_data, json_file, indent=4)
    logging.info(f"Humidity data saved: {humidity}%")

def monitor_humidity():
    """
    Continuously monitors humidity and logs events.
    """
    while True:
        current_humidity = get_humidity()
        logging.info(f"Current humidity: {current_humidity}%")
        save_humidity_data(current_humidity)
        sleep(15)  # Monitor every 15 seconds

if __name__ == "__main__":
    monitor_humidity()
