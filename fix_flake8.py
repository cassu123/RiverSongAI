import re

# Fix Union in core/conversation_loop.py
with open("core/conversation_loop.py", "r") as f:
    content = f.read()
if 'from typing import Union' not in content:
    content = content.replace('from typing import Any', 'from typing import Union, Any')
with open("core/conversation_loop.py", "w") as f:
    f.write(content)

# Fix F811 redefinition in api/routes/models_settings.py
with open("api/routes/models_settings.py", "r") as f:
    content = f.read()
content = content.replace(
    'from api.routes.auth import bad_request, forbidden, not_found, unauthorized',
    '# removed duplicate import'
)
with open("api/routes/models_settings.py", "w") as f:
    f.write(content)

# Fix F811 redefinition in api/routes/rag.py
with open("api/routes/rag.py", "r") as f:
    content = f.read()
content = content.replace(
    'from fastapi import Header',
    '# removed duplicate import Header'
)
with open("api/routes/rag.py", "w") as f:
    f.write(content)

# Fix F541 in api/routes/reading.py
with open("api/routes/reading.py", "r") as f:
    content = f.read()
content = content.replace(
    'f"Total pages:"',
    '"Total pages:"'
)
content = content.replace(
    'f"Status:"',
    '"Status:"'
)
with open("api/routes/reading.py", "w") as f:
    f.write(content)

# Fix intent_router.py undefined names
with open("core/intent_router.py", "r") as f:
    content = f.read()
content = content.replace("WeatherProvider()", "build_weather_provider()")
content = content.replace("NewsProvider()", "build_news_provider()")
content = content.replace("StocksProvider()", "build_stocks_provider()")
content = content.replace("SportsProvider()", "build_sports_provider()")
with open("core/intent_router.py", "w") as f:
    f.write(content)

# Fix providers/base.py F811
with open("providers/base.py", "r") as f:
    content = f.read()
content = re.sub(r'    @abstractmethod\s+async def stream_synthesize\(self, text: str\) -> AsyncGenerator\[bytes, None\]:\s+pass', '', content)
with open("providers/base.py", "w") as f:
    f.write(content)

# Fix providers/google/auth.py F811
with open("providers/google/auth.py", "r") as f:
    content = f.read()
content = content.replace("import argparse", "# import argparse")
with open("providers/google/auth.py", "w") as f:
    f.write(content)
