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
pip install -r requirements.txt --no-build-isolation --quiet

echo "==> Building frontend..."
cd frontend
npm install --silent
npm run build
cd ..

echo "==> Restarting service..."
sudo systemctl restart river-song

echo "==> Done. River Song is live at http://localhost:8000"
sudo systemctl status river-song --no-pager -l
