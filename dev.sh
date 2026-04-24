#!/bin/bash
# Stop the systemd service and any orphan processes on 8000, then start dev server.
sudo systemctl stop river-song 2>/dev/null
sudo fuser -k 8000/tcp 2>/dev/null
sleep 0.5

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/venv/bin/activate"

echo "==> Starting frontend (http://localhost:5173)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo "==> Starting backend (http://localhost:8000)..."
cd "$SCRIPT_DIR"
python main.py

# When backend stops (Ctrl+C), kill the frontend too
kill $FRONTEND_PID 2>/dev/null
