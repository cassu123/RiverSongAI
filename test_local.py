import urllib.request
import json

try:
    req = urllib.request.Request("http://127.0.0.1:8000/api/models")
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        enabled = data.get("enabled_providers", {})
        print("API Response for enabled_providers:")
        print(json.dumps(enabled, indent=2))
except Exception as e:
    print(f"Error fetching: {e}")
