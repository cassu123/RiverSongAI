# weather/weather_controller.py
import os
import logging
from typing import Optional, Dict
from controller_base.controller_base import ControllerBase
from dotenv import load_dotenv
import requests

class WeatherController(ControllerBase):
    def __init__(self):
        """
        Initializes the WeatherController with the API key and basic setup.
        """
        super().__init__()
        load_dotenv()
        self.api_key = os.getenv('WEATHER_API_KEY')
        self.base_url = "https://api.openweathermap.org/data/2.5/"

        if not self.api_key:
            self.logger.error("Weather API key not found in environment variables.")
            raise ValueError("Weather API key is missing.")

        self.logger.info("WeatherController initialized with API key.")

    def execute(self, task_name: str, user_id: Optional[str] = None, task_data: Optional[Dict] = None):
        """
        Executes a specific weather-related task, such as fetching current weather or forecasts.

        Args:
            task_name (str): The name of the task to execute (e.g., 'get_current_weather', 'get_forecast').
            user_id (Optional[str]): The ID of the user requesting the task.
            task_data (Optional[Dict]): Additional data required for the task (e.g., location).
        """
        try:
            self.logger.info(f"Executing weather task '{task_name}' for user '{user_id}'.")
            if task_name == "get_current_weather":
                if task_data:
                    self.get_current_weather(task_data.get("location"), user_id)
                else:
                    self.logger.error("Missing task data for 'get_current_weather' task.")
            elif task_name == "get_forecast":
                if task_data:
                    self.get_forecast(task_data.get("location"), user_id)
                else:
                    self.logger.error("Missing task data for 'get_forecast' task.")
            else:
                self.logger.error(f"Unknown weather task: {task_name}")
        except Exception as e:
            self._handle_error(e, user_id)

    def get_current_weather(self, location: str, user_id: Optional[str] = None):
        """
        Fetches the current weather for a specific location.

        Args:
            location (str): The location for which to fetch the weather.
            user_id (Optional[str]): The ID of the user requesting the weather.
        """
        endpoint = f"{self.base_url}weather"
        params = {
            "q": location,
            "appid": self.api_key,
            "units": "metric"  # Use "imperial" for Fahrenheit
        }
        response = self._make_api_request(endpoint, params=params)

        if response:
            weather = response.get('weather', [{}])[0].get('description', 'No description')
            temperature = response.get('main', {}).get('temp', 'No temperature data')
            self.logger.info(f"Current weather in {location} for user '{user_id}': {weather}, {temperature}°C")
        else:
            self.logger.error(f"Failed to fetch current weather for location '{location}' for user '{user_id}'.")

    def get_forecast(self, location: str, user_id: Optional[str] = None):
        """
        Fetches the weather forecast for a specific location.

        Args:
            location (str): The location for which to fetch the forecast.
            user_id (Optional[str]): The ID of the user requesting the forecast.
        """
        endpoint = f"{self.base_url}forecast"
        params = {
            "q": location,
            "appid": self.api_key,
            "units": "metric"
        }
        response = self._make_api_request(endpoint, params=params)

        if response:
            forecast_list = response.get('list', [])
            self.logger.info(f"Weather forecast for {location} for user '{user_id}':")
            for forecast in forecast_list[:5]:  # Show the first 5 forecast entries
                weather = forecast.get('weather', [{}])[0].get('description', 'No description')
                temperature = forecast.get('main', {}).get('temp', 'No temperature data')
                date = forecast.get('dt_txt', 'No date')
                self.logger.info(f"- {date}: {weather}, {temperature}°C")
        else:
            self.logger.error(f"Failed to fetch forecast for location '{location}' for user '{user_id}'.")

    def _make_api_request(self, endpoint: str, params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Makes an API request to the weather service.

        Args:
            endpoint (str): The API endpoint to call.
            params (Optional[Dict]): URL parameters for the API request.

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
            user_id (Optional[str]): The ID of the user associated with the error (if applicable).
        """
        self.logger.error(f"An error occurred for user '{user_id}': {error}")
        # Additional error handling logic can be implemented here.
