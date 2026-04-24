"""
batch_run.py — Batch orchestrator: runs each benchmark combination until the target N is reached.

Each combination is run as an isolated subprocess so results accumulate cleanly
across sessions without in-process state leakage.

Combinations
------------
  EVM  (V1, V2, V3) × (python, ts, dotnet) × (lifecycle, throughput)  → 18  target N=21
  Solana (V4, V5)   × (python, ts, dotnet) × (lifecycle, throughput)  → 12  target N=10
  Total: 30 combinations.

Usage
-----
  # Show status only (no runs):
  python benchmarks/batch_run.py --status

  # Run all missing EVM combinations:
  python benchmarks/batch_run.py --platform evm

  # Run all missing Solana combinations:
  python benchmarks/batch_run.py --platform solana

  # Run a specific variant+client combination:
  python benchmarks/batch_run.py --variant V4 --client ts

  # Dry-run: print commands that would be executed, don't run them:
  python benchmarks/batch_run.py --dry-run

Prerequisites
-------------
  EVM:    cd contracts/evm && npx hardhat node   (keep running in a separate terminal)
  Solana: solana-test-validator --reset           (keep running) then anchor deploy

Note: Solana benchmarks require the program to be deployed to the running validator.
      Re-deploy after each validator restart: cd contracts/solana && anchor deploy

N targets
---------
  EVM (V1-V3):    TARGET_N_EVM=21    override with --target-n-evm or TARGET_N_EVM env var
  Solana (V4-V5): TARGET_N_SOLANA=10 override with --target-n-solana or TARGET_N_SOLANA env var
"""

from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
import sys
import time

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
BENCHMARKS_DIR = REPO_ROOT / "benchmarks"
RESULTS_DIR = BENCHMARKS_DIR / "results"

TARGET_N_EVM: int = int(os.getenv("TARGET_N_EVM", "21"))
TARGET_N_SOLANA: int = int(os.getenv("TARGET_N_SOLANA", "10"))


def _target_n(variant: str) -> int:
    return TARGET_N_SOLANA if variant in SOLANA_VARIANTS else TARGET_N_EVM

# All 30 combinations: (variant, client, kind)
EVM_VARIANTS = ["V1", "V2", "V3"]
SOLANA_VARIANTS = ["V4", "V5"]
CLIENTS = ["python", "ts", "dotnet"]
KINDS = ["lifecycle", "throughput"]

ALL_COMBINATIONS: list[tuple[str, str, str]] = []
for v in EVM_VARIANTS:
    for c in CLIENTS:
        for k in KINDS:
            ALL_COMBINATIONS.append((v, c, k))
for v in SOLANA_VARIANTS:
    for c in CLIENTS:
        for k in KINDS:
            ALL_COMBINATIONS.append((v, c, k))

# Environment labels used in result filenames
EVM_ENV = "hardhat-localnet"
SOLANA_ENV = "solana-localnet"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _env_for(variant: str) -> str:
    return SOLANA_ENV if variant in SOLANA_VARIANTS else EVM_ENV


def _count_results(variant: str, client: str, env: str, kind: str) -> int:
    """Count existing result files for a given combination."""
    prefix = f"{variant}_{client}_{env}_{kind}_"
    if not RESULTS_DIR.exists():
        return 0
    return sum(1 for f in RESULTS_DIR.iterdir() if f.name.startswith(prefix) and f.name.endswith(".json"))


def _build_command(variant: str, client: str, kind: str) -> list[str]:
    """
    Build the subprocess command for one benchmark run.

    Dispatch logic:
    - lifecycle, any client   → run_client_benchmark.py  --platform {evm|solana} --client {client} --variant {variant}
    - throughput, python      → throughput_test.py       --platform {evm|solana} --variant {variant}
    - throughput, ts/dotnet   → run_throughput_client.py --platform {evm|solana} --client {client} --variant {variant}
    """
    platform = "solana" if variant in SOLANA_VARIANTS else "evm"
    py = sys.executable

    if kind == "lifecycle":
        return [
            py, str(BENCHMARKS_DIR / "run_client_benchmark.py"),
            "--platform", platform,
            "--client", client,
            "--variant", variant,
        ]
    else:  # throughput
        if client == "python":
            return [
                py, str(BENCHMARKS_DIR / "throughput_test.py"),
                "--platform", platform,
                "--variant", variant,
            ]
        else:
            return [
                py, str(BENCHMARKS_DIR / "run_throughput_client.py"),
                "--platform", platform,
                "--client", client,
                "--variant", variant,
            ]


def _run_one(variant: str, client: str, kind: str, dry_run: bool = False) -> bool:
    """
    Execute one benchmark run as a subprocess.
    Returns True on success, False on failure.
    """
    cmd = _build_command(variant, client, kind)
    env = {**os.environ, "VARIANT": variant, "CLIENT": client}

    print(f"  → {' '.join(cmd)}", flush=True)
    if dry_run:
        return True

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            env=env,
            cwd=str(REPO_ROOT),
            # On Windows, npm/dotnet are .cmd shims
            shell=(sys.platform == "win32"),
        )
        elapsed = time.time() - t0
        if result.returncode == 0:
            print(f"  OK completed in {elapsed:.1f}s", flush=True)
            return True
        else:
            print(f"  FAIL FAILED (exit {result.returncode}) after {elapsed:.1f}s", flush=True)
            return False
    except KeyboardInterrupt:
        print("\n[batch_run] Interrupted — stopping.", flush=True)
        sys.exit(1)
    except Exception as exc:
        print(f"  FAIL ERROR: {exc}", flush=True)
        return False


def _status_table(filter_variant: str | None = None, filter_client: str | None = None) -> list[dict]:
    """Build status records for all (or filtered) combinations."""
    rows = []
    for variant, client, kind in ALL_COMBINATIONS:
        if filter_variant and variant != filter_variant:
            continue
        if filter_client and client != filter_client:
            continue
        env = _env_for(variant)
        count = _count_results(variant, client, env, kind)
        tgt = _target_n(variant)
        rows.append({
            "variant": variant,
            "client": client,
            "kind": kind,
            "count": count,
            "target": tgt,
            "needed": max(0, tgt - count),
            "done": count >= tgt,
        })
    return rows


def _print_status(rows: list[dict]) -> None:
    done = sum(1 for r in rows if r["done"])
    total = len(rows)
    print(f"\n{'='*72}")
    print(f" Batch run status  EVM target N={TARGET_N_EVM}  Solana target N={TARGET_N_SOLANA}  ({done}/{total} complete)")
    print(f"{'='*72}")
    print(f"{'='*68}")
    print(f"  {'Variant':<8} {'Client':<8} {'Kind':<12} {'Target':>6} {'Have':>5} {'Need':>5}  Status")
    print(f"  {'-'*7} {'-'*7} {'-'*11} {'-'*6} {'-'*5} {'-'*5}  ------")
    for r in rows:
        status = "OK" if r["done"] else f"need {r['needed']}"
        print(f"  {r['variant']:<8} {r['client']:<8} {r['kind']:<12} {r['target']:>6} {r['count']:>5} {r['needed']:>5}  {status}")
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    global TARGET_N_EVM, TARGET_N_SOLANA
    parser = argparse.ArgumentParser(
        description="Batch orchestrator: run benchmark combinations to their target N (EVM=21, Solana=10).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python benchmarks/batch_run.py --status
  python benchmarks/batch_run.py --platform evm
  python benchmarks/batch_run.py --platform solana
  python benchmarks/batch_run.py --variant V5 --client python
  python benchmarks/batch_run.py --dry-run
        """,
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Print status table only; do not run any benchmarks.",
    )
    parser.add_argument(
        "--platform", choices=["evm", "solana"],
        help="Restrict to EVM (V1–V3) or Solana (V4–V5) combinations.",
    )
    parser.add_argument(
        "--variant", choices=["V1", "V2", "V3", "V4", "V5"],
        help="Restrict to a single variant.",
    )
    parser.add_argument(
        "--client", choices=["python", "ts", "dotnet"],
        help="Restrict to a single client.",
    )
    parser.add_argument(
        "--kind", choices=["lifecycle", "throughput"],
        help="Restrict to one benchmark kind.",
    )
    parser.add_argument(
        "--target-n-evm", type=int, default=TARGET_N_EVM,
        help=f"Target N for EVM (V1-V3) combinations (default: {TARGET_N_EVM}).",
    )
    parser.add_argument(
        "--target-n-solana", type=int, default=TARGET_N_SOLANA,
        help=f"Target N for Solana (V4-V5) combinations (default: {TARGET_N_SOLANA}).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print commands that would be run without executing them.",
    )
    args = parser.parse_args()

    # Apply per-platform target overrides
    TARGET_N_EVM = args.target_n_evm
    TARGET_N_SOLANA = args.target_n_solana

    # Build filter
    filter_variant = args.variant
    if args.platform == "evm":
        # Only EVM variants
        filter_variants = EVM_VARIANTS
    elif args.platform == "solana":
        filter_variants = SOLANA_VARIANTS
    else:
        filter_variants = EVM_VARIANTS + SOLANA_VARIANTS

    if filter_variant:
        filter_variants = [filter_variant]

    # Build status for filtered combinations
    rows = []
    for variant, client, kind in ALL_COMBINATIONS:
        if variant not in filter_variants:
            continue
        if args.client and client != args.client:
            continue
        if args.kind and kind != args.kind:
            continue
        env = _env_for(variant)
        count = _count_results(variant, client, env, kind)
        tgt = _target_n(variant)
        rows.append({
            "variant": variant,
            "client": client,
            "kind": kind,
            "count": count,
            "target": tgt,
            "needed": max(0, tgt - count),
            "done": count >= tgt,
        })

    _print_status(rows)

    if args.status:
        return

    # Determine what needs running
    pending = [r for r in rows if not r["done"]]
    if not pending:
        print("[batch_run] All combinations already at target N. Nothing to do.")
        return

    if args.dry_run:
        print(f"[batch_run] DRY RUN — {sum(r['needed'] for r in pending)} runs would be executed:\n")
    else:
        total_runs = sum(r["needed"] for r in pending)
        print(f"[batch_run] Running {total_runs} missing iterations across {len(pending)} combinations.\n")

    # Run missing iterations
    failures: list[str] = []
    for row in pending:
        variant, client, kind = row["variant"], row["client"], row["kind"]
        needed = row["needed"]
        print(f"[{variant} / {client} / {kind}] {row['count']} have, running {needed} more:")
        for i in range(needed):
            label = f"run {i + 1}/{needed}"
            print(f"  [{label}]", flush=True)
            ok = _run_one(variant, client, kind, dry_run=args.dry_run)
            if not ok:
                failures.append(f"{variant}/{client}/{kind} run {i + 1}")
                print(f"  [warn] Continuing despite failure.", flush=True)
        print()

    # Final status
    print("\n" + "=" * 68)
    if failures:
        print(f"[batch_run] Completed with {len(failures)} failure(s):")
        for f in failures:
            print(f"  FAIL {f}")
    else:
        print("[batch_run] All runs completed successfully.")

    # Re-print status after runs
    rows_after = []
    for row in rows:
        env = _env_for(row["variant"])
        count = _count_results(row["variant"], row["client"], env, row["kind"])
        tgt = row["target"]
        rows_after.append({**row, "count": count, "needed": max(0, tgt - count), "done": count >= tgt})
    _print_status(rows_after)


if __name__ == "__main__":
    main()
