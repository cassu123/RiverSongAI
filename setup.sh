#!/usr/bin/env bash
# =============================================================================
# setup.sh -- River Song AI environment setup
#
# Run this once from the project root after cloning the repo.
# Safe to re-run -- every step checks whether work is already done.
#
# What this does:
#   1. System packages  -- libportaudio (required by sounddevice)
#   2. Python packages  -- pip install -r requirements.txt
#   3. Piper binary     -- downloads latest release for your arch
#   4. Piper voice      -- en_US-lessac-medium (good quality, fast)
#   5. .env setup       -- creates from .env.example, writes Piper paths
#   6. Kill switch      -- prompts for a password, writes bcrypt hash to .env
#   7. Frontend         -- npm install inside frontend/
#   8. Verification     -- confirms every critical import and path resolves
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
command -v pip3   &>/dev/null || die "pip3 not found."
command -v node   &>/dev/null || die "node not found. Install Node.js 18+."
command -v npm    &>/dev/null || die "npm not found."
command -v curl   &>/dev/null || die "curl not found."

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
  x86_64)  PIPER_ARCH="x86_64" ;;
  aarch64|arm64) PIPER_ARCH="aarch64" ;;
  *)        die "Unsupported architecture: $ARCH." ;;
esac

# macOS uses x64 in Piper's naming convention
[[ "$PIPER_OS" == "macos" && "$PIPER_ARCH" == "x86_64" ]] && PIPER_ARCH="x64"
[[ "$PIPER_OS" == "macos" && "$PIPER_ARCH" == "aarch64" ]] && PIPER_ARCH="aarch64"

info "Detected: $OS / $ARCH"

# ---------------------------------------------------------------------------
# Helper: safely update a variable in .env
# Sets the value only if the current value is empty or the key doesn't exist.
# Never overwrites a value the user has already set.
# ---------------------------------------------------------------------------

env_set() {
  local key="$1"
  local value="$2"
  local file=".env"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    current=$(grep "^${key}=" "$file" | head -1 | cut -d= -f2-)
    if [[ -z "$current" ]]; then
      # Key present but empty -- fill it in
      sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
      info "Set ${key}"
    else
      info "${key} already set -- skipping"
    fi
  else
    # Key missing entirely -- append it
    echo "${key}=${value}" >> "$file"
    info "Added ${key}"
  fi
}

# ---------------------------------------------------------------------------
# STEP 1: System packages
# ---------------------------------------------------------------------------

step "Step 1/7 -- System packages (PortAudio)"

ok "Skipping -- audio now runs in the browser, PortAudio no longer needed."

# ---------------------------------------------------------------------------
# STEP 2: Python packages
# ---------------------------------------------------------------------------

step "Step 2/7 -- Python packages (pip install -r requirements.txt)"

if [[ ! -d "venv" ]]; then
  info "Creating Python virtual environment (venv)..."
  python3 -m venv venv || die "Failed to create venv. You may need to install it first: sudo apt-get install python3-venv"
fi

info "Activating virtual environment..."
# shellcheck source=/dev/null
source venv/bin/activate

info "This installs Whisper, FastAPI, Ollama client, and all providers."
info "Whisper pulls PyTorch -- this can take several minutes on first run."

# Ensure setuptools<71 is present -- openai-whisper's setup.py requires
# pkg_resources which was removed in setuptools>=71. Must be pinned before
# any other install so pip's build isolation inherits a compatible version.
python3 -c "import pkg_resources" 2>/dev/null || {
  info "Pinning setuptools<71 to restore pkg_resources..."
  pip3 install "setuptools<71" --quiet 2>&1 | grep -v "already satisfied" | sed 's/^/  /' || true
}

info "Installing wheel to support package building..."
pip3 install wheel --quiet 2>&1 | grep -v "already satisfied" | sed 's/^/  /' || true

# --no-build-isolation lets the build environment use the pinned setuptools
# instead of pulling the latest (which lacks pkg_resources).
pip3 install -r requirements.txt --no-build-isolation --quiet 2>&1 | \
  grep -v "^$\|Requirement already\|already satisfied\|yanked" | \
  head -30 | sed 's/^/  /' || true

# Spot-check the critical imports
IMPORT_ERRORS=()
for pkg in fastapi uvicorn whisper soundfile ollama bcrypt httpx pydantic; do
  python3 -c "import ${pkg}" 2>/dev/null || IMPORT_ERRORS+=("$pkg")
done

if [[ ${#IMPORT_ERRORS[@]} -eq 0 ]]; then
  ok "All Python packages importable"
else
  for e in "${IMPORT_ERRORS[@]}"; do
    soft_error "Could not import: $e"
  done
fi

# ---------------------------------------------------------------------------
# STEP 3: Piper binary
# ---------------------------------------------------------------------------

step "Step 3/7 -- Piper TTS binary"

PIPER_BIN="/usr/local/bin/piper"

if [[ -x "$PIPER_BIN" ]]; then
  ok "Piper already installed at $PIPER_BIN"
else
  info "Fetching latest Piper release info from GitHub..."

  PIPER_TAG=$(curl -s "https://api.github.com/repos/rhasspy/piper/releases/latest" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)

  if [[ -z "$PIPER_TAG" ]]; then
    soft_error "Could not fetch Piper release info. Check your internet connection."
    PIPER_TAG="2023.11.14-2"
    warn "Falling back to known version $PIPER_TAG"
  fi

  info "Piper version: $PIPER_TAG"

  # Build the asset name. Piper uses different naming for macOS vs Linux.
  if [[ "$PIPER_OS" == "macos" ]]; then
    PIPER_ASSET="piper_${PIPER_OS}_${PIPER_ARCH}.tar.gz"
  else
    PIPER_ASSET="piper_${PIPER_OS}_${PIPER_ARCH}.tar.gz"
  fi

  PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/${PIPER_ASSET}"
  PIPER_TMP=$(mktemp -d)

  info "Downloading $PIPER_ASSET..."
  if curl -fL --progress-bar "$PIPER_URL" -o "${PIPER_TMP}/${PIPER_ASSET}"; then
    info "Extracting..."
    tar -xzf "${PIPER_TMP}/${PIPER_ASSET}" -C "$PIPER_TMP"

    # The binary may be at piper/piper or just piper depending on release
    EXTRACTED_BIN=$(find "$PIPER_TMP" -type f -name "piper" ! -name "*.py" | head -1)

    if [[ -z "$EXTRACTED_BIN" ]]; then
      soft_error "Could not find piper binary in the archive. Inspect $PIPER_TMP manually."
    else
      sudo install -m 755 "$EXTRACTED_BIN" "$PIPER_BIN"

      # Some Piper releases bundle shared libraries alongside the binary.
      # Copy any .so files to a location the dynamic linker can find.
      PIPER_LIB_DIR="/usr/local/lib/piper"
      sudo mkdir -p "$PIPER_LIB_DIR"
      find "$PIPER_TMP" -name "*.so*" -exec sudo cp {} "$PIPER_LIB_DIR/" \; 2>/dev/null || true

      if [[ -d "${PIPER_TMP}/piper" ]]; then
        # Full piper directory -- copy onnxruntime libs too
        find "${PIPER_TMP}/piper" -name "*.so*" \
          -exec sudo cp {} "$PIPER_LIB_DIR/" \; 2>/dev/null || true
      fi

      # Add library path if needed
      if [[ -n "$(ls -A $PIPER_LIB_DIR 2>/dev/null)" ]]; then
        echo "$PIPER_LIB_DIR" | sudo tee /etc/ld.so.conf.d/piper.conf &>/dev/null
        sudo ldconfig 2>/dev/null || true
      fi

      ok "Piper installed at $PIPER_BIN"
    fi
  else
    soft_error "Failed to download Piper from: $PIPER_URL"
    warn "Install Piper manually: https://github.com/rhasspy/piper/releases"
  fi

  rm -rf "$PIPER_TMP"
fi

# ---------------------------------------------------------------------------
# STEP 4: Piper voice model
# ---------------------------------------------------------------------------

step "Step 4/7 -- Piper voice model (en_US-lessac-medium)"

VOICE_DIR="${HOME}/.local/share/piper"
ONNX_FILE="${VOICE_DIR}/en_US-lessac-medium.onnx"
JSON_FILE="${VOICE_DIR}/en_US-lessac-medium.onnx.json"

HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"
VOICE_PATH="en/en_US/lessac/medium"
VOICE_NAME="en_US-lessac-medium"

if [[ -f "$ONNX_FILE" && -f "$JSON_FILE" ]]; then
  ok "Voice model already present at $VOICE_DIR"
else
  info "Creating voice model directory: $VOICE_DIR"
  mkdir -p "$VOICE_DIR"

  VOICE_OK=true

  if [[ ! -f "$ONNX_FILE" ]]; then
    info "Downloading ${VOICE_NAME}.onnx (~65 MB)..."
    if ! curl -fL --progress-bar \
        "${HF_BASE}/${VOICE_PATH}/${VOICE_NAME}.onnx" \
        -o "$ONNX_FILE"; then
      soft_error "Failed to download .onnx model"
      VOICE_OK=false
    fi
  fi

  if [[ ! -f "$JSON_FILE" ]]; then
    info "Downloading ${VOICE_NAME}.onnx.json..."
    if ! curl -fL --progress-bar \
        "${HF_BASE}/${VOICE_PATH}/${VOICE_NAME}.onnx.json" \
        -o "$JSON_FILE"; then
      soft_error "Failed to download .onnx.json config"
      VOICE_OK=false
    fi
  fi

  if $VOICE_OK; then
    ok "Voice model downloaded to $VOICE_DIR"
  else
    warn "Voice model download failed. Download manually:"
    warn "  ${HF_BASE}/${VOICE_PATH}/${VOICE_NAME}.onnx"
    warn "  ${HF_BASE}/${VOICE_PATH}/${VOICE_NAME}.onnx.json"
    warn "  Save both to: $VOICE_DIR"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 5: .env setup
# ---------------------------------------------------------------------------

step "Step 5/7 -- .env configuration"

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

# Write Piper paths (only if not already set)
env_set "PIPER_EXECUTABLE_PATH" "$PIPER_BIN"
env_set "PIPER_MODEL_PATH"      "$ONNX_FILE"

ok ".env updated"

# ---------------------------------------------------------------------------
# STEP 6: Kill switch password hash
# ---------------------------------------------------------------------------

step "Step 6/7 -- Kill switch password"

# Check if already set
CURRENT_HASH=$(grep "^KILL_SWITCH_PASSWORD_HASH=" .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -n "$CURRENT_HASH" ]]; then
  ok "Kill switch hash already set -- skipping"
else
  echo ""
  echo -e "  ${BOLD}Set a kill switch password.${RESET}"
  echo -e "  ${DIM}This password lets you reset the kill switch if it trips."
  echo -e "  The hash is stored in .env -- the password itself is never saved.${RESET}"
  echo ""

  while true; do
    read -rsp "  Password: " KS_PASS
    echo ""
    if [[ -z "$KS_PASS" ]]; then
      warn "Skipping kill switch setup. The server will log a warning on every start."
      warn "Run this script again or set KILL_SWITCH_PASSWORD_HASH in .env manually."
      break
    fi
    read -rsp "  Confirm:  " KS_CONFIRM
    echo ""
    if [[ "$KS_PASS" == "$KS_CONFIRM" ]]; then
      # Generate bcrypt hash without passing the password as a shell argument
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
# STEP 7: Frontend npm install
# ---------------------------------------------------------------------------

step "Step 7/8 -- Ollama models"

OLLAMA_MODELS=(
  "deepseek-r1:1.5b"
  "deepseek-r1:7b"
  "deepseek-r1:8b"
  "llama3.2:1b"
  "llama3.2:3b"
  "llama3.1:8b"
  "phi3.5"
  "phi4-mini"
  "gemma3:1b"
  "gemma3:4b"
  "qwen2.5:3b"
  "qwen2.5:7b"
  "mistral:7b"
  "mistral-nemo"
)

# Heavy models (optional -- require 16GB+ RAM):
# "phi4"         ~9GB
# "gemma3:12b"   ~8GB
# "gemma2:9b"    ~6GB
# "llama3.1:70b" ~43GB
# "qwq"          ~20GB

if command -v ollama &>/dev/null; then
  info "Ollama found. Pulling all configured models (~49 GB total)."
  info "This will take a long time. Models already downloaded will be skipped."
  echo ""
  for model in "${OLLAMA_MODELS[@]}"; do
    if ollama list 2>/dev/null | grep -q "^${model}"; then
      ok "Already pulled: $model"
    else
      info "Pulling $model ..."
      ollama pull "$model" || soft_error "Failed to pull $model"
    fi
  done
  ok "Ollama models done"
else
  warn "Ollama not installed -- skipping model downloads."
  warn "Install from https://ollama.com then re-run ./setup.sh to pull models."
fi

# ---------------------------------------------------------------------------
# STEP 8: Frontend npm install
# ---------------------------------------------------------------------------

step "Step 8/8 -- Frontend (npm install)"

if [[ ! -d "frontend" ]]; then
  soft_error "frontend/ directory not found. Is this the correct project root?"
else
  if [[ -d "frontend/node_modules" ]]; then
    ok "node_modules already present"
  else
    info "Running npm install in frontend/..."
    (cd frontend && npm install --silent 2>&1 | tail -5 | sed 's/^/  /') || \
      soft_error "npm install failed. Check frontend/package.json."
    ok "Frontend dependencies installed"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 8: Verification
# ---------------------------------------------------------------------------

step "Verification"

echo ""
VERIFY_PASS=true

# Python imports
VERIFY_IMPORTS=(fastapi uvicorn whisper soundfile ollama bcrypt httpx)
for pkg in "${VERIFY_IMPORTS[@]}"; do
  if python3 -c "import ${pkg}" 2>/dev/null; then
    ok "import $pkg"
  else
    soft_error "import $pkg FAILED"
    VERIFY_PASS=false
  fi
done

# Core River Song imports
for mod in "config.settings:get_settings" "core.intent_router:get_intent_router" "core.conversation_loop:ConversationLoop"; do
  module="${mod%%:*}"
  symbol="${mod##*:}"
  if python3 -c "from ${module} import ${symbol}" 2>/dev/null; then
    ok "from $module import $symbol"
  else
    soft_error "from $module import $symbol FAILED"
    VERIFY_PASS=false
  fi
done

# Piper binary
if [[ -x "$PIPER_BIN" ]]; then
  ok "Piper binary: $PIPER_BIN"
else
  soft_error "Piper binary not found or not executable: $PIPER_BIN"
  VERIFY_PASS=false
fi

# Piper voice model
if [[ -f "$ONNX_FILE" && -f "$JSON_FILE" ]]; then
  ok "Piper voice model: $ONNX_FILE"
else
  soft_error "Piper voice model missing: $ONNX_FILE"
  VERIFY_PASS=false
fi

# .env required values
for key in PIPER_EXECUTABLE_PATH PIPER_MODEL_PATH KILL_SWITCH_PASSWORD_HASH; do
  val=$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2-)
  if [[ -n "$val" ]]; then
    ok ".env: $key is set"
  else
    soft_error ".env: $key is empty"
    VERIFY_PASS=false
  fi
done

# Frontend
if [[ -d "frontend/node_modules" ]]; then
  ok "frontend/node_modules present"
else
  soft_error "frontend/node_modules missing"
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
  echo -e "  Start the backend:"
  echo -e "    ${BOLD}source venv/bin/activate${RESET}"
  echo -e "    ${BOLD}python main.py${RESET}"
  echo ""
  echo -e "  Start the frontend (in a separate terminal):"
  echo -e "    ${BOLD}cd frontend && npm run dev${RESET}"
  echo ""
  echo -e "  Then open ${BOLD}http://localhost:5173${RESET} in your browser."
  echo ""
  echo -e "  ${DIM}Make sure Ollama is running: ollama serve${RESET}"
  echo -e "  ${DIM}Make sure your model is pulled: ollama pull llama3.1:8b${RESET}"
else
  echo -e "${YELLOW}${BOLD}  Setup completed with warnings.${RESET}"
  echo ""
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo -e "  ${RED}Issues encountered:${RESET}"
    for e in "${ERRORS[@]}"; do
      echo -e "  ${RED}  • $e${RESET}"
    done
    echo ""
    echo -e "  Fix the issues above and re-run ${BOLD}./setup.sh${RESET} to retry."
  fi
fi

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
