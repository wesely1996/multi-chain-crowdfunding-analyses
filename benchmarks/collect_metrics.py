"""
collect_metrics.py — Parse raw JSON results and print a cross-chain comparison table.

Reads
-----
  benchmarks/results/evm_raw.json    (produced by run_tests.py --platform evm)
  benchmarks/results/solana_raw.json (produced by run_tests.py --platform solana)

If only one file is present, it prints that platform's table and notes the other
is missing.

Output
------
1. Per-operation table with avg/min/max cost and latency for both chains.
2. Throughput comparison row.
3. Limitation notices embedded as footnotes.

Canonical JSON schema expected (per platform)
---------------------------------------------
{
  "platform": "EVM|Solana",
  "variant": "V1-ERC20|V4-SPL",
  "operations": [
    {
      "name": "contribute",
      "gas_used|compute_units": <int|null>,
      "cost": "<str>",          -- gas units (EVM) or lamports (Solana)
      "latency_ms": <int>
    },
    ...
  ],
  "throughput": {
    "num_contributions": 50,
    "total_time_ms": <int>,
    "tps": <float>
  }
}

Run
---
    python benchmarks/collect_metrics.py
    python benchmarks/collect_metrics.py --evm path/to/evm.json --solana path/to/sol.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
from typing import Any

import config

try:
    from tabulate import tabulate
except ImportError:
    sys.exit("Missing dependency: tabulate. Run: pip install -r benchmarks/requirements.txt")


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

REQUIRED_OP_KEYS = {"name", "cost", "latency_ms"}


def _validate(data: dict, source: str) -> None:
    if "platform" not in data:
        raise ValueError(f"{source}: missing 'platform' key")
    if "operations" not in data:
        raise ValueError(f"{source}: missing 'operations' key")
    if "throughput" not in data:
        raise ValueError(f"{source}: missing 'throughput' key")
    for op in data["operations"]:
        missing = REQUIRED_OP_KEYS - set(op.keys())
        if missing:
            raise ValueError(f"{source}: operation '{op.get('name', '?')}' missing keys {missing}")


# ---------------------------------------------------------------------------
# Aggregation helpers
# ---------------------------------------------------------------------------

def _ops_by_prefix(operations: list[dict], prefix: str) -> list[dict]:
    """Return all ops whose name starts with prefix."""
    return [o for o in operations if o["name"].startswith(prefix)]


def _agg(values: list[int | float]) -> dict:
    if not values:
        return {"avg": None, "min": None, "max": None, "stdev": None}
    return {
        "avg": round(statistics.mean(values), 2),
        "min": min(values),
        "max": max(values),
        "stdev": round(statistics.stdev(values), 2) if len(values) > 1 else 0.0,
    }


def _cost_agg(ops: list[dict]) -> dict:
    costs = [int(o["cost"]) for o in ops if o.get("cost") is not None]
    return _agg(costs)


def _latency_agg(ops: list[dict]) -> dict:
    lats = [int(o["latency_ms"]) for o in ops if o.get("latency_ms") is not None]
    return _agg(lats)


def _fmt(val: Any, unit: str = "") -> str:
    if val is None:
        return "—"
    if isinstance(val, float):
        return f"{val:,.2f}{unit}"
    return f"{int(val):,}{unit}"


# ---------------------------------------------------------------------------
# Table builders
# ---------------------------------------------------------------------------

def _build_operation_rows(
    evm_data: dict | None,
    sol_data: dict | None,
) -> tuple[list[list], list[str]]:
    """
    Return (rows, headers) for the per-operation comparison table.

    Cost columns:
      EVM  → gas_used (integer, no fiat without live gas price)
      Solana → lamports (flat fee)
    """
    headers = [
        "Operation",
        "EVM cost (gas)", "EVM cost min/max", "EVM latency ms (avg)",
        "SOL cost (lam)", "SOL cost min/max", "SOL latency ms (avg)",
    ]

    # Canonical operations to display, in lifecycle order
    op_map = [
        ("contribute",          "contribute"),
        ("finalize",            "finalize"),
        ("withdrawMilestone_0", "withdraw_milestone_0"),
        ("withdrawMilestone_1", "withdraw_milestone_1"),
        ("withdrawMilestone_2", "withdraw_milestone_2"),
        ("refund",              "refund"),
    ]

    rows = []
    for evm_name, sol_name in op_map:
        evm_ops = _ops_by_prefix(evm_data["operations"], evm_name) if evm_data else []
        sol_ops = _ops_by_prefix(sol_data["operations"], sol_name) if sol_data else []

        evm_cost = _cost_agg(evm_ops)
        evm_lat  = _latency_agg(evm_ops)
        sol_cost = _cost_agg(sol_ops)
        sol_lat  = _latency_agg(sol_ops)

        n_evm = len(evm_ops)
        n_sol = len(sol_ops)
        label = evm_name if n_evm > 0 else sol_name
        if n_evm > 1:
            label += f" (N={n_evm})"

        rows.append([
            label,
            _fmt(evm_cost["avg"]),
            f"{_fmt(evm_cost['min'])} / {_fmt(evm_cost['max'])}",
            _fmt(evm_lat["avg"]),
            _fmt(sol_cost["avg"]),
            f"{_fmt(sol_cost['min'])} / {_fmt(sol_cost['max'])}",
            _fmt(sol_lat["avg"]),
        ])

    return rows, headers


def _build_throughput_row(evm_data: dict | None, sol_data: dict | None) -> list:
    evm_tp = evm_data["throughput"] if evm_data else {}
    sol_tp = sol_data["throughput"] if sol_data else {}

    return [
        "Throughput (50 tx)",
        f"Total: {_fmt(evm_tp.get('total_time_ms'))} ms",
        f"{_fmt(evm_tp.get('tps'))} TPS",
        "—",
        f"Total: {_fmt(sol_tp.get('total_time_ms'))} ms",
        f"{_fmt(sol_tp.get('tps'))} TPS",
        "—",
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_results(evm_path: pathlib.Path, sol_path: pathlib.Path) -> tuple[dict | None, dict | None]:
    evm_data: dict | None = None
    sol_data: dict | None = None

    if evm_path.exists():
        with open(evm_path) as fh:
            evm_data = json.load(fh)
        _validate(evm_data, str(evm_path))
    else:
        print(f"[warn] EVM results not found at {evm_path}. Run: python benchmarks/run_tests.py --platform evm")

    if sol_path.exists():
        with open(sol_path) as fh:
            sol_data = json.load(fh)
        _validate(sol_data, str(sol_path))
    else:
        print(f"[warn] Solana results not found at {sol_path}. Run: python benchmarks/run_tests.py --platform solana")

    if evm_data is None and sol_data is None:
        sys.exit("[error] No results found. Run run_tests.py first.")

    return evm_data, sol_data


def print_comparison(evm_data: dict | None, sol_data: dict | None) -> None:
    print("\n" + "=" * 100)
    print("CROSS-CHAIN BENCHMARK COMPARISON — MVP Baseline")
    evm_variant = evm_data.get("variant", "EVM")   if evm_data else "EVM (no data)"
    sol_variant = sol_data.get("variant", "Solana") if sol_data else "Solana (no data)"
    print(f"  {evm_variant} (Hardhat localnet)  vs.  {sol_variant} (solana-test-validator localnet)")
    print("=" * 100)

    rows, headers = _build_operation_rows(evm_data, sol_data)
    rows.append(_build_throughput_row(evm_data, sol_data))

    print(tabulate(rows, headers=headers, tablefmt="github"))

    # ── Structured JSON summary (machine-readable) ───────────────────────────
    summary = {
        "evm": evm_data,
        "solana": sol_data,
        "notes": [
            "EVM cost unit: gas (integer). No fiat conversion without live gas price.",
            "Solana cost unit: lamports. Flat per-signature fee (5000 lam/sig).",
            "EVM latency on Hardhat = execution time only; NOT network propagation.",
            "Solana TPS on localnet = single-threaded; NOT production throughput.",
            "Compute Units for Solana not recorded in this run (planned for devnet).",
        ],
    }
    summary_path = config.RESULTS_DIR / "comparison_summary.json"
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(summary_path, "w") as fh:
        json.dump(summary, fh, indent=2)
    print(f"\n[output] Structured summary: {summary_path}")

    # ── Footnotes ─────────────────────────────────────────────────────────────
    print()
    print("Footnotes")
    print("---------")
    print("(1) Hardhat automines instantly. EVM latency = local execution time only.")
    print("    Propagation / mempool wait is not captured. Re-run on Sepolia for real latency.")
    print("(2) solana-test-validator is single-threaded. TPS does not represent production.")
    print("    Re-run on devnet for a representative latency figure.")
    print("(3) EVM gas costs vary: first tx has cold SSTORE penalties (~+51 k gas).")
    print("    avg/min/max spread reflects SSTORE zero→nonzero vs nonzero→nonzero costs.")
    print("(4) Solana fees are flat (5,000 lam/sig). No cost gradient across operations.")
    print("(5) Compute Units (Solana) not recorded here. Add ComputeBudgetProgram.setComputeUnitLimit")
    print("    instrumentation before the devnet run.")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse raw benchmark results and print cross-chain comparison table."
    )
    parser.add_argument("--evm",    default=str(config.EVM_RAW_RESULTS),    help="Path to EVM raw JSON")
    parser.add_argument("--solana", default=str(config.SOLANA_RAW_RESULTS), help="Path to Solana raw JSON")
    args = parser.parse_args()

    evm_path = pathlib.Path(args.evm)
    sol_path = pathlib.Path(args.solana)

    evm_data, sol_data = load_results(evm_path, sol_path)
    print_comparison(evm_data, sol_data)


if __name__ == "__main__":
    main()
