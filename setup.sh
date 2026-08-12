#!/usr/bin/env bash
# =============================================================================
# setup.sh -- River Song AI environment setup
#
# Run this once from the project root after cloning the repo.
# Safe to re-run -- every step checks whether work is already done.
#
# What this does:
#    1. Python packages  -- pip install -r requirements.txt
#    2. Piper binary     -- downloads latest release for your arch
#    3. Piper voices     -- en_US-lessac-medium + en_US-amy-medium
#    4. .env setup       -- creates from .env.example, writes Piper paths
#    5. Secrets          -- generates JWT and daemon secrets if unset
#    6. Network          -- ALLOWED_HOSTS / CORS_ORIGINS for LAN or a domain
#    7. Kill switch      -- prompts for a password, writes bcrypt hash to .env
#    8. Ollama models    -- pulls a starter set of local models
#    9. Frontend         -- npm install + npm run build
#   10. Systemd service  -- installs and enables river-song.service
#   11. Auto-deploy      -- optional nightly git pull + restart
#       Verification     -- confirms every critical import and path resolves
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Options (environment variables):
#   RIVER_DOMAIN=example.com   Skip the network prompt and use this domain.
#                              Set to "lan" for a LAN-only install.
#   RIVER_PULL_ALL_MODELS=1    Pull the full local model catalogue (~150 GB)
#                              instead of the starter set.
#   RIVER_AUTO_DEPLOY=1        Install the nightly git-pull-and-restart cron.
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

# As env_set, but also overwrites values copied verbatim out of .env.example.
# Those placeholders are not blank, so env_set treats them as configured and
# leaves them alone -- which is how a fresh clone ends up advertising
# yourdomain.com and refusing to boot.
env_set_placeholder() {
  local key="$1"
  local value="$2"
  local file=".env"
  local current

  current=$(grep "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-)

  case "$current" in
    ""|*yourdomain.com*|*your_*|change_me_in_production)
      if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
        info "Set ${key}"
      else
        echo "${key}=${value}" >> "$file"
        info "Added ${key}"
      fi
      ;;
    *)
      info "${key} already configured -- skipping"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# STEP 1: Python packages
# ---------------------------------------------------------------------------

step "Step 1/11 -- Python packages"

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

step "Step 2/11 -- Piper TTS binary"

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

step "Step 3/11 -- Piper voice models"

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

step "Step 4/11 -- .env configuration"

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
# STEP 5: Secrets
#
# config/settings.py refuses to construct without a JWT_SECRET_KEY of at least
# 32 characters and a DAEMON_INTERNAL_SECRET of at least 24. .env.example ships
# both blank, and nothing here used to fill them in -- so a fresh clone got all
# the way through setup and then would not start. They are generated per
# install on purpose: a shared JWT secret would let a token minted on one
# household's server authenticate against another's.
# ---------------------------------------------------------------------------

step "Step 5/11 -- Secrets"

gen_secret() {
  python3 -c "import secrets; print(secrets.token_urlsafe(${1:-32}))"
}

for secret_key in JWT_SECRET_KEY DAEMON_INTERNAL_SECRET; do
  current=$(grep "^${secret_key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  # JWT_SECRET_KEY requires 32 chars minimum, DAEMON_INTERNAL_SECRET requires 24
  min_len=24
  [[ "$secret_key" == "JWT_SECRET_KEY" ]] && min_len=32

  if [[ -n "$current" && "$current" != "change_me_in_production" && ${#current} -ge $min_len ]]; then
    ok "${secret_key} already set -- leaving it alone"
  else
    new_val="$(gen_secret 48)"
    env_set_placeholder "$secret_key" "$new_val"
    ok "Generated ${secret_key}"
  fi
done

# ---------------------------------------------------------------------------
# STEP 6: Network identity
#
# ALLOWED_HOSTS backs TrustedHostMiddleware and is rejected outright if it
# contains "*" in production, so the shipped yourdomain.com placeholder is not
# merely cosmetic -- every request 400s until it matches how the box is
# actually reached. Most installs are a machine on a home network with no
# domain at all, so that is the default.
# ---------------------------------------------------------------------------

step "Step 6/11 -- Network identity"

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[[ -z "$LAN_IP" ]] && LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
SHORT_HOST=$(hostname -s 2>/dev/null || hostname)
APP_PORT_VAL=$(grep "^APP_PORT=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
[[ -z "$APP_PORT_VAL" ]] && APP_PORT_VAL=8000

DOMAIN="${RIVER_DOMAIN:-}"

if [[ -z "$DOMAIN" ]]; then
  if [[ -t 0 ]]; then
    echo ""
    echo -e "  ${BOLD}How will you reach River Song?${RESET}"
    echo -e "  ${DIM}If you have a domain pointed at this machine, type it (no https://).${RESET}"
    echo -e "  ${DIM}Press Enter for a home-network install -- reachable from other${RESET}"
    echo -e "  ${DIM}devices on your wifi, not from the internet.${RESET}"
    echo ""
    read -rp "  Domain (blank for LAN only): " DOMAIN
  else
    info "Not a terminal -- defaulting to a LAN-only install."
  fi
fi

if [[ -n "$DOMAIN" && "$DOMAIN" != "lan" ]]; then
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"
  HOSTS="[\"${DOMAIN}\",\"www.${DOMAIN}\",\"localhost\",\"127.0.0.1\""
  [[ -n "$LAN_IP" ]] && HOSTS="${HOSTS},\"${LAN_IP}\""
  HOSTS="${HOSTS}]"
  env_set_placeholder "ALLOWED_HOSTS" "$HOSTS"
  # Use HTTP by default unless TLS is actually configured and reachable
  # Setting https:// here when no TLS terminator exists would break CORS
  env_set_placeholder "CORS_ORIGINS"  "[\"http://${DOMAIN}\",\"http://www.${DOMAIN}\"]"
  ok "Configured for ${DOMAIN} (HTTP)"
  info "To use HTTPS, set up a TLS terminator and update CORS_ORIGINS manually"
else
  HOSTS="[\"localhost\",\"127.0.0.1\",\"${SHORT_HOST}\",\"${SHORT_HOST}.local\""
  ORIGINS="[\"http://localhost:${APP_PORT_VAL}\",\"http://${SHORT_HOST}.local:${APP_PORT_VAL}\""
  if [[ -n "$LAN_IP" ]]; then
    HOSTS="${HOSTS},\"${LAN_IP}\""
    ORIGINS="${ORIGINS},\"http://${LAN_IP}:${APP_PORT_VAL}\""
  fi
  env_set_placeholder "ALLOWED_HOSTS" "${HOSTS}]"
  env_set_placeholder "CORS_ORIGINS"  "${ORIGINS}]"
  ok "Configured for this network${LAN_IP:+ -- http://${LAN_IP}:${APP_PORT_VAL}}"
  info "No domain, so this is not reachable from outside your house. That is the safe default."
fi

# ---------------------------------------------------------------------------
# STEP 7: Kill switch password
# ---------------------------------------------------------------------------

step "Step 7/11 -- Kill switch password"

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

step "Step 8/11 -- Ollama models"

# The starter set: enough to hold a conversation and run the intent router on
# a modest machine, roughly 8 GB of downloads. The full catalogue below is
# sized for 32 GB of RAM and runs to about 150 GB, which is not a reasonable
# thing to do to someone's disk without asking -- hence RIVER_PULL_ALL_MODELS.
OLLAMA_STARTER_MODELS=(
  "llama3.2:3b"
  "qwen2.5:3b"
  "phi4-mini"
  "gemma3:1b"
)

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

if [[ "${RIVER_PULL_ALL_MODELS:-0}" == "1" ]]; then
  PULL_LIST=("${OLLAMA_MODELS[@]}")
  PULL_DESC="the full catalogue (~150 GB)"
else
  PULL_LIST=("${OLLAMA_STARTER_MODELS[@]}")
  PULL_DESC="the starter set (~8 GB)"
fi

if command -v ollama &>/dev/null; then
  info "Pulling ${PULL_DESC}. Already-downloaded models are skipped."
  [[ "${RIVER_PULL_ALL_MODELS:-0}" == "1" ]] || \
    info "Re-run with RIVER_PULL_ALL_MODELS=1 for every model, or pull individually later."
  for model in "${PULL_LIST[@]}"; do
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

step "Step 9/11 -- Frontend (npm install + build)"

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

step "Step 10/11 -- Systemd service"

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
# STEP 11: Auto-deploy cron job
#
# Opt-in. This pulls whatever is on main at 3am, reinstalls dependencies and
# restarts the service, unattended. That is a reasonable thing to do to a box
# you develop on and an unreasonable thing to do to somebody else's -- a bad
# commit takes their household down overnight with no one watching.
# ---------------------------------------------------------------------------

step "Step 11/11 -- Auto-deploy systemd timer"

# Check if systemd service/timer already exists
if systemctl --user list-unit-files | grep -q "river-song-deploy"; then
  ok "Auto-deploy systemd service already configured"
elif [[ "${RIVER_AUTO_DEPLOY:-0}" == "1" ]]; then
  mkdir -p "${PROJECT_DIR}/logs"
  mkdir -p ~/.config/systemd/user

  # Create systemd service file
  cat > ~/.config/systemd/user/river-song-deploy.service <<EOF
[Unit]
Description=River Song Auto-Deploy
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
ExecStart=/bin/bash -c 'git pull origin main --quiet && ${PROJECT_DIR}/venv/bin/pip install -r requirements.txt --no-build-isolation --quiet && cd frontend && npm install --silent && npm run build --silent && cd .. && systemctl --user restart river-song'
StandardOutput=append:${PROJECT_DIR}/logs/deploy.log
StandardError=append:${PROJECT_DIR}/logs/deploy.log

[Install]
WantedBy=default.target
EOF

  # Create systemd timer file
  cat > ~/.config/systemd/user/river-song-deploy.timer <<EOF
[Unit]
Description=River Song Auto-Deploy Timer
Requires=river-song-deploy.service

[Timer]
OnCalendar=daily
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable river-song-deploy.timer
  systemctl --user start river-song-deploy.timer
  ok "Auto-deploy systemd timer set (runs nightly at 3am)"
  info "View status: systemctl --user status river-song-deploy.timer"
else
  info "Skipped. Re-run with RIVER_AUTO_DEPLOY=1 to update automatically at 3am;"
  info "otherwise update by hand with: git pull && ./setup.sh && sudo systemctl restart river-song"
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

for key in PIPER_EXECUTABLE_PATH PIPER_MODEL_PATH KILL_SWITCH_PASSWORD_HASH \
           JWT_SECRET_KEY DAEMON_INTERNAL_SECRET ALLOWED_HOSTS CORS_ORIGINS; do
  val=$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2-)
  [[ -n "$val" ]] && ok ".env: $key is set" || { soft_error ".env: $key is empty"; VERIFY_PASS=false; }
done

# The one check that actually predicts whether the app boots: settings has
# validators that reject weak secrets and a wildcard ALLOWED_HOSTS, and they
# raise at construction, not at first request.
if SETTINGS_ERR=$(python3 -c "from config.settings import get_settings; get_settings()" 2>&1); then
  ok "Configuration validates"
else
  soft_error "Configuration rejected: $(echo "$SETTINGS_ERR" | tail -3 | tr '\n' ' ')"
  VERIFY_PASS=false
fi

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
  if [[ -n "$DOMAIN" && "$DOMAIN" != "lan" ]]; then
    RIVER_URL="https://${DOMAIN}"
  elif [[ -n "$LAN_IP" ]]; then
    RIVER_URL="http://${LAN_IP}:${APP_PORT_VAL}"
  else
    RIVER_URL="http://localhost:${APP_PORT_VAL}"
  fi
  echo -e "  ${BOLD}Then open ${RIVER_URL} and create your account.${RESET}"
  echo -e "  ${DIM}The first account created becomes the administrator. Do it before${RESET}"
  echo -e "  ${DIM}anyone else can reach the machine.${RESET}"
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
