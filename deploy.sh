#!/bin/bash
# deploy.sh — pull latest changes from GitHub and restart River Song AI
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Pulling latest from GitHub..."
git pull origin main

echo "==> Installing Python dependencies..."
source venv/bin/activate
pip install "setuptools<71" --quiet
pip install pybind11 --quiet
pip install -r requirements.txt --no-build-isolation --quiet

echo "==> Ensuring espeak-ng data path..."
sudo mkdir -p /usr/share/espeak-ng-data
sudo ln -sf /usr/lib/x86_64-linux-gnu/espeak-ng-data/* /usr/share/espeak-ng-data/ 2>/dev/null || true

echo "==> Downloading voice models (new voices only)..."
python scripts/download_voices.py

echo "==> Building frontend..."
cd frontend
npm install --legacy-peer-deps --silent
npm run build
cd ..

echo "==> Restarting service..."
sudo systemctl restart river-song

echo "==> Done. River Song is live at http://localhost:8000"
sudo systemctl status river-song --no-pager -l
