import re

with open("core/conversation_loop.py", "r") as f:
    content = f.read()

# Fix self._generation_task unpacking / None check
content = content.replace(
    'if self._generation_task and not self._generation_task.done():',
    'if self._generation_task is not None and not self._generation_task.done():'
)
content = content.replace(
    'if getattr(self, "_generation_task", None):',
    'if self._generation_task is not None:'
)
content = content.replace(
    'self._generation_task.cancel()',
    'if self._generation_task is not None: self._generation_task.cancel()'
)

# Fix LLM None checks
content = content.replace('res = await self._llm.chat(', 'assert self._llm is not None; res = await self._llm.chat(')
content = content.replace('async for chunk in self._llm.stream_response(', 'assert self._llm is not None; async for chunk in self._llm.stream_response(')
content = content.replace('async for chunk in self._llm.stream_response_thinking(', 'assert self._llm is not None; async for chunk in self._llm.stream_response_thinking(')
content = content.replace('async for tool_call in self._llm.chat_with_tools(', 'assert self._llm is not None; async for tool_call in self._llm.chat_with_tools(')

# Fix TTS None checks
content = content.replace('await self._tts.synthesize(', 'assert self._tts is not None; await self._tts.synthesize(')
content = content.replace('async for audio in self._tts.stream_synthesize(', 'assert self._tts is not None; async for audio in self._tts.stream_synthesize(')

# Fix STT None checks
content = content.replace('text = await self._stt.transcribe(', 'assert self._stt is not None; text = await self._stt.transcribe(')

# Fix MemoryManager None checks
content = content.replace('config = await self._memory._store.get_admin_config()', 'assert self._memory is not None; config = await self._memory._store.get_admin_config()')
content = content.replace('store = self._memory._store', 'assert self._memory is not None; store = self._memory._store')

with open("core/conversation_loop.py", "w") as f:
    f.write(content)
