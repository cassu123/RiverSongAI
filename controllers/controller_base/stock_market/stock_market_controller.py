# stock_market/stock_market_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class StockMarketController(ControllerBase):
    def __init__(self):
        """
        Initializes the StockMarketController with the API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('STOCK_MARKET_API_KEY')
        self.base_url = "https://api.stockmarketplatform.com/v1/"

        if not self.api_key:
            self.logger.error("Stock Market API key not found in environment variables.")
            raise ValueError("Stock Market API key is missing.")

        self.logger.info("StockMarketController initialized with API key.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific stock market-related task, such as fetching stock prices or retrieving historical data.

        Args:
            task_name (str): The name of the task to execute (e.g., 'get_current_price', 'get_historical_data', 'manage_portfolio').
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task (e.g., stock symbol, date range).
        """
        try:
            self.logger.info(f"Executing stock market task '{task_name}' for user '{user_id}'.")
            if task_name == "get_current_price":
                if task_data:
                    self.get_current_price(task_data.get("symbol"), user_id)
                else:
                    self.logger.error("Missing task data for 'get_current_price' task.")
            elif task_name == "get_historical_data":
                if task_data:
                    self.get_historical_data(task_data.get("symbol"), task_data.get("start_date"), task_data.get("end_date"), user_id)
                else:
                    self.logger.error("Missing task data for 'get_historical_data' task.")
            elif task_name == "manage_portfolio":
                if task_data:
                    self.manage_portfolio(task_data.get("portfolio"), user_id)
                else:
                    self.logger.error("Missing task data for 'manage_portfolio' task.")
            else:
                self.logger.error(f"Unknown stock market task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def get_current_price(self, symbol: str, user_id: Optional[str] = None):
        """
        Fetches the current price of a specific stock.

        Args:
            symbol (str): The stock symbol to fetch the price for.
            user_id (Optional[str]): The ID of the user requesting the price.
        """
        endpoint = f"{self.base_url}quote"
        params = {
            "symbol": symbol,
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)

        if response:
            price = response.get('price')
            self.logger.info(f"Current price for stock '{symbol}' for user '{user_id}': ${price}")
        else:
            self.logger.error(f"Failed to fetch current price for stock '{symbol}' for user '{user_id}'.")

    def get_historical_data(self, symbol: str, start_date: str, end_date: str, user_id: Optional[str] = None):
        """
        Fetches historical data for a specific stock over a given date range.

        Args:
            symbol (str): The stock symbol to fetch historical data for.
            start_date (str): The start date of the historical data range.
            end_date (str): The end date of the historical data range.
            user_id (Optional[str]): The ID of the user requesting the data.
        """
        endpoint = f"{self.base_url}historical"
        params = {
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)

        if response:
            self.logger.info(f"Historical data for stock '{symbol}' from {start_date} to {end_date} for user '{user_id}': {response}")
        else:
            self.logger.error(f"Failed to fetch historical data for stock '{symbol}' for user '{user_id}'.")

    def manage_portfolio(self, portfolio: Dict[str, float], user_id: Optional[str] = None):
        """
        Manages a user's portfolio by calculating gains/losses.

        Args:
            portfolio (Dict[str, float]): A dictionary containing the user's portfolio with stock symbols as keys and the number of shares as values.
            user_id (Optional[str]): The ID of the user requesting the task.
        """
        current_prices = {}
        gains_losses = {}

        for symbol, shares in portfolio.items():
            current_price = self.get_current_price(symbol, user_id)
            if current_price:
                gain_loss = (current_price - portfolio[symbol]) * shares
                gains_losses[symbol] = gain_loss
                self.logger.info(f"Gains/losses for stock '{symbol}' in user '{user_id}'s portfolio: ${gain_loss}")
            else:
                self.logger.error(f"Failed to calculate gains/losses for stock '{symbol}' in user '{user_id}'s portfolio.")
                return

        total_gains_losses = sum(gains_losses.values())
        self.logger.info(f"Total gains/losses for user '{user_id}'s portfolio: ${total_gains_losses}")

    def _make_api_request(self, endpoint: str, method: str = "GET", params: Optional[Dict] = None, data: Optional[Dict] = None, limit: int = 3) -> Optional[Dict]:
        """
        Makes an API request to the stock market platform.

        Args:
            endpoint (str): The API endpoint to call.
            method (str): The HTTP method (GET, POST, etc.).
            params (Optional[Dict]): URL parameters for GET requests.
            data (Optional[Dict]): The data for POST/PUT requests.
            limit (int): The number of retries for the request if it fails.

        Returns:
            Optional[Dict]: The JSON response from the API or None if an error occurs.
        """
        for attempt in range(limit):
            try:
                if method == "GET":
                    response = requests.get(endpoint, params=params)
                elif method == "POST":
                    response = requests.post(endpoint, json=data)
                else:
                    self.logger.error(f"Unsupported HTTP method: {method}")
                    return None

                response.raise_for_status()
                self.logger.info(f"API request to {endpoint} successful.")
                return response.json()
            except requests.exceptions.RequestException as e:
                self.logger.error(f"API request error: {e}")
                if attempt < limit - 1:
                    self.logger.info(f"Retrying API request to {endpoint} ({attempt + 1}/{limit})...")
                else:
                    self.logger.error(f"Failed to make API request to {endpoint} after {limit} retries.")
                    return None

        return None

    def _handle_error(self, error: Exception, user_id: Optional[str] = None):
        """
        Handles errors by logging them and possibly notifying users.

        Args:
            error (Exception): The error encountered.
            user_id (Optional[str]): The ID of the user associated with the error (if applicable).
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic could be added here.
