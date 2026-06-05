import re
import sys

def modify_file(filepath, replacements):
    with open(filepath, 'r') as f:
        content = f.read()
    
    for old, new in replacements.items():
        if old in content:
            content = content.replace(old, new)
        else:
            print(f"Warning: '{old}' not found in {filepath}")
            
    with open(filepath, 'w') as f:
        f.write(content)

# family_migration.py: Remove unused user_row assignment
modify_file("core/family_migration.py", {
    "            user_row = conn.execute(\n                \"SELECT email FROM biz_users WHERE id=?\", (puid,)\n            ).fetchone()\n": ""
})

# intent_router.py: Remove unused want_low_stock
modify_file("core/intent_router.py", {
    "        want_low_stock = any(\n            kw in lower\n            for kw in (\"low stock\", \"running low\", \"out of stock\", \"restock\", \"inventory\")\n        )\n": ""
})

# tools.py: Remove unused variables and imports
modify_file("core/tools.py", {
    "import json\n": "",
    "from typing import Any, Dict, List, Optional\n": "from typing import Any, Dict\n",
    "        from datetime import datetime, time as dt_time\n": "        from datetime import datetime\n",
    "        duration = args.get(\"duration_minutes\", 30)\n        \n": "",
    "        from vehicles.management import get_vehicles, create_service_log, update_check_point\n": "        from vehicles.management import get_vehicles, create_service_log\n",
    "        from vehicles.models import VehicleCheckPoint\n": "",
    "        library_only = args.get(\"library_only\", False)\n        \n": "",
    "        task = await provider.create_task(title=title, notes=notes)\n": "        await provider.create_task(title=title, notes=notes)\n"
})

# conversation_loop.py: Remove unused json
modify_file("core/conversation_loop.py", {
    "import json\n": ""
})

# family.py: Remove unused Optional
modify_file("core/family.py", {
    "from typing import Optional\n": ""
})

# memory_manager.py: Remove unused imports
modify_file("core/memory_manager.py", {
    "from datetime import datetime, timezone\n": "",
    "from providers.memory.ttl_engine import calculate_expires_at, extend_ttl, is_expired\n": "from providers.memory.ttl_engine import calculate_expires_at, extend_ttl\n",
    "        from providers.memory.models import LLMSettings\n": ""
})

# wake_word_service.py: Remove unused imports
modify_file("core/wake_word_service.py", {
    "import asyncio\n": "",
    "from typing import Optional, Callable\n": "from typing import Callable\n",
    "            import openwakeword\n": ""
})
