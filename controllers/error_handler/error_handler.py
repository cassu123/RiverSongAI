import logging
from typing import Optional, Callable
import openai
import os
import time

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Set up OpenAI API Key from environment variable
openai.api_key = os.getenv('OPENAI_API_KEY', 'YOUR_OPENAI_API_KEY')  # Replace with your key if not using environment variable

def log_error(error_message: str) -> None:
    """
    Logs an error message to the logging system.

    Args:
        error_message (str): The error message to log.
    """
    logging.error(error_message)

def user_friendly_error(error_message: str) -> str:
    """
    Converts a technical error message into a user-friendly message.

    Args:
        error_message (str): The technical error message.

    Returns:
        str: A user-friendly error message.
    """
    if "ConnectionError" in error_message:
        return "We are experiencing network issues. Please check your internet connection."
    elif "Timeout" in error_message:
        return "The request timed out. Please try again later."
    elif "ValueError" in error_message:
        return "An unexpected value was encountered. Please check your input."
    else:
        return "An unexpected error occurred. Please try again."

def analyze_error_with_ai(error_message: str) -> Optional[str]:
    """
    Uses an AI model to analyze and suggest a solution for an error message.

    Args:
        error_message (str): The error message to analyze.

    Returns:
        Optional[str]: Suggested solution or analysis of the error.
    """
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an expert Python developer."},
                {"role": "user", "content": f"Analyze the following error message and suggest a solution: {error_message}"}
            ],
            max_tokens=150
        )
        return response.choices[0].message['content'].strip()
    except Exception as e:
        log_error(f"AI analysis failed: {e}")
        return None

def retry_on_error(func: Callable, retries: int = 3, delay: float = 1.0, backoff: float = 2.0, custom_handler: Optional[Callable[[Exception], None]] = None) -> Callable:
    """
    Decorator to retry a function if an error occurs, with optional delay, backoff, and custom error handling.

    Args:
        func (Callable): The function to retry.
        retries (int): The number of retries to attempt.
        delay (float): The initial delay between retries in seconds.
        backoff (float): The factor by which the delay increases after each retry.
        custom_handler (Optional[Callable[[Exception], None]]): Custom error handling logic to apply on each failure.

    Returns:
        Callable: A wrapped function that retries on error.
    """
    def wrapper(*args, **kwargs):
        attempt = 0
        current_delay = delay
        while attempt < retries:
            try:
                return func(*args, **kwargs)
            except Exception as e:
                log_error(f"Error on attempt {attempt + 1}: {e}")
                if custom_handler:
                    custom_handler(e)
                attempt += 1
                if attempt < retries:
                    logging.info(f"Retrying in {current_delay} seconds...")
                    time.sleep(current_delay)
                    current_delay *= backoff
                else:
                    user_message = user_friendly_error(str(e))
                    logging.info(user_message)
                    return None
    return wrapper
