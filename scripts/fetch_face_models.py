#!/usr/bin/env python3
"""
scripts/fetch_face_models.py

Fetch the two ONNX models face match needs.

OpenCV ships the YuNet and SFace *runtimes* in the wheel but not their
weights, so they are downloaded once from the OpenCV Model Zoo into
`data/models/face/`. Together they are about six megabytes and everything
after this runs locally — no face ever leaves the machine.

    python scripts/fetch_face_models.py
    python scripts/fetch_face_models.py --force     # re-download

Until these exist, `/api/face-id/status` reports face match as unavailable
and every identify says so rather than returning "not recognised".
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request

ZOO = ("https://raw.githubusercontent.com/opencv/opencv_zoo/main/models")

MODELS = (
    {
        "name": "face_detection_yunet_2023mar.onnx",
        "url": f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "purpose": "detection (YuNet)",
    },
    {
        "name": "face_recognition_sface_2021dec.onnx",
        "url": f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "purpose": "recognition (SFace)",
    },
)

# No checksums are pinned here. The Zoo republishes models under the same
# filename, so a hardcoded digest would start failing on a future refresh and
# a wrong one is worse than none — this prints what it downloaded so you can
# record and compare it yourself if you want that guarantee.

TARGET_DIR = os.path.join("data", "models", "face")


def _digest(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def fetch(model: dict, *, force: bool) -> bool:
    destination = os.path.join(TARGET_DIR, model["name"])
    if os.path.exists(destination) and not force:
        print(f"  already present: {model['name']}")
        return True

    print(f"  downloading {model['name']} — {model['purpose']}")
    try:
        with urllib.request.urlopen(model["url"], timeout=120) as response:
            data = response.read()
    except Exception as exc:
        print(f"  FAILED: {exc}", file=sys.stderr)
        return False

    if not data:
        print("  FAILED: empty response", file=sys.stderr)
        return False

    temporary = destination + ".part"
    with open(temporary, "wb") as handle:
        handle.write(data)

    os.replace(temporary, destination)
    print(f"  saved {destination} ({len(data) / 1024:.0f} KB)")
    print(f"  sha256 {_digest(destination)}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="re-download even if the file exists")
    args = parser.parse_args()

    os.makedirs(TARGET_DIR, exist_ok=True)
    print(f"Fetching face models into {TARGET_DIR}/")

    ok = all(fetch(model, force=args.force) for model in MODELS)

    if ok:
        print("\nDone. Face match is available — enrol from your account page,\n"
              "next to voice match.")
        return 0
    print("\nOne or more models could not be fetched. Face match will report\n"
          "itself unavailable until they are present.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
