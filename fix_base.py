import re

with open("providers/base.py", "r") as f:
    content = f.read()

addition = """
    async def chat(self, messages: List[dict]) -> str:
        \"\"\"
        Non-streaming chat response.
        Default implementation accumulates the stream.
        \"\"\"
        out = ""
        async for chunk in self.stream_response(messages):
            out += chunk
        return out

    async def chat_with_tools(self, messages: List[dict], tools: List[dict], system: str = "") -> dict:
        \"\"\"
        Send a message with tools.
        Default implementation returns empty dict.
        \"\"\"
        return {}
"""

if "async def chat(" not in content:
    content = content.replace("    async def stream_response_thinking(", addition + "\n    async def stream_response_thinking(")

with open("providers/base.py", "w") as f:
    f.write(content)
