import re

# Fix core/conversation_loop.py
with open("core/conversation_loop.py", "r") as f:
    content = f.read()
content = content.replace(
    'from typing import Any, AsyncGenerator, Callable, Dict, List, Optional',
    'from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Union'
)
# Add asserts
for replace_line in [
    'response_content = await self._llm.chat_with_tools(',
    'async for chunk in self._llm.stream_response(messages):',
    'async for chunk in self._llm.stream_response_thinking(messages):',
]:
    content = content.replace(replace_line, f'assert self._llm is not None\n            {replace_line.lstrip()}')

with open("core/conversation_loop.py", "w") as f:
    f.write(content)

# Fix api/routes/vector_fleet.py
with open("api/routes/vector_fleet.py", "r") as f:
    content = f.read()
content = content.replace(
    '_TEACH_WAYPOINTS: dict[str, list] = {}',
    '_TEACH_WAYPOINTS: dict[tuple[str, str], list] = {}'
)
with open("api/routes/vector_fleet.py", "w") as f:
    f.write(content)

# Fix core/limiter.py
with open("core/limiter.py", "r") as f:
    content = f.read()
content = content.replace(
    'payload = decode_token(token) or {}',
    'payload: dict = decode_token(token) or {}'
)
with open("core/limiter.py", "w") as f:
    f.write(content)

# Fix api/routes/models_settings.py
with open("api/routes/models_settings.py", "r") as f:
    content = f.read()
content = content.replace(
    'payload = decode_token(authorization.removeprefix("Bearer ")) if authorization else {}',
    'payload: dict = decode_token(authorization.removeprefix("Bearer ")) if authorization else {}'
)
with open("api/routes/models_settings.py", "w") as f:
    f.write(content)

# Fix api/routes/vehicles.py
with open("api/routes/vehicles.py", "r") as f:
    content = f.read()
content = content.replace(
    'prompt = f"""Vehicle: {v.year}',
    'assert v is not None; prompt = f"""Vehicle: {v.year}'
)
with open("api/routes/vehicles.py", "w") as f:
    f.write(content)
