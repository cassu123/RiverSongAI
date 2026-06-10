#!/bin/bash
# deploy.sh — pull latest changes from GitHub and restart River Song AI
#
# Usage:
#   ./deploy.sh            full deploy (pull, install, build, restart)
#   ./deploy.sh --backup   backup databases + .env only (no deploy, no restart)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ts() { date '+%H:%M:%S'; }
step() { echo ""; echo "[$(ts)] ==> $*"; }
trap 'echo ""; echo "[$(ts)] !! Deploy failed at: ${BASH_COMMAND}" >&2' ERR

# ---------------------------------------------------------------------------
# Backup mode — used by the emergency-backup endpoint (api/routes/health.py).
# Must never pull code or restart the service.
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--backup" ]]; then
    BACKUP_DIR="${RS_BACKUP_DIR:-/mnt/data/river-song/backups}"
    mkdir -p "$BACKUP_DIR" 2>/dev/null || BACKUP_DIR="$SCRIPT_DIR/backups"
    mkdir -p "$BACKUP_DIR"
    STAMP="$(date '+%Y%m%d-%H%M%S')"
    ARCHIVE="$BACKUP_DIR/river-song-$STAMP.tar.gz"
    step "Backing up databases and .env to $ARCHIVE"
    FILES=(data/*.db)
    [[ -f .env ]] && FILES+=(.env)
    [[ -f data/.token_encryption_key ]] && FILES+=(data/.token_encryption_key)
    tar -czf "$ARCHIVE" "${FILES[@]}"
    chmod 600 "$ARCHIVE"
    # Keep the 14 most recent backups
    ls -1t "$BACKUP_DIR"/river-song-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
    step "Backup complete: $ARCHIVE"
    exit 0
fi

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
pip install --quiet pybind11
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

step "Ensuring TOKEN_ENCRYPTION_KEY in .env"
# Integration tokens (Google/Shopify/Amazon) are encrypted with this key.
# Without it in .env, the app used to invent a new key per restart, orphaning
# every stored token. Generate once here so the key survives forever.
if grep -q '^TOKEN_ENCRYPTION_KEY=..*' .env 2>/dev/null; then
    echo "    (already set)"
else
    if [[ -s data/.token_encryption_key ]]; then
        RS_TOKEN_KEY="$(cat data/.token_encryption_key)"
        echo "    (adopting key previously auto-generated at data/.token_encryption_key)"
    else
        RS_TOKEN_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
        echo "    (generated new key and saved it to .env)"
    fi
    sed -i '/^TOKEN_ENCRYPTION_KEY=$/d' .env 2>/dev/null || true
    printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$RS_TOKEN_KEY" >> .env
    chmod 600 .env
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
PKG_HASH_FILE="../.npm_package.sha256"
NEW_PKG_HASH="$(sha256sum package.json package-lock.json 2>/dev/null | sha256sum | awk '{print $1}')"
OLD_PKG_HASH="$(cat "$PKG_HASH_FILE" 2>/dev/null || echo '')"
if [[ "$NEW_PKG_HASH" != "$OLD_PKG_HASH" ]]; then
    npm install --legacy-peer-deps --silent
    echo "$NEW_PKG_HASH" > "$PKG_HASH_FILE"
else
    echo "    (package.json unchanged — skipping npm install)"
fi
npm run build
cd ..

step "Evicting any orphan process holding :8000"
# systemctl restart can't reclaim port 8000 if a non-systemd `python main.py`
# is still bound (happens when someone runs the app manually for testing).
# Find the listening PID and ask the systemd cgroup which PID(s) the service
# legitimately owns; kill anything else.
PORT_PID="$(ss -ltnp 2>/dev/null | grep ':8000 ' | grep -oP 'pid=\K\d+' | head -1)"
if [[ -n "$PORT_PID" ]]; then
    SVC_PIDS="$(systemctl show -p MainPID --value river-song 2>/dev/null || echo '')"
    if [[ "$PORT_PID" != "$SVC_PIDS" ]]; then
        echo "    Found orphan PID $PORT_PID on :8000 (systemd MainPID=$SVC_PIDS) — sending TERM"
        kill -TERM "$PORT_PID" 2>/dev/null || sudo kill -TERM "$PORT_PID"
        # Give it ~5s to release the port
        for _ in 1 2 3 4 5; do
            sleep 1
            ss -ltnp 2>/dev/null | grep -q ":8000 " || break
        done
    fi
fi

step "Restarting service"
sudo systemctl restart river-song

step "Done — River Song is live at https://riversongai.com (tunnel → :8000)"
sudo systemctl status river-song --no-pager -l
