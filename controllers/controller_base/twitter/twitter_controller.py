# twitter/twitter_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class TwitterController(ControllerBase):
    def __init__(self):
        """
        Initializes the TwitterController with the API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('TWITTER_API_KEY')
        self.base_url = "https://api.twitter.com/2/"

        if not self.api_key:
            self.logger.error("Twitter API key not found in environment variables.")
            raise ValueError("Twitter API key is missing.")
        
        self.logger.info("TwitterController initialized with API key.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific Twitter-related task, such as posting a tweet or retrieving the timeline.

        Args:
            task_name (str): The name of the task to execute (e.g., 'post_tweet', 'get_timeline', 'search_tweets').
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task (e.g., tweet content, query).
        """
        try:
            self.logger.info(f"Executing Twitter task '{task_name}' for user '{user_id}'.")
            if task_name == "post_tweet":
                if task_data:
                    self.post_tweet(task_data.get("tweet_content"), user_id)
                else:
                    self.logger.error("Missing task data for 'post_tweet' task.")
            elif task_name == "get_timeline":
                self.get_timeline(user_id)
            elif task_name == "search_tweets":
                if task_data:
                    self.search_tweets(task_data.get("query"), user_id)
                else:
                    self.logger.error("Missing task data for 'search_tweets' task.")
            else:
                self.logger.error(f"Unknown Twitter task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def post_tweet(self, tweet_content: str, user_id: Optional[str] = None):
        """
        Posts a tweet on behalf of the user.

        Args:
            tweet_content (str): The content of the tweet to post.
            user_id (Optional[str]): The ID of the user posting the tweet.
        """
        endpoint = f"{self.base_url}tweets"
        data = {
            "text": tweet_content
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        response = self._make_api_request(endpoint, method="POST", data=data, headers=headers)

        if response:
            self.logger.info(f"Tweet posted successfully for user '{user_id}': {response.get('data', {}).get('id')}")
        else:
            self.logger.error(f"Failed to post tweet for user '{user_id}'.")

    def get_timeline(self, user_id: Optional[str] = None):
        """
        Retrieves the user's timeline.

        Args:
            user_id (Optional[str]): The ID of the user requesting the timeline.
        """
        endpoint = f"{self.base_url}users/{user_id}/tweets"
        params = {
            "max_results": 10
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        response = self._make_api_request(endpoint, method="GET", params=params, headers=headers)

        if response:
            tweets = response.get('data', [])
            self.logger.info(f"Timeline for user '{user_id}':")
            for tweet in tweets:
                self.logger.info(f"- {tweet['text']} (Tweet ID: {tweet['id']})")
        else:
            self.logger.error(f"Failed to retrieve timeline for user '{user_id}'.")

    def search_tweets(self, query: str, user_id: Optional[str] = None):
        """
        Searches for tweets based on a query.

        Args:
            query (str): The search query to find tweets.
            user_id (Optional[str]): The ID of the user performing the search.
        """
        endpoint = f"{self.base_url}tweets/search/recent"
        params = {
            "query": query,
            "max_results": 10
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        response = self._make_api_request(endpoint, method="GET", params=params, headers=headers)

        if response:
            tweets = response.get('data', [])
            self.logger.info(f"Search results for query '{query}' for user '{user_id}':")
            for tweet in tweets:
                self.logger.info(f"- {tweet['text']} (Tweet ID: {tweet['id']})")
        else:
            self.logger.error(f"Failed to search tweets for query '{query}' for user '{user_id}'.")

    def _make_api_request(self, endpoint: str, method: str = "GET", params: Optional[Dict] = None, data: Optional[Dict] = None, headers: Optional[Dict] = None) -> Optional[Dict]:
        """
        Makes an API request to Twitter's API.

        Args:
            endpoint (str): The API endpoint to call.
            method (str): The HTTP method (GET, POST, etc.).
            params (Optional[Dict]): URL parameters for GET requests.
            data (Optional[Dict]): The data for POST/PUT requests.
            headers (Optional[Dict]): HTTP headers.

        Returns:
            Optional[Dict]: The JSON response from the API or None if an error occurs.
        """
        try:
            if method == "GET":
                response = requests.get(endpoint, params=params, headers=headers)
            elif method == "POST":
                response = requests.post(endpoint, json=data, headers=headers)
            else:
                self.logger.error(f"Unsupported HTTP method: {method}")
                return None

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
            user_id (Optional[str]): The ID of the user associated with the error (if applicable).
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic can be implemented here.
