# =============================================================================
# providers/feeds/__init__.py
#
# Information feed provider package for River Song AI.
#
# Modules:
#   weather  - OpenWeatherMap: current conditions and 5-day forecast.
#              Handles day-of-week queries ("what's the weather Friday").
#   news     - NewsAPI.org: top headlines and topic search.
#              Handles category queries ("tech news", "sports headlines").
#   stocks   - Alpha Vantage: real-time stock quotes and daily change.
#              Handles company name -> ticker resolution for voice queries.
#   sports   - TheSportsDB: recent game results by team name.
#              Handles "how did the Cubs do" style queries.
#
# All providers require API keys set in .env. See .env.example for details.
# All public methods are async. HTTP calls use httpx.AsyncClient.
# =============================================================================
