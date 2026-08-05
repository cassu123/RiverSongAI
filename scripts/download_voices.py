#!/usr/bin/env python3
"""
scripts/download_voices.py

Download Piper TTS voice models from the River Song AI voice registry.

Called automatically by deploy.sh to ensure the default voice (River) is
always present after a fresh clone or new voice additions.

Usage
-----
  python scripts/download_voices.py                # download missing default voice
  python scripts/download_voices.py --all          # download all registry voices
  python scripts/download_voices.py river atlas    # download specific voices by ID
  python scripts/download_voices.py --list         # print the catalog and exit

The script skips files that are already on disk (idempotent).
Downloads go to the directory configured in PIPER_MODEL_PATH (.env).
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request
import urllib.error

# Ensure the project root is on the path so we can import our modules
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

# Load .env before importing settings
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_ROOT, ".env"))
except ImportError:
    pass  # dotenv not required; values may be set via environment


def _get_model_dir() -> str:
    """Return the directory where .onnx files live."""
    try:
        from config.settings import get_settings
        path = get_settings().piper_model_path
    except Exception:
        path = os.environ.get("PIPER_MODEL_PATH", "")

    if not path:
        print("ERROR: PIPER_MODEL_PATH is not set in .env", file=sys.stderr)
        sys.exit(1)

    model_dir = os.path.dirname(path)
    os.makedirs(model_dir, exist_ok=True)
    return model_dir


def _download_file(url: str, dest: str) -> None:
    """Download url → dest with a simple progress indicator."""
    tmp = dest + ".tmp"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "RiverSongAI/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            block = 1024 * 256   # 256 KB chunks
            while True:
                chunk = resp.read(block)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    mb  = downloaded / 1024 / 1024
                    print(f"  {pct:3d}%  {mb:.1f} MB", end="\r", flush=True)
        print()  # newline after progress
        os.replace(tmp, dest)
    except Exception as exc:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"Download failed: {exc}") from exc


def download_voice(voice_id: str, model_dir: str, force: bool = False) -> bool:
    """
    Download the .onnx + .onnx.json for voice_id into model_dir.
    Returns True if downloaded, False if already present.
    """
    from providers.tts.voice_registry import VoiceRegistry

    entry = VoiceRegistry.get(voice_id)
    if not entry:
        print(f"  ✗ Unknown voice ID: {voice_id}")
        return False

    onnx_dest = os.path.join(model_dir, entry.filename)
    json_dest  = onnx_dest + ".json"

    onnx_url = VoiceRegistry.hf_url(voice_id)
    json_url  = VoiceRegistry.hf_json_url(voice_id)

    already_have = os.path.exists(onnx_dest) and os.path.exists(json_dest)
    if already_have and not force:
        size_mb = os.path.getsize(onnx_dest) / 1024 / 1024
        print(f"  ✓ {entry.display_name:14} ({entry.voice_id}) — already installed ({size_mb:.0f} MB)")
        return False

    print(f"  ↓ {entry.display_name:14} ({entry.voice_id}) — {entry.size_mb:.0f} MB — {entry.description}")
    try:
        _download_file(onnx_url, onnx_dest)
        _download_file(json_url, json_dest)
        print(f"  ✓ {entry.display_name} downloaded to {onnx_dest}")
    except RuntimeError as exc:
        print(f"  ✗ {entry.display_name}: {exc}")
        return False
    return True


def print_catalog() -> None:
    from providers.tts.voice_registry import VoiceRegistry
    voices = VoiceRegistry.list_all()

    print(f"\n{'ID':<18} {'NAME':<14} {'ACCENT':<20} {'GENDER':<8} {'QUAL':<8} {'MB':>6}  DESCRIPTION")
    print("-" * 100)
    current_accent = None
    for v in voices:
        if v.accent != current_accent:
            current_accent = v.accent
            print()
        star = " ★" if v.default else ""
        print(f"  {v.voice_id:<16} {v.display_name:<14} {v.accent:<20} {v.gender:<8} {v.quality:<8} {v.size_mb:>5.0f}MB  {v.description}{star}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Piper voice models for River Song AI.")
    parser.add_argument("voices", nargs="*",   help="Voice IDs to download (default: download default voice)")
    parser.add_argument("--all",  action="store_true", help="Download every voice in the registry")
    parser.add_argument("--list", action="store_true", help="Print the voice catalog and exit")
    parser.add_argument("--force",action="store_true", help="Re-download even if file already exists")
    args = parser.parse_args()

    from providers.tts.voice_registry import VoiceRegistry

    if args.list:
        print_catalog()
        return

    model_dir = _get_model_dir()
    print(f"\nVoice model directory: {model_dir}\n")

    if args.all:
        targets = [v.voice_id for v in VoiceRegistry.list_all()]
        print(f"Downloading all {len(targets)} voices in the registry…\n")
    elif args.voices:
        targets = args.voices
    else:
        # Default: ensure the default voice (River) is present
        default = VoiceRegistry.get_default()
        targets = [default.voice_id] if default else []
        if targets:
            print(f"Ensuring default voice is installed…\n")

    downloaded = 0
    for vid in targets:
        if download_voice(vid, model_dir, force=args.force):
            downloaded += 1

    print(f"\nDone. {downloaded} voice(s) downloaded.\n")


if __name__ == "__main__":
    main()
