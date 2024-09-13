import os
import json
import logging
from time import sleep
from common_utils import setup_logging

# Set up logging
setup_logging('ai_modules/input/logs/temperature_sensor_log.txt')

def get_temperature():
    """
    Simulates a temperature sensor reading.
    Returns a random temperature value.
    """
    from random import uniform
    return round(uniform(15.0, 30.0), 2)

def save_temperature_data(temperature):
    """
    Saves temperature data to a JSON file.
    """
    file_path = 'ai_modules/input/environmental_sensors/temperature_sensor/temperature_data.json'
    
    if os.path.exists(file_path):
        with open(file_path, 'r') as json_file:
            temperature_data = json.load(json_file)
    else:
        temperature_data = []

    from datetime import datetime
    temperature_data.append({
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'temperature': temperature
    })

    with open(file_path, 'w') as json_file:
        json.dump(temperature_data, json_file, indent=4)
    logging.info(f"Temperature data saved: {temperature}°C")

def monitor_temperature():
    """
    Continuously monitors temperature and logs events.
    """
    while True:
        current_temp = get_temperature()
        logging.info(f"Current temperature: {current_temp}°C")
        save_temperature_data(current_temp)
        sleep(10)  # Monitor every 10 seconds

if __name__ == "__main__":
    monitor_temperature()
