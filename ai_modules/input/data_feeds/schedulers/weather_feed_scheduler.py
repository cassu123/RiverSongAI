import schedule
import time
from api_data_feeds.weather_feed import get_weather_data

def job():
    city_name = "New York"
    weather = get_weather_data(city_name)
    print(weather)

# Schedule the job every hour
schedule.every(1).hour.do(job)

while True:
    schedule.run_pending()
    time.sleep(1)
