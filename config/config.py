import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Access API keys securely
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Function to print keys (for testing purposes)
def show_keys():
    print(f"OpenAI API Key: {OPENAI_API_KEY}")
    print(f"Gemini API Key: {GEMINI_API_KEY}")

# Example function using the API keys
def use_openai():
    if not OPENAI_API_KEY:
        print("Error: OpenAI API key not found.")
    else:
        print("Using OpenAI with API key")

use_openai()
