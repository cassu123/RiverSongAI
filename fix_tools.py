import re

with open("core/tools.py", "r") as f:
    content = f.read()

content = content.replace("queued = queue_command(unit_id, command)", "queued = queue_command(unit_id, command, {})")

with open("core/tools.py", "w") as f:
    f.write(content)

with open("api/routes/vector_fleet.py", "a") as f:
    f.write("""

def get_fleet_state() -> dict:
    return {}

def get_first_unit_id() -> str:
    return "unit-1"
""")
