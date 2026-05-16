#!/bin/bash
# deploy.sh — pull latest changes from GitHub and restart River Song AI
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ts() { date '+%H:%M:%S'; }
step() { echo ""; echo "[$(ts)] ==> $*"; }
trap 'echo ""; echo "[$(ts)] !! Deploy failed at: ${BASH_COMMAND}" >&2' ERR

step "Pulling latest from GitHub"
git pull --ff-only origin main

step "Activating virtualenv"
if [[ ! -f venv/bin/activate ]]; then
    echo "!! venv/ missing — run 'python3 -m venv venv' first" >&2
    exit 1
fi
source venv/bin/activate

step "Installing Python dependencies"
# Build-time prereqs (idempotent; pip skips if already satisfied)
pip install --quiet "setuptools<71" pybind11
# Only reinstall requirements when the lockfile changed
REQ_HASH_FILE=".venv_requirements.sha256"
NEW_HASH="$(sha256sum requirements.txt | awk '{print $1}')"
OLD_HASH="$(cat "$REQ_HASH_FILE" 2>/dev/null || echo '')"
if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
    pip install -r requirements.txt --no-build-isolation --quiet
    echo "$NEW_HASH" > "$REQ_HASH_FILE"
else
    echo "    (requirements.txt unchanged — skipping pip install)"
fi

step "Ensuring espeak-ng data path"
ESPEAK_TARGET=/usr/share/espeak-ng-data
if [[ ! -d "$ESPEAK_TARGET" ]] || [[ -z "$(ls -A "$ESPEAK_TARGET" 2>/dev/null)" ]]; then
    sudo mkdir -p "$ESPEAK_TARGET"
    sudo ln -sf /usr/lib/x86_64-linux-gnu/espeak-ng-data/* "$ESPEAK_TARGET/" 2>/dev/null || true
else
    echo "    (espeak-ng-data already populated)"
fi

step "Downloading voice models (new voices only)"
python scripts/download_voices.py

step "Building frontend"
cd frontend
rm -rf dist
npm install --legacy-peer-deps --silent
npm run build
cd ..

step "Restarting service"
sudo systemctl restart river-song

step "Done — River Song is live at https://riversongai.com (tunnel → :8000)"
sudo systemctl status river-song --no-pager -l
