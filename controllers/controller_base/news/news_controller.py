# news/news_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class NewsController(ControllerBase):
    def __init__(self):
        """
        Initializes the NewsController with the API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('NEWS_API_KEY')
        self.base_url = "https://newsapi.org/v2/"
        
        if not self.api_key:
            self.logger.error("News API key not found in environment variables.")
            raise ValueError("News API key is missing.")
        
        self.logger.info("NewsController initialized with API key.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific news-related task, such as fetching top headlines or searching news by topic.

        Args:
            task_name (str): The name of the task to execute (e.g., 'fetch_headlines', 'search_news').
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task (e.g., search query).
        """
        try:
            self.logger.info(f"Executing news task '{task_name}' for user '{user_id}'.")
            if task_name == "fetch_headlines":
                self.fetch_headlines(user_id, task_data.get('category'), task_data.get('region'))
            elif task_name == "search_news":
                if task_data:
                    self.search_news(task_data.get("query"), user_id)
                else:
                    self.logger.error("Missing task data for 'search_news'.")
            else:
                self.logger.error(f"Unknown news task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def fetch_headlines(self, user_id: Optional[str] = None, category: Optional[str] = None, region: Optional[str] = None):
        """
        Fetches top news headlines from the NewsAPI.

        Args:
            user_id (Optional[str]): The ID of the user requesting the headlines.
            category (Optional[str]): The category of news to fetch (e.g., 'business', 'entertainment', 'sports').
            region (Optional[str]): The region to fetch news from (e.g., 'us', 'au', 'de').
        """
        endpoint = f"{self.base_url}top-headlines"
        params = {
            "country": region or "us",
            "category": category,
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)
        
        if response:
            articles = response.get('articles', [])
            if articles:
                self.logger.info(f"Top headlines for user '{user_id}':")
                for article in articles:
                    self.logger.info(f"- {article['title']} ({article['source']['name']})")
            else:
                self.logger.info(f"No headlines found for user '{user_id}'.")
        else:
            self.logger.error(f"Failed to fetch headlines for user '{user_id}'.")

    def search_news(self, query: str, user_id: Optional[str] = None):
        """
        Searches for news articles based on a query.

        Args:
            query (str): The search query for the news articles.
            user_id (Optional[str]): The ID of the user performing the search.
        """
        endpoint = f"{self.base_url}everything"
        params = {
            "q": query,
            "apiKey": self.api_key
        }
        response = self._make_api_request(endpoint, params=params)
        
        if response:
            articles = response.get('articles', [])
            if articles:
                self.logger.info(f"Search results for query '{query}' for user '{user_id}':")
                for article in articles:
                    self.logger.info(f"- {article['title']} ({article['source']['name']})")
            else:
                self.logger.info(f"No news articles found for query '{query}' and user '{user_id}'.")
        else:
            self.logger.error(f"Failed to search news for query '{query}' and user '{user_id}'.")

    def _make_api_request(self, endpoint: str, params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Makes an API request to the NewsAPI.

        Args:
            endpoint (str): The API endpoint to call.
            params (Optional[Dict]): The URL parameters for the API request.

        Returns:
            Optional[Dict]: The JSON response from the API or None if an error occurs.
        """
        try:
            response = requests.get(endpoint, params=params)
            response.raise_for_status()
            self.logger.info(f"API request to {endpoint} successful.")
            return response.json()
        except requests.exceptions.HTTPError as e:
            self.logger.error(f"HTTP error occurred: {e}")
            self._handle_error(e)
        except requests.exceptions.ConnectionError as e:
            self.logger.error(f"Connection error occurred: {e}")
            self._handle_error(e)
        except requests.exceptions.Timeout as e:
            self.logger.error(f"Request timed out: {e}")
            self._handle_error(e)
        except requests.exceptions.RequestException as e:
            self.logger.error(f"API request error: {e}")
            self._handle_error(e)

        return None

    def _handle_error(self, error: Exception, user_id: Optional[str] = None):
        """
        Handles errors by logging them and possibly notifying users.

        Args:
            error (Exception): The error encountered.
            user_id (Optional[str]): The ID of the user associated with the error.
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic could be added here.
