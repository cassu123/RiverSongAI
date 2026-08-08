#!/usr/bin/env bash
set -e

# Change to the root of the repository
cd "$(dirname "$0")/.."

echo "Setting up local test environment..."

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Installing dependencies..."
# Filter out speexdsp if it causes issues on some systems, or let it install
grep -v '^speexdsp' requirements.txt > /tmp/req-local.txt
pip install -r /tmp/req-local.txt -r requirements-dev.txt

echo "Running tests..."
pytest -q "$@"
