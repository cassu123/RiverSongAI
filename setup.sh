#!/usr/bin/env bash
# =============================================================================
# setup.sh -- River Song AI environment setup
#
# Run this once from the project root after cloning the repo.
# Safe to re-run -- every step checks whether work is already done.
#
# What this does:
#   1. Python packages  -- pip install -r requirements.txt
#   2. Piper binary     -- downloads latest release for your arch
#   3. Piper voices     -- en_US-lessac-medium + en_US-amy-medium
#   4. .env setup       -- creates from .env.example, writes Piper paths
#   5. Kill switch      -- prompts for a password, writes bcrypt hash to .env
#   6. Ollama models    -- pulls all configured local models
#   7. Frontend         -- npm install + npm run build
#   8. Systemd service  -- installs and enables river-song.service
#   9. Verification     -- confirms every critical import and path resolves
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Requirements:
#   python3, pip3, node, npm, curl
#   sudo access (for apt-get and /usr/local/bin write)
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Style helpers
# ---------------------------------------------------------------------------

BOLD='\033[1m'
RESET='\033[0m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'

step()    { echo -e "\n${CYAN}${BOLD}▶ $*${RESET}"; }
info()    { echo -e "  ${DIM}$*${RESET}"; }
ok()      { echo -e "  ${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "  ${YELLOW}⚠ $*${RESET}"; }
die()     { echo -e "\n${RED}${BOLD}✗ FATAL: $*${RESET}\n"; exit 1; }

ERRORS=()
soft_error() { ERRORS+=("$*"); echo -e "  ${RED}✗ $*${RESET}"; }

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

step "Checking prerequisites"

[[ -f "main.py" ]] || die "Run this script from the River Song project root (where main.py lives)."

command -v python3 &>/dev/null || die "python3 not found. Install Python 3.11 or later."
command -v pip3    &>/dev/null || die "pip3 not found."
command -v node    &>/dev/null || die "node not found. Install Node.js 18+."
command -v npm     &>/dev/null || die "npm not found."
command -v curl    &>/dev/null || die "curl not found."

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
info "Python $PYTHON_VERSION"
info "Node $(node --version)"
info "npm $(npm --version)"

# ---------------------------------------------------------------------------
# Detect OS and architecture
# ---------------------------------------------------------------------------

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  PIPER_OS="linux" ;;
  Darwin) PIPER_OS="macos" ;;
  *)      die "Unsupported OS: $OS. This script supports Linux and macOS." ;;
esac

case "$ARCH" in
  x86_64)        PIPER_ARCH="x86_64" ;;
  aarch64|arm64) PIPER_ARCH="aarch64" ;;
  *)             die "Unsupported architecture: $ARCH." ;;
esac

[[ "$PIPER_OS" == "macos" && "$PIPER_ARCH" == "x86_64" ]]  && PIPER_ARCH="x64"
[[ "$PIPER_OS" == "macos" && "$PIPER_ARCH" == "aarch64" ]] && PIPER_ARCH="aarch64"

info "Detected: $OS / $ARCH"

# ---------------------------------------------------------------------------
# Helper: safely update a variable in .env
# ---------------------------------------------------------------------------

env_set() {
  local key="$1"
  local value="$2"
  local file=".env"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    current=$(grep "^${key}=" "$file" | head -1 | cut -d= -f2-)
    if [[ -z "$current" ]]; then
      sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
      info "Set ${key}"
    else
      info "${key} already set -- skipping"
    fi
  else
    echo "${key}=${value}" >> "$file"
    info "Added ${key}"
  fi
}

# ---------------------------------------------------------------------------
# STEP 1: Python packages
# ---------------------------------------------------------------------------

step "Step 1/9 -- Python packages"

if [[ ! -d "venv" ]]; then
  info "Creating Python virtual environment..."
  python3 -m venv venv || die "Failed to create venv."
fi

source venv/bin/activate

python3 -c "import pkg_resources" 2>/dev/null || {
  info "Pinning setuptools<71..."
  pip3 install "setuptools<71" --quiet 2>&1 | grep -v "already satisfied" | sed 's/^/  /' || true
}

pip3 install wheel --quiet 2>&1 | grep -v "already satisfied" | sed 's/^/  /' || true

pip3 install -r requirements.txt --no-build-isolation --quiet 2>&1 | \
  grep -v "^$\|Requirement already\|already satisfied\|yanked" | \
  head -30 | sed 's/^/  /' || true

ok "Python packages installed"

# ---------------------------------------------------------------------------
# STEP 2: Piper binary
# ---------------------------------------------------------------------------

step "Step 2/9 -- Piper TTS binary"

PIPER_BIN="/usr/local/bin/piper"

if [[ -x "$PIPER_BIN" ]]; then
  ok "Piper already installed at $PIPER_BIN"
else
  info "Fetching latest Piper release info from GitHub..."

  PIPER_TAG=$(curl -s "https://api.github.com/repos/rhasspy/piper/releases/latest" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)

  if [[ -z "$PIPER_TAG" ]]; then
    soft_error "Could not fetch Piper release info."
    PIPER_TAG="2023.11.14-2"
    warn "Falling back to known version $PIPER_TAG"
  fi

  info "Piper version: $PIPER_TAG"
  PIPER_ASSET="piper_${PIPER_OS}_${PIPER_ARCH}.tar.gz"
  PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/${PIPER_ASSET}"
  PIPER_TMP=$(mktemp -d)

  info "Downloading $PIPER_ASSET..."
  if curl -fL --progress-bar "$PIPER_URL" -o "${PIPER_TMP}/${PIPER_ASSET}"; then
    info "Extracting..."
    tar -xzf "${PIPER_TMP}/${PIPER_ASSET}" -C "$PIPER_TMP"

    EXTRACTED_BIN=$(find "$PIPER_TMP" -type f -name "piper" ! -name "*.py" | head -1)

    if [[ -z "$EXTRACTED_BIN" ]]; then
      soft_error "Could not find piper binary in the archive."
    else
      sudo install -m 755 "$EXTRACTED_BIN" "$PIPER_BIN"

      PIPER_LIB_DIR="/usr/local/lib/piper"
      sudo mkdir -p "$PIPER_LIB_DIR"
      find "$PIPER_TMP" -name "*.so*" -exec sudo cp {} "$PIPER_LIB_DIR/" \; 2>/dev/null || true
      if [[ -d "${PIPER_TMP}/piper" ]]; then
        find "${PIPER_TMP}/piper" -name "*.so*" \
          -exec sudo cp {} "$PIPER_LIB_DIR/" \; 2>/dev/null || true
      fi
      if [[ -n "$(ls -A $PIPER_LIB_DIR 2>/dev/null)" ]]; then
        echo "$PIPER_LIB_DIR" | sudo tee /etc/ld.so.conf.d/piper.conf &>/dev/null
        sudo ldconfig 2>/dev/null || true
      fi

      ok "Piper installed at $PIPER_BIN"
    fi
  else
    soft_error "Failed to download Piper from: $PIPER_URL"
  fi

  rm -rf "$PIPER_TMP"
fi

# ---------------------------------------------------------------------------
# STEP 3: Piper voice models
# ---------------------------------------------------------------------------

step "Step 3/9 -- Piper voice models"

VOICE_DIR="${HOME}/.local/share/piper"
mkdir -p "$VOICE_DIR"

HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

download_voice() {
  local name="$1"
  local path="$2"
  local onnx="${VOICE_DIR}/${name}.onnx"
  local json="${VOICE_DIR}/${name}.onnx.json"

  if [[ -f "$onnx" && -f "$json" ]]; then
    ok "Already downloaded: $name"
    return
  fi

  info "Downloading $name..."
  curl -fL --progress-bar "${HF_BASE}/${path}/${name}.onnx" -o "$onnx" \
    && curl -fL --progress-bar "${HF_BASE}/${path}/${name}.onnx.json" -o "$json" \
    && ok "Downloaded: $name" \
    || soft_error "Failed to download voice: $name"
}

# Primary voice (used by default)
download_voice "en_US-lessac-medium"   "en/en_US/lessac/medium"
# Alternative voices
download_voice "en_US-amy-medium"      "en/en_US/amy/medium"
download_voice "en_US-ryan-medium"     "en/en_US/ryan/medium"
download_voice "en_GB-alan-medium"     "en/en_GB/alan/medium"

PRIMARY_ONNX="${VOICE_DIR}/en_US-lessac-medium.onnx"

# ---------------------------------------------------------------------------
# STEP 4: .env setup
# ---------------------------------------------------------------------------

step "Step 4/9 -- .env configuration"

if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp .env.example .env
    info "Created .env from .env.example"
  else
    touch .env
    info "Created empty .env"
  fi
else
  info ".env already exists -- adding missing values only"
fi

env_set "PIPER_EXECUTABLE_PATH" "$PIPER_BIN"
env_set "PIPER_MODEL_PATH"      "$PRIMARY_ONNX"

ok ".env updated"

# ---------------------------------------------------------------------------
# STEP 5: Kill switch password
# ---------------------------------------------------------------------------

step "Step 5/9 -- Kill switch password"

CURRENT_HASH=$(grep "^KILL_SWITCH_PASSWORD_HASH=" .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -n "$CURRENT_HASH" ]]; then
  ok "Kill switch hash already set -- skipping"
else
  echo ""
  echo -e "  ${BOLD}Set a kill switch password.${RESET}"
  echo -e "  ${DIM}This lets you reset the kill switch if it trips. Never saved -- only the hash is stored.${RESET}"
  echo ""

  while true; do
    read -rsp "  Password: " KS_PASS
    echo ""
    if [[ -z "$KS_PASS" ]]; then
      warn "Skipping kill switch setup. Set KILL_SWITCH_PASSWORD_HASH in .env manually."
      break
    fi
    read -rsp "  Confirm:  " KS_CONFIRM
    echo ""
    if [[ "$KS_PASS" == "$KS_CONFIRM" ]]; then
      KS_HASH=$(python3 - <<PYEOF
import bcrypt, sys
password = """${KS_PASS}""".encode()
print(bcrypt.hashpw(password, bcrypt.gensalt()).decode())
PYEOF
)
      env_set "KILL_SWITCH_PASSWORD_HASH" "$KS_HASH"
      ok "Kill switch hash written to .env"
      break
    else
      warn "Passwords do not match. Try again."
    fi
  done
fi

# ---------------------------------------------------------------------------
# STEP 6: Ollama models
# ---------------------------------------------------------------------------

step "Step 6/9 -- Ollama models"

OLLAMA_MODELS=(
  # GPU models (fit on GTX 1050 Ti 4GB)
  "deepseek-r1:1.5b"
  "llama3.2:1b"
  "llama3.2:3b"
  "phi3.5"
  "phi4-mini"
  "gemma3:1b"
  "gemma3:4b"
  "qwen2.5:3b"
  # RAM inference (32GB)
  "deepseek-r1:7b"
  "deepseek-r1:8b"
  "deepseek-r1:14b"
  "llama3.1:8b"
  "phi4"
  "gemma3:12b"
  "gemma3:27b"
  "qwen2.5:7b"
  "qwen2.5:14b"
  "mistral:7b"
  "mistral-nemo"
  # Code models
  "codellama:7b"
  "codellama:13b"
  "qwen2.5-coder:7b"
  "qwen2.5-coder:14b"
  # Heavy models (slow but fit in 32GB -- uncomment to enable)
  # "llama3.3:70b"
  # "deepseek-r1:32b"
  # "qwq"
  # "mixtral:8x7b"
)

if command -v ollama &>/dev/null; then
  info "Pulling all configured models (already downloaded will be skipped)."
  for model in "${OLLAMA_MODELS[@]}"; do
    if ollama list 2>/dev/null | grep -q "^${model}"; then
      ok "Already pulled: $model"
    else
      info "Pulling $model..."
      ollama pull "$model" || soft_error "Failed to pull $model"
    fi
  done
  ok "Ollama models done"
else
  warn "Ollama not installed -- skipping. Install from https://ollama.com"
fi

# ---------------------------------------------------------------------------
# STEP 7: Frontend build
# ---------------------------------------------------------------------------

step "Step 7/9 -- Frontend (npm install + build)"

if [[ ! -d "frontend" ]]; then
  soft_error "frontend/ directory not found."
else
  info "Installing frontend dependencies..."
  (cd frontend && npm install --legacy-peer-deps --silent 2>&1 | tail -5 | sed 's/^/  /') \
    || soft_error "npm install failed."

  info "Building production frontend..."
  (cd frontend && npm run build 2>&1 | tail -10 | sed 's/^/  /') \
    || soft_error "npm run build failed."

  if [[ -d "frontend/dist" ]]; then
    ok "Frontend built (frontend/dist/)"
  else
    soft_error "frontend/dist/ not found after build."
  fi
fi

# ---------------------------------------------------------------------------
# STEP 8: Systemd service
# ---------------------------------------------------------------------------

step "Step 8/9 -- Systemd service"

SERVICE_FILE="/etc/systemd/system/river-song.service"
PROJECT_DIR="$(pwd)"
VENV_PYTHON="${PROJECT_DIR}/venv/bin/python"
CURRENT_USER="$(whoami)"

if [[ -f "$SERVICE_FILE" ]]; then
  ok "Service file already exists -- skipping"
else
  info "Creating $SERVICE_FILE..."
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=River Song AI
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${VENV_PYTHON} main.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=river-song

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable river-song
  ok "river-song.service installed and enabled (auto-starts on boot)"
fi

# ---------------------------------------------------------------------------
# STEP 9: Auto-deploy cron job
# ---------------------------------------------------------------------------

step "Step 9/9 -- Auto-deploy cron job"

CRON_CMD="cd ${PROJECT_DIR} && git pull origin main --quiet && source venv/bin/activate && pip install -r requirements.txt --no-build-isolation --quiet && cd frontend && npm install --silent && npm run build --silent && cd .. && sudo systemctl restart river-song"
CRON_JOB="0 3 * * * ${CRON_CMD} >> ${PROJECT_DIR}/logs/deploy.log 2>&1"

if crontab -l 2>/dev/null | grep -q "river-song\|deploy.log"; then
  ok "Auto-deploy cron job already set"
else
  mkdir -p "${PROJECT_DIR}/logs"
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
  ok "Auto-deploy cron job set (runs nightly at 3am)"
fi

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

step "Verification"

VERIFY_PASS=true

for pkg in fastapi uvicorn whisper soundfile ollama bcrypt httpx; do
  if python3 -c "import ${pkg}" 2>/dev/null; then
    ok "import $pkg"
  else
    soft_error "import $pkg FAILED"
    VERIFY_PASS=false
  fi
done

for mod in "config.settings:get_settings" "core.conversation_loop:ConversationLoop"; do
  module="${mod%%:*}"
  symbol="${mod##*:}"
  if python3 -c "from ${module} import ${symbol}" 2>/dev/null; then
    ok "from $module import $symbol"
  else
    soft_error "from $module import $symbol FAILED"
    VERIFY_PASS=false
  fi
done

[[ -x "$PIPER_BIN" ]]              && ok "Piper binary: $PIPER_BIN"       || { soft_error "Piper binary missing"; VERIFY_PASS=false; }
[[ -f "$PRIMARY_ONNX" ]]           && ok "Piper voice: en_US-lessac-medium" || { soft_error "Primary voice model missing"; VERIFY_PASS=false; }
[[ -d "frontend/dist" ]]           && ok "Frontend dist built"             || { soft_error "frontend/dist missing"; VERIFY_PASS=false; }
systemctl is-enabled river-song &>/dev/null && ok "river-song service enabled" || { soft_error "river-song service not enabled"; VERIFY_PASS=false; }

for key in PIPER_EXECUTABLE_PATH PIPER_MODEL_PATH KILL_SWITCH_PASSWORD_HASH JWT_SECRET_KEY; do
  val=$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2-)
  [[ -n "$val" ]] && ok ".env: $key is set" || { soft_error ".env: $key is empty"; VERIFY_PASS=false; }
done

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

if [[ ${#ERRORS[@]} -eq 0 ]] && $VERIFY_PASS; then
  echo -e "${GREEN}${BOLD}  River Song is ready.${RESET}"
  echo ""
  echo -e "  Start now:       ${BOLD}sudo systemctl start river-song${RESET}"
  echo -e "  Check status:    ${BOLD}sudo systemctl status river-song${RESET}"
  echo -e "  Live logs:       ${BOLD}journalctl -u river-song -f${RESET}"
  echo ""
  echo -e "  Available voices in ${BOLD}~/.local/share/piper/${RESET}:"
  echo -e "    en_US-lessac-medium (default), en_US-amy-medium,"
  echo -e "    en_US-ryan-medium, en_GB-alan-medium"
  echo -e "  To switch voice: update PIPER_MODEL_PATH in .env and restart."
  echo ""
  echo -e "  Auto-deploy runs nightly at 3am. Logs: ${BOLD}logs/deploy.log${RESET}"
else
  echo -e "${YELLOW}${BOLD}  Setup completed with warnings.${RESET}"
  echo ""
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo -e "  ${RED}Issues:${RESET}"
    for e in "${ERRORS[@]}"; do
      echo -e "  ${RED}  • $e${RESET}"
    done
    echo ""
    echo -e "  Fix the issues above and re-run ${BOLD}./setup.sh${RESET} to retry."
  fi
fi

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
