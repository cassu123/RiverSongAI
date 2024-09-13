import os
import requests
import json
from dotenv import load_dotenv
import logging
from common_utils import setup_logging, ALPHA_VANTAGE_API_KEY

# Set up logging
setup_logging('ai_modules/input/data_feeds/logs/stock_feed_log.txt')

def get_stock_data(symbol):
    """
    Fetches stock data for a specific symbol using Alpha Vantage API.
    Logs success or error and saves data to a JSON file.
    """
    url = f'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={ALPHA_VANTAGE_API_KEY}'
    try:
        response = requests.get(url)
        response.raise_for_status()
        stock_data = response.json()
        logging.info(f"Successfully fetched stock data for {symbol}")
        save_stock_data(symbol, stock_data)
        return stock_data
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to fetch stock data for {symbol}: {str(e)}")
        return None

def save_stock_data(symbol, data):
    """
    Saves stock data into a JSON file.
    """
    file_path = f'ai_modules/input/data_feeds/storage/stock_data.json'
    try:
        with open(file_path, 'w') as json_file:
            json.dump(data, json_file, indent=4)
        logging.info(f"Stock data for {symbol} saved to {file_path}")
    except IOError as e:
        logging.error(f"Error saving stock data for {symbol}: {str(e)}")

if __name__ == "__main__":
    stock_symbol = "AAPL"
    stock_data = get_stock_data(stock_symbol)
    print(stock_data)
