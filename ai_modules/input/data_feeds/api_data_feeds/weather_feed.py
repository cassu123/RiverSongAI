import os
import requests
import json
from dotenv import load_dotenv
import logging
from common_utils import setup_logging, WEATHER_API_KEY

# Set up logging
setup_logging('ai_modules/input/data_feeds/logs/weather_feed_log.txt')

def get_weather_data(city):
    """
    Fetches weather data for a specific city using OpenWeatherMap API.
    Logs success or error and saves data to a JSON file.
    """
    url = f'http://api.openweathermap.org/data/2.5/weather?q={city}&appid={WEATHER_API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        logging.info(f"Successfully fetched weather data for {city}")
        save_weather_data(city, data)
        return data
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to fetch weather data for {city}: {str(e)}")
        return None

def save_weather_data(city, data):
    """
    Saves weather data into a JSON file.
    """
    file_path = f'ai_modules/input/data_feeds/storage/weather_data.json'
    try:
        with open(file_path, 'w') as json_file:
            json.dump(data, json_file, indent=4)
        logging.info(f"Weather data for {city} saved to {file_path}")
    except IOError as e:
        logging.error(f"Error saving weather data for {city}: {str(e)}")

if __name__ == "__main__":
    city_name = "New York"
    weather = get_weather_data(city_name)
    print(weather)
