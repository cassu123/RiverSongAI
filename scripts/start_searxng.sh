#!/bin/bash
# Start SearXNG locally for River Song AI.
# First-time setup:
#   pip install searx
#   searx-checker  (optional: verifies engines work)
# Then just run this script whenever you want unlimited search.

cd ~/searxng 2>/dev/null || (
    echo "SearXNG not found at ~/searxng."
    echo "Run: git clone https://github.com/searxng/searxng ~/searxng && cd ~/searxng && pip install -e ."
    exit 1
)

echo "Starting SearXNG on http://localhost:8080 ..."
python -m searx.webapp
