import re

with open("api/routes/conversation.py", "r") as f:
    content = f.read()

content = content.replace(
    'on_event=lambda evt: asyncio.create_task(_send(websocket, evt)),',
    'on_event=lambda evt: _send(websocket, evt),'
)

with open("api/routes/conversation.py", "w") as f:
    f.write(content)
