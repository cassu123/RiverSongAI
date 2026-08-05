#!/bin/bash
echo "Restarting River Song backend..."
sudo systemctl restart river-song 2>/dev/null || pkill -f "python main.py"
echo "Backend restarted! Please refresh your browser."
