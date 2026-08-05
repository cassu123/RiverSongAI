#!/usr/bin/env python3
"""
scripts/fleet_sim.py

Headless device simulator that drives the REAL HTTP fleet endpoints for one
unit, so you can test a program end-to-end over the network exactly as real
hardware would. Reuses the same behaviour profiles as the in-process
simulator (core.fleet_simulator.PROFILES).

Usage:
  # 1. Claim a unit in the UI (or via API) and copy its unit_id + unit_token.
  python scripts/fleet_sim.py \
      --program horizon \
      --server http://localhost:8000 \
      --unit-id <unit_id> \
      --token <unit_token>

The device loop: register -> then every 2s post telemetry, poll for a command,
apply it, and ack it. Ctrl-C to stop.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone

import httpx

# Import the shared behaviour profiles so sim physics match the in-process sim.
sys.path.insert(0, ".")
from core.fleet_simulator import _profile_for  # noqa: E402

TICK_SECONDS = 2.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ap = argparse.ArgumentParser(description="River fleet device simulator (HTTP)")
    ap.add_argument("--program", required=True,
                    help="horizon | kova | sentinel | vortex | vexa")
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--unit-id", required=True)
    ap.add_argument("--token", required=True)
    args = ap.parse_args()

    base = args.server.rstrip("/") + f"/api/{args.program}"
    headers = {"X-Unit-Token": args.token}
    profile = _profile_for(args.program)
    state = profile["init"]()

    with httpx.Client(timeout=10.0) as client:
        r = client.post(f"{base}/register", headers=headers,
                        json={"unit_id": args.unit_id, "metadata": {"simulated": "script"}})
        r.raise_for_status()
        print(f"[{args.program}/{args.unit_id}] registered. Streaming telemetry "
              f"every {TICK_SECONDS}s — Ctrl-C to stop.")

        try:
            while True:
                # Poll for a pending command.
                cr = client.get(f"{base}/commands", headers=headers,
                                params={"unit_id": args.unit_id})
                if cr.status_code == 200:
                    cmd = cr.json()
                    profile["command"](state, cmd.get("command", ""), cmd.get("params") or {})
                    client.post(f"{base}/commands/{cmd['command_id']}/ack",
                                headers=headers, json={"status": "completed"})
                    print(f"  applied command: {cmd.get('command')}")

                # Advance + post telemetry.
                snap = profile["step"](state)
                snap["timestamp"] = _now()
                client.post(f"{base}/telemetry", headers=headers,
                            json={"unit_id": args.unit_id, "snapshots": [snap]})
                print(f"  telemetry: {snap}")

                # Low battery alert (once).
                if state.get("battery_pct", 100) < 20 and not state.get("_warned"):
                    state["_warned"] = True
                    client.post(f"{base}/alerts", headers=headers,
                                json={"unit_id": args.unit_id, "level": "warning",
                                      "message": f"Battery low ({state['battery_pct']}%)"})

                time.sleep(TICK_SECONDS)
        except KeyboardInterrupt:
            print("\nstopped.")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
