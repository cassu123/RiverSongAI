import logging
from typing import Optional, Callable
import openai
import os
import time
import threading

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Set up OpenAI API Key from environment variable
openai.api_key = os.getenv('OPENAI_API_KEY', 'YOUR_OPENAI_API_KEY')

# Create a thread-safe lock for concurrent logging and AI analysis
lock = threading.Lock()

def log_error(error_message: str, level: str = 'ERROR') -> None:
    """
    Logs an error message with a specified logging level.

    Args:
        error_message (str): The error message to log.
        level (str): The severity level of the error ('ERROR', 'WARNING', 'INFO').
    """
    with lock:
        if level == 'ERROR':
            logging.error(error_message)
        elif level == 'WARNING':
            logging.warning(error_message)
        elif level == 'INFO':
            logging.info(error_message)
        else:
            logging.error(f"Invalid logging level: {level}. Logging as ERROR by default.")
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
        with lock:
            log_error(f"AI analysis failed: {e}", level='WARNING')
        return None


def retry_on_error(func: Callable, retries: int = 3, delay: float = 1.0, backoff: float = 2.0, custom_handler: Optional[Callable[[Exception], None]] = None, error_level: str = 'ERROR') -> Callable:
    """
    Decorator to retry a function if an error occurs, with optional delay, backoff, and custom error handling.

    Args:
        func (Callable): The function to retry.
        retries (int): The number of retries to attempt.
        delay (float): The initial delay between retries in seconds.
        backoff (float): The factor by which the delay increases after each retry.
        custom_handler (Optional[Callable[[Exception], None]]): Custom error handling logic to apply on each failure.
        error_level (str): The severity level of the error ('ERROR', 'WARNING', 'INFO').

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
                with lock:
                    log_error(f"Error on attempt {attempt + 1}: {e}", level=error_level)
                if custom_handler:
                    custom_handler(e)
                attempt += 1
                if attempt < retries:
                    logging.info(f"Retrying in {current_delay} seconds...")
                    time.sleep(current_delay)
                    current_delay *= backoff
                else:
                    user_message = user_friendly_error(str(e))
                    with lock:
                        logging.info(user_message)
                    return None
    return wrapper


def global_error_handler(exc_type, exc_value, exc_traceback) -> None:
    """
    Global handler for unhandled exceptions. This logs and attempts AI-based analysis for crashes.

    Args:
        exc_type: Exception type.
        exc_value: Exception instance.
        exc_traceback: Traceback object for the exception.
    """
    error_message = f"Unhandled exception occurred: {exc_value}"
    with lock:
        log_error(error_message)
        ai_suggestion = analyze_error_with_ai(str(exc_value))
        if ai_suggestion:
            logging.info(f"AI Suggestion: {ai_suggestion}")


# Example of setting the global error handler in the main application
if __name__ == "__main__":
    import sys
    sys.excepthook = global_error_handler  # Set the global error handler for unhandled exceptions

    # Example function to test the retry mechanism
    @retry_on_error
    def sample_function():
        raise ValueError("Simulated ValueError for testing")

    try:
        sample_function()
    except Exception as e:
        log_error(f"Unhandled exception: {e}")
