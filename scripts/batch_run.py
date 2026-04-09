#!/usr/bin/env python3
"""
batch_run.py — Automated batch runner for the dashboard benchmark API.

Submits runs to the Next.js dashboard exactly as the RunForm UI would,
then polls until each run completes before moving to the next.

Platform detection:
  Windows  → EVM variants only  (V1, V2, V3) on hardhat-localnet
  WSL/Linux → Solana variants only (V4, V5) on solana-localnet

Usage:
    python scripts/batch_run.py [--base-url URL] [--repeats N] [--kind KIND]
                                [--env EVM_ENV] [--solana-env SOLANA_ENV]
                                [--clients c1,c2,...] [--dry-run]

Defaults:
    --base-url    http://localhost:3000
    --repeats     20
    --kind        lifecycle
    --env         hardhat-localnet
    --solana-env  solana-localnet
    --clients     python,test-script,ts,dotnet
"""

import argparse
import json
import platform
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Variant = Literal["V1", "V2", "V3", "V4", "V5"]
Client  = Literal["python", "test-script", "ts", "dotnet"]
Kind    = Literal["lifecycle", "throughput"]

EVM_VARIANTS: list[str]    = ["V1", "V2", "V3"]
SOLANA_VARIANTS: list[str] = ["V4", "V5"]
ALL_CLIENTS: list[str]     = ["python", "test-script", "ts", "dotnet"]

POLL_INTERVAL_S  = 3.0
SUBMIT_RETRY_MAX = 3

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

def _is_wsl() -> bool:
    """Return True when running inside WSL."""
    try:
        proc_version = Path("/proc/version").read_text().lower()
        return "microsoft" in proc_version or "wsl" in proc_version
    except OSError:
        return False


def detect_platform() -> str:
    """Return 'windows', 'wsl', or 'linux'."""
    if platform.system() == "Windows":
        return "windows"
    if _is_wsl():
        return "wsl"
    return "linux"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------------------
# Run logic
# ---------------------------------------------------------------------------

@dataclass
class RunResult:
    variant: str
    client: str
    kind: str
    environment: str
    run_index: int
    run_id: str
    status: str          # "success" | "error" | "timeout"
    elapsed_s: float
    error: str = ""


def submit_run(base_url: str, variant: str, client: str, kind: str, environment: str) -> str:
    """POST /api/run; return the run id."""
    url = f"{base_url}/api/run"
    for attempt in range(1, SUBMIT_RETRY_MAX + 1):
        try:
            resp = _post(url, {
                "variant": variant,
                "client": client,
                "kind": kind,
                "environment": environment,
            })
            run_id = resp.get("id")
            if not run_id:
                raise ValueError(f"No id in response: {resp}")
            return run_id
        except (urllib.error.URLError, ValueError) as exc:
            if attempt == SUBMIT_RETRY_MAX:
                raise
            print(f"    submit attempt {attempt} failed ({exc}), retrying…")
            time.sleep(2)
    raise RuntimeError("unreachable")


def poll_run(base_url: str, run_id: str, timeout_s: float = 600.0) -> tuple[str, str]:
    """Poll /api/run/{id} until done. Returns (status, output_tail)."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            data = _get(f"{base_url}/api/run/{run_id}")
            status = data.get("status", "running")
            if status in ("success", "error"):
                output = data.get("output", "")
                return status, output[-400:] if len(output) > 400 else output
        except urllib.error.URLError:
            pass  # dashboard may be momentarily busy
        time.sleep(POLL_INTERVAL_S)
    return "timeout", ""


def execute_run(
    base_url: str,
    variant: str,
    client: str,
    kind: str,
    environment: str,
    run_index: int,
    dry_run: bool,
) -> RunResult:
    start = time.monotonic()

    if dry_run:
        print(f"    [DRY RUN] would POST variant={variant} client={client} kind={kind} env={environment}")
        elapsed = time.monotonic() - start
        return RunResult(variant, client, kind, environment, run_index,
                         run_id="dry-run", status="success", elapsed_s=elapsed)

    try:
        run_id = submit_run(base_url, variant, client, kind, environment)
    except Exception as exc:
        elapsed = time.monotonic() - start
        return RunResult(variant, client, kind, environment, run_index,
                         run_id="", status="error", elapsed_s=elapsed, error=str(exc))

    print(f"    submitted → id={run_id}")
    status, tail = poll_run(base_url, run_id)
    elapsed = time.monotonic() - start

    result = RunResult(variant, client, kind, environment, run_index,
                       run_id=run_id, status=status, elapsed_s=elapsed)
    if status != "success" and tail:
        result.error = tail.strip().splitlines()[-1] if tail.strip() else ""
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Batch-run dashboard benchmarks (mirrors RunForm behaviour)."
    )
    p.add_argument("--base-url",    default="http://localhost:3000",
                   help="Dashboard base URL (default: http://localhost:3000)")
    p.add_argument("--repeats",     type=int, default=20,
                   help="Number of runs per combination (default: 20)")
    p.add_argument("--kind",        default="lifecycle",
                   choices=["lifecycle", "throughput"],
                   help="Benchmark kind (default: lifecycle)")
    p.add_argument("--env",         default="hardhat-localnet",
                   choices=["hardhat-localnet", "sepolia"],
                   help="EVM environment (default: hardhat-localnet)")
    p.add_argument("--solana-env",  default="solana-localnet",
                   choices=["solana-localnet", "solana-devnet"],
                   help="Solana environment (default: solana-localnet)")
    p.add_argument("--clients",     default=",".join(ALL_CLIENTS),
                   help=f"Comma-separated client list (default: {','.join(ALL_CLIENTS)})")
    p.add_argument("--variants",    default=None,
                   help="Override variant list, e.g. V1,V3 (default: platform-appropriate)")
    p.add_argument("--dry-run",     action="store_true",
                   help="Print what would be submitted without actually calling the API")
    p.add_argument("--force-platform", choices=["windows", "wsl", "linux"],
                   help="Override auto-detected platform")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    plat = args.force_platform or detect_platform()
    clients  = [c.strip() for c in args.clients.split(",") if c.strip()]

    if args.variants:
        variants = [v.strip() for v in args.variants.split(",") if v.strip()]
        env_map  = {}
        for v in variants:
            if v in EVM_VARIANTS:
                env_map[v] = args.env
            else:
                env_map[v] = args.solana_env
    elif plat == "windows":
        variants = EVM_VARIANTS
        env_map  = {v: args.env for v in variants}
    else:  # wsl / linux
        variants = SOLANA_VARIANTS
        env_map  = {v: args.solana_env for v in variants}

    combinations = [(v, c) for v in variants for c in clients]
    total_runs   = len(combinations) * args.repeats

    # ------------------------------------------------------------------
    # Summary header
    # ------------------------------------------------------------------
    print("=" * 60)
    print("  Dashboard Batch Runner")
    print("=" * 60)
    print(f"  Platform   : {plat}")
    print(f"  Base URL   : {args.base_url}")
    print(f"  Variants   : {variants}")
    print(f"  Clients    : {clients}")
    print(f"  Kind       : {args.kind}")
    print(f"  Repeats    : {args.repeats}")
    print(f"  Total runs : {total_runs}")
    if args.dry_run:
        print("  Mode       : DRY RUN (no API calls)")
    print("=" * 60)
    print()

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------
    results: list[RunResult] = []
    run_num = 0

    for variant, client in combinations:
        environment = env_map[variant]
        combo_label = f"{variant}/{client}/{args.kind}/{environment}"
        print(f"── Combo: {combo_label} ({args.repeats} runs)")

        combo_ok = combo_fail = 0
        for i in range(1, args.repeats + 1):
            run_num += 1
            pct = run_num / total_runs * 100
            print(f"  [{run_num:3d}/{total_runs}  {pct:5.1f}%] run {i}/{args.repeats} …", end=" ", flush=True)

            r = execute_run(
                base_url=args.base_url,
                variant=variant,
                client=client,
                kind=args.kind,
                environment=environment,
                run_index=i,
                dry_run=args.dry_run,
            )
            results.append(r)

            status_sym = "✓" if r.status == "success" else ("?" if r.status == "timeout" else "✗")
            print(f"{status_sym} {r.status}  ({r.elapsed_s:.1f}s)")
            if r.error:
                print(f"         error: {r.error}")

            if r.status == "success":
                combo_ok += 1
            else:
                combo_fail += 1

        print(f"  → {combo_ok} ok, {combo_fail} failed\n")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    ok    = sum(1 for r in results if r.status == "success")
    fail  = sum(1 for r in results if r.status != "success")
    total_elapsed = sum(r.elapsed_s for r in results)

    print("=" * 60)
    print("  Batch complete")
    print("=" * 60)
    print(f"  Total runs : {len(results)}")
    print(f"  Succeeded  : {ok}")
    print(f"  Failed     : {fail}")
    print(f"  Wall time  : {total_elapsed/60:.1f} min")
    print()

    if fail:
        print("  Failed runs:")
        for r in results:
            if r.status != "success":
                print(f"    {r.variant}/{r.client} run#{r.run_index}  [{r.status}]  {r.error}")
        print()

    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    main()
