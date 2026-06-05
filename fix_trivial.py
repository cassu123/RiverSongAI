import os
import re

# Fix remote_ollama chat return type
with open("providers/llm/remote_ollama.py", "r") as f:
    content = f.read()
content = content.replace(
    '    async def chat(self, messages: List[dict]) -> dict:',
    '    async def chat(self, messages: List[dict]) -> str:'
)
with open("providers/llm/remote_ollama.py", "w") as f:
    f.write(content)

# Fix core/deep_research.py int conversion
with open("core/deep_research.py", "r") as f:
    content = f.read()
content = content.replace(
    'max_results = min(int(filters.get("count", 3)), 10)',
    'max_results = min(int(filters.get("count", 3) or 3), 10)'
)
with open("core/deep_research.py", "w") as f:
    f.write(content)

# Fix intent_router provider imports
with open("core/intent_router.py", "r") as f:
    content = f.read()

def replace_or_pass(src, dst):
    global content
    content = content.replace(src, dst)

replace_or_pass(
    'from providers.feeds.weather import build_weather_provider, extract_location_from_transcript, extract_day_from_transcript',
    'from providers.feeds.weather import WeatherProvider, extract_location_from_transcript, extract_day_from_transcript'
)
replace_or_pass(
    'provider = build_weather_provider()',
    'provider = WeatherProvider()'
)
replace_or_pass(
    'from providers.feeds.news import build_news_provider, extract_category_from_transcript, extract_topic_from_transcript',
    'from providers.feeds.news import NewsProvider, extract_category_from_transcript, extract_topic_from_transcript'
)
replace_or_pass(
    'provider = build_news_provider()',
    'provider = NewsProvider()'
)
replace_or_pass(
    'from providers.feeds.stocks import build_stocks_provider, extract_ticker_from_transcript',
    'from providers.feeds.stocks import StocksProvider, extract_ticker_from_transcript'
)
replace_or_pass(
    'provider = build_stocks_provider()',
    'provider = StocksProvider()'
)
replace_or_pass(
    'from providers.feeds.sports import build_sports_provider, extract_team_from_transcript',
    'from providers.feeds.sports import SportsProvider, extract_team_from_transcript'
)
replace_or_pass(
    'provider = build_sports_provider()',
    'provider = SportsProvider()'
)

with open("core/intent_router.py", "w") as f:
    f.write(content)

# Fix api/routes/vision.py string type
with open("api/routes/vision.py", "r") as f:
    content = f.read()
content = content.replace(
    'result = await vision.analyze_image(prompt, base64_image)',
    'result = await vision.analyze_image(prompt or "", base64_image)'
)
with open("api/routes/vision.py", "w") as f:
    f.write(content)

# Fix api/routes/vector_fleet.py typing
with open("api/routes/vector_fleet.py", "r") as f:
    content = f.read()
content = content.replace(
    '_TEACH_WAYPOINTS = {}',
    '_TEACH_WAYPOINTS: dict[str, list] = {}'
)
with open("api/routes/vector_fleet.py", "w") as f:
    f.write(content)

# Fix core/limiter.py types
with open("core/limiter.py", "r") as f:
    content = f.read()
content = content.replace(
    'payload = decode_token(token)',
    'payload = decode_token(token) or {}'
)
with open("core/limiter.py", "w") as f:
    f.write(content)

