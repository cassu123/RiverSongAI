import os
import requests
import json
from dotenv import load_dotenv
import logging
from common_utils import setup_logging, SPORTS_API_KEY

# Set up logging
setup_logging('ai_modules/input/data_feeds/logs/sports_feed_log.txt')

def get_live_scores():
    """
    Fetches live sports scores using a sports API.
    Logs success or error and saves data to a JSON file.
    """
    url = f'https://api.sportsapi.com/soccer-scores/live?apiKey={SPORTS_API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        sports_data = response.json()
        logging.info("Successfully fetched live sports scores")
        save_sports_data(sports_data)
        return sports_data
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to fetch live sports scores: {str(e)}")
        return None

def save_sports_data(data):
    """
    Saves sports data into a JSON file.
    """
    file_path = f'ai_modules/input/data_feeds/storage/sports_data.json'
    try:
        with open(file_path, 'w') as json_file:
            json.dump(data, json_file, indent=4)
        logging.info(f"Sports data saved to {file_path}")
    except IOError as e:
        logging.error(f"Error saving sports data: {str(e)}")

if __name__ == "__main__":
    sports_scores = get_live_scores()
    print(sports_scores)
