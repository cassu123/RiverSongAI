import os
import requests
import json
from dotenv import load_dotenv
import logging
from common_utils import setup_logging, NEWS_API_KEY

# Set up logging
setup_logging('ai_modules/input/data_feeds/logs/news_feed_log.txt')

def get_latest_news(query, language='en'):
    """
    Fetches the latest news articles based on a query using NewsAPI.
    Logs success or error and saves data to a JSON file.
    """
    url = f'https://newsapi.org/v2/everything?q={query}&language={language}&apiKey={NEWS_API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        news_data = response.json()
        logging.info(f"Successfully fetched news for query: {query}")
        save_news_data(query, news_data)
        return news_data['articles']
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to fetch news for {query}: {str(e)}")
        return None

def save_news_data(query, data):
    """
    Saves news data into a JSON file.
    """
    file_path = f'ai_modules/input/data_feeds/storage/news_data.json'
    try:
        with open(file_path, 'w') as json_file:
            json.dump(data, json_file, indent=4)
        logging.info(f"News data for query {query} saved to {file_path}")
    except IOError as e:
        logging.error(f"Error saving news data for query {query}: {str(e)}")

if __name__ == "__main__":
    search_query = "technology"
    news_articles = get_latest_news(search_query)
    print(news_articles)
