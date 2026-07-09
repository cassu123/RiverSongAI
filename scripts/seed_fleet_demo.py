#!/usr/bin/env python3
"""
scripts/seed_fleet_demo.py

One-command fleet demo — no hardware required.

Spins up one in-server simulated unit for every fleet program (horizon,
kova, sentinel, vortex, vexa) by calling the admin `/units/simulate`
endpoint. Each simulated unit runs inside the River Song process and
streams live telemetry every ~2s, so the Fleet dashboard lights up with
moving data exactly as it would with real satellites attached. This is the
"foundations are in place" demo: prove the whole claim -> register ->
telemetry -> command path end-to-end before any physical unit exists.

Reuses:
  - the generic fleet factory endpoints (api/routes/fleet.py)
  - the in-process behaviour profiles (core/fleet_simulator.py)

Usage
-----
  # Against a running server (default http://127.0.0.1:8000).
  # Provide an admin JWT, or let the script mint one (must run in the app
  # venv so config.settings can read JWT_SECRET_KEY).
  python scripts/seed_fleet_demo.py                 # seed one sim unit per program
  python scripts/seed_fleet_demo.py --stop          # tear down every simulated unit
  RS_TOKEN=<admin-jwt> python scripts/seed_fleet_demo.py --server https://riversongai.com

Env:
  RS_BASE_URL   base server URL (default http://127.0.0.1:8000)
  RS_TOKEN      admin JWT; if unset, one is minted locally
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx

sys.path.insert(0, ".")

from api.routes.fleet import FLEET_PROGRAMS  # noqa: E402


def _admin_token() -> str:
    """Use RS_TOKEN if provided, else mint a short-lived admin token locally."""
    tok = os.environ.get("RS_TOKEN")
    if tok:
        return tok
    try:
        from core.auth import create_access_token
        return create_access_token(
            user_id="fleet-demo-admin",
            email="fleet-demo@riversong.local",
            role="admin",
        )
    except Exception as exc:  # pragma: no cover - defensive
        print(f"!! Could not mint an admin token ({exc}). "
              f"Set RS_TOKEN to an admin JWT and retry.", file=sys.stderr)
        raise SystemExit(2)


def seed(base: str, headers: dict) -> int:
    created = 0
    with httpx.Client(timeout=15.0) as client:
        for program in FLEET_PROGRAMS:
            r = client.post(f"{base}/api/{program}/units/simulate",
                            headers=headers, json={})
            if r.status_code == 200:
                data = r.json()
                print(f"  [{program}] simulating {data['unit_id']} ({data['name']})")
                created += 1
            else:
                print(f"  [{program}] FAILED {r.status_code}: {r.text[:120]}",
                      file=sys.stderr)
    print(f"\nSeeded {created}/{len(FLEET_PROGRAMS)} programs. "
          f"Open the Fleet page to watch live telemetry.")
    return 0 if created == len(FLEET_PROGRAMS) else 1


def stop(base: str, headers: dict) -> int:
    """Delete every simulated unit (units whose id starts with 'sim-')."""
    stopped = 0
    with httpx.Client(timeout=15.0) as client:
        for program in FLEET_PROGRAMS:
            r = client.get(f"{base}/api/{program}/units", headers=headers)
            if r.status_code != 200:
                print(f"  [{program}] list FAILED {r.status_code}", file=sys.stderr)
                continue
            for unit in r.json().get("units", []):
                uid = unit.get("unit_id", "")
                if uid.startswith("sim-"):
                    client.delete(f"{base}/api/{program}/units/{uid}/simulate",
                                  headers=headers)
                    print(f"  [{program}] stopped {uid}")
                    stopped += 1
    print(f"\nStopped {stopped} simulated unit(s).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed the fleet demo (no hardware).")
    ap.add_argument("--server",
                    default=os.environ.get("RS_BASE_URL", "http://127.0.0.1:8000"))
    ap.add_argument("--stop", action="store_true",
                    help="tear down all simulated units instead of seeding")
    args = ap.parse_args()

    base = args.server.rstrip("/")
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    return stop(base, headers) if args.stop else seed(base, headers)


if __name__ == "__main__":
    raise SystemExit(main())
