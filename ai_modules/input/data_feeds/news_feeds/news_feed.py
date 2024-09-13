import os
import requests
from dotenv import load_dotenv

load_dotenv()

NEWS_API_KEY = os.getenv('NEWS_API_KEY')

def get_latest_news(query):
    url = f'https://newsapi.org/v2/everything?q={query}&apiKey={NEWS_API_KEY}'
    response = requests.get(url)
    news_data = response.json()
    return news_data

if __name__ == "__main__":
    news = get_latest_news('technology')
    print(news)
