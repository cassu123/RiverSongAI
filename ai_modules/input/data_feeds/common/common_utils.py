import os
import logging
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

# Initialize logging with dynamic log levels (default is INFO)
def setup_logging(log_file, log_level=logging.INFO):
    """
    Sets up logging configuration for the given log file and log level.
    Args:
        log_file (str): Path to the log file.
        log_level (logging level): Logging level (DEBUG, INFO, WARNING, etc.).
    """
    logging.basicConfig(filename=log_file, level=log_level,
                        format='%(asctime)s - %(levelname)s - %(message)s')

# Common API keys loaded from environment variables
WEATHER_API_KEY = os.getenv('WEATHER_API_KEY')
ALPHA_VANTAGE_API_KEY = os.getenv('ALPHA_VANTAGE_API_KEY')
NEWS_API_KEY = os.getenv('NEWS_API_KEY')
SPORTS_API_KEY = os.getenv('SPORTS_API_KEY')

# Add additional API keys as needed
REDDIT_CLIENT_ID = os.getenv('REDDIT_CLIENT_ID')
REDDIT_CLIENT_SECRET = os.getenv('REDDIT_CLIENT_SECRET')
TWITTER_API_KEY = os.getenv('TWITTER_API_KEY')
TWITTER_API_SECRET = os.getenv('TWITTER_API_SECRET')

# Utility to fetch API keys dynamically
def get_api_key(api_name):
    """
    Returns the API key for the specified service.
    Args:
        api_name (str): Name of the API to fetch the key for.
    Returns:
        str: API key if available, None if not found.
    """
    api_key_map = {
        'weather': WEATHER_API_KEY,
        'alpha_vantage': ALPHA_VANTAGE_API_KEY,
        'news': NEWS_API_KEY,
        'sports': SPORTS_API_KEY,
        'reddit': REDDIT_CLIENT_ID,
        'twitter': TWITTER_API_KEY
    }
    return api_key_map.get(api_name, None)

