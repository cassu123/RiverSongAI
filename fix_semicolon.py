import re

with open("core/conversation_loop.py", "r") as f:
    content = f.read()

# Replace assert ... ; async for ... with proper indentation
content = re.sub(
    r"(\s*)assert (self\._[a-z]+) is not None; (async for .*?:)",
    r"\1assert \2 is not None\n\1\3",
    content
)

# Also fix "assert ... ; res = await ..." since it's cleaner, though not strictly a syntax error, it's better
content = re.sub(
    r"(\s*)assert (self\._[a-z]+) is not None; ([a-zA-Z_]+ = await .*?\()",
    r"\1assert \2 is not None\n\1\3",
    content
)
content = re.sub(
    r"(\s*)assert (self\._[a-z]+) is not None; (await .*?\()",
    r"\1assert \2 is not None\n\1\3",
    content
)

with open("core/conversation_loop.py", "w") as f:
    f.write(content)
