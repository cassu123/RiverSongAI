import os
import requests
from dotenv import load_dotenv

load_dotenv()

SPORTS_API_KEY = os.getenv('SPORTS_API_KEY')

def get_live_scores():
    url = f'https://api.sportradar.com/soccer-t3/eu/en/schedules/live.json?api_key={SPORTS_API_KEY}'
    response = requests.get(url)
    scores_data = response.json()
    return scores_data

if __name__ == "__main__":
    scores = get_live_scores()
    print(scores)
