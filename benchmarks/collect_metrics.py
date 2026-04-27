"""
collect_metrics.py — Parse raw JSON results and print cross-chain comparison tables.

Reads
-----
  benchmarks/results/*.json   (produced by run_tests.py / throughput_test.py /
                                run_client_benchmark.py / run_throughput_client.py)

Supports both schema_version "1" (legacy evm_raw.json / solana_raw.json) and
schema_version "2" (multi-variant, multi-client canonical files).

Output modes
------------
1. --format github   : GitHub-flavoured markdown tables (default)
2. --format csv      : comma-separated values, one row per (variant, client, env, operation)
3. --format latex    : LaTeX tabular environment for thesis appendix

Usage
-----
    # Print all results in results/ dir as github-markdown tables
    python benchmarks/collect_metrics.py

    # Specify results directory
    python benchmarks/collect_metrics.py --results-dir benchmarks/results/

    # Output LaTeX to file
    python benchmarks/collect_metrics.py --format latex --output benchmarks/results/thesis_table.tex

    # Legacy two-file mode (backward compat)
    python benchmarks/collect_metrics.py --evm path/to/evm_raw.json --solana path/to/solana_raw.json
"""

from __future__ import annotations

import argparse
import csv
import io
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
    return [o for o in operations if o["name"].startswith(prefix)]


def _agg(values: list[int | float], platform: str = "EVM") -> dict:
    if not values:
        return {
            "mean": None, "median": None, "q1": None, "q3": None, "iqr": None,
            "stdev": None, "ci95_low": None, "ci95_high": None, "n": 0,
            "min": None, "max": None,
        }
    n = len(values)
    mean_val = statistics.mean(values)
    stdev_val = statistics.stdev(values) if n > 1 else 0.0
    median_val = statistics.median(values)
    if n >= 2:
        qs = statistics.quantiles(values, n=4)
        q1_val, q3_val = qs[0], qs[2]
    else:
        q1_val = q3_val = float(values[0])
    iqr_val = q3_val - q1_val

    ci95_low: float = mean_val
    ci95_high: float = mean_val
    if n >= 2:
        try:
            if platform == "Solana":
                import numpy as np
                from scipy.stats import bootstrap as sp_bootstrap
                res = sp_bootstrap(
                    (list(values),), np.mean,
                    n_resamples=10_000, confidence_level=0.95,
                    method="BCa", random_state=42,
                )
                ci95_low = float(res.confidence_interval.low)
                ci95_high = float(res.confidence_interval.high)
            else:
                from scipy.stats import t as sp_t
                se = stdev_val / (n ** 0.5)
                margin = float(sp_t.ppf(0.975, df=n - 1)) * se
                ci95_low = mean_val - margin
                ci95_high = mean_val + margin
        except ImportError:
            se = stdev_val / (n ** 0.5)
            ci95_low = mean_val - 1.96 * se
            ci95_high = mean_val + 1.96 * se

    return {
        "mean": round(mean_val, 2),
        "median": round(median_val, 2),
        "q1": round(q1_val, 2),
        "q3": round(q3_val, 2),
        "iqr": round(iqr_val, 2),
        "stdev": round(stdev_val, 2),
        "ci95_low": round(ci95_low, 2),
        "ci95_high": round(ci95_high, 2),
        "n": n,
        "min": min(values),
        "max": max(values),
    }


def _cost_agg(ops: list[dict], platform: str = "EVM") -> dict:
    costs = [int(o["cost"]) for o in ops if o.get("cost") is not None]
    return _agg(costs, platform=platform)


def _latency_agg(ops: list[dict], platform: str = "EVM") -> dict:
    lats = [int(o["latency_ms"]) for o in ops if o.get("latency_ms") is not None]
    return _agg(lats, platform=platform)


def _fmt(val: Any, unit: str = "") -> str:
    if val is None:
        return "—"
    if isinstance(val, float):
        return f"{val:,.2f}{unit}"
    return f"{int(val):,}{unit}"


def _fmt_stats(stats: dict, unit: str = "", decimals: int = 0) -> str:
    """Format mean ± SE [IQR: q1–q3] for thesis tables."""
    if stats["mean"] is None:
        return "—"
    mean = stats["mean"]
    stdev = stats["stdev"] or 0.0
    n = stats["n"] or 1
    se = stdev / (n ** 0.5) if n > 0 else 0.0
    q1 = stats["q1"]
    q3 = stats["q3"]

    def fv(v: float | None) -> str:
        if v is None:
            return "—"
        return f"{v:,.{decimals}f}"

    return f"{fv(mean)} ± {fv(se)} [IQR: {fv(q1)}–{fv(q3)}]{unit}"


# ---------------------------------------------------------------------------
# Multi-file loader
# ---------------------------------------------------------------------------

def _load_result_file(path: pathlib.Path) -> dict | None:
    try:
        with open(path) as fh:
            data = json.load(fh)
        # Normalise schema v1 → v2 fields
        if "schema_version" not in data:
            data["schema_version"] = "1"
        if "variant" not in data:
            # Infer from platform
            if data.get("platform") == "EVM":
                data["variant"] = "V1"
            elif data.get("platform") == "Solana":
                data["variant"] = "V4"
            else:
                data["variant"] = "unknown"
        if "client" not in data:
            data["client"] = "python"
        if "environment" not in data:
            data["environment"] = data.get("environment", "unknown")
        _validate(data, str(path))
        return data
    except Exception as exc:
        print(f"[warn] Skipping {path}: {exc}", file=sys.stderr)
        return None


def load_all_results(results_dir: pathlib.Path) -> list[dict]:
    """Load all lifecycle JSON files from results_dir, sorted by variant+client+env.

    Matches both old naming (*_lifecycle.json) and new timestamped naming
    (*_lifecycle_{timestamp}.json) via the glob pattern *_lifecycle*.json.
    """
    files = sorted(results_dir.glob("*_lifecycle*.json"))
    # Also include legacy evm_raw.json / solana_raw.json if no canonical files found
    if not files:
        for legacy in (config.EVM_RAW_RESULTS, config.SOLANA_RAW_RESULTS):
            if legacy.exists():
                files.append(legacy)
    results = []
    for f in files:
        data = _load_result_file(f)
        if data is not None:
            results.append(data)
    return results


def load_throughput_results(results_dir: pathlib.Path) -> list[dict]:
    """Load all throughput JSON files from results_dir.

    Matches both old naming (*_throughput.json) and new timestamped naming
    (*_throughput_{timestamp}.json) via the glob pattern *_throughput*.json.
    """
    files = sorted(results_dir.glob("*_throughput*.json"))
    results = []
    for f in files:
        data = _load_result_file(f)
        if data is not None:
            results.append(data)
    return results


# ---------------------------------------------------------------------------
# Table builders
# ---------------------------------------------------------------------------

# Operations in canonical lifecycle order
OP_MAP = [
    ("contribute",          "contribute"),
    ("finalize",            "finalize"),
    ("withdrawMilestone_0", "withdraw_milestone_0"),
    ("withdrawMilestone_1", "withdraw_milestone_1"),
    ("withdrawMilestone_2", "withdraw_milestone_2"),
    ("refund",              "refund"),
]


def _build_operation_rows(
    evm_data: dict | None,
    sol_data: dict | None,
) -> tuple[list[list], list[str]]:
    headers = [
        "Operation",
        "EVM cost (gas)", "EVM min/max gas", "EVM latency ms",
        "SOL cost (lam)", "SOL min/max lam", "SOL latency ms",
    ]
    rows = []
    for evm_name, sol_name in OP_MAP:
        evm_ops = _ops_by_prefix(evm_data["operations"], evm_name) if evm_data else []
        sol_ops = _ops_by_prefix(sol_data["operations"], sol_name) if sol_data else []

        evm_cost = _cost_agg(evm_ops, platform="EVM")
        evm_lat  = _latency_agg(evm_ops, platform="EVM")
        sol_cost = _cost_agg(sol_ops, platform="Solana")
        sol_lat  = _latency_agg(sol_ops, platform="Solana")

        n_evm = len(evm_ops)
        label = evm_name if n_evm > 0 else sol_name
        if n_evm > 1:
            label += f" (N={n_evm})"

        rows.append([
            label,
            _fmt(evm_cost["mean"]),
            f"{_fmt(evm_cost['min'])} / {_fmt(evm_cost['max'])}",
            _fmt(evm_lat["mean"]),
            _fmt(sol_cost["mean"]),
            f"{_fmt(sol_cost['min'])} / {_fmt(sol_cost['max'])}",
            _fmt(sol_lat["mean"]),
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


def _build_multi_client_rows(results: list[dict]) -> tuple[list[list], list[str]]:
    """Build a table comparing clients for the same variant+environment."""
    headers = [
        "Variant", "Client", "Environment",
        "contribute avg cost", "contribute latency ms",
        "finalize cost", "TPS",
    ]
    rows = []
    for r in results:
        variant = r.get("variant", "?")
        client = r.get("client_label", r.get("client", "?"))
        env = r.get("environment", "?")
        platform = r.get("platform", "?")
        cost_unit = "gas" if platform == "EVM" else "lam"

        contrib_ops = _ops_by_prefix(r["operations"], "contribute")
        finalize_ops = _ops_by_prefix(r["operations"], "finalize")

        contrib_cost = _cost_agg(contrib_ops, platform=platform)
        contrib_lat = _latency_agg(contrib_ops, platform=platform)
        fin_cost = _cost_agg(finalize_ops, platform=platform)
        tps = r["throughput"].get("tps")

        rows.append([
            f"{variant} ({config.VARIANT_LABELS.get(variant, '')})",
            client,
            env,
            f"{_fmt(contrib_cost['mean'])} {cost_unit}",
            f"{_fmt(contrib_lat['mean'])} ms",
            f"{_fmt(fin_cost['mean'])} {cost_unit}",
            _fmt(tps),
        ])
    return rows, headers


# ---------------------------------------------------------------------------
# Thesis table builders (cross-file CI/IQR aggregation for Tabele 6.1/6.6/6.7)
# ---------------------------------------------------------------------------

def _collect_op_stats(
    results: list[dict],
    variant: str,
    platform: str,
    client: str | None,
    op_prefix: str,
    field: str,
) -> dict:
    """Aggregate per-file means across lifecycle files for (variant, platform, [client])."""
    per_file: list[float] = []
    for r in results:
        if r.get("variant") != variant or r.get("platform") != platform:
            continue
        if client is not None:
            r_client = r.get("client_label", r.get("client", ""))
            if r_client != client:
                continue
        ops = _ops_by_prefix(r["operations"], op_prefix)
        vals = [float(o[field]) for o in ops if o.get(field) is not None]
        if vals:
            per_file.append(statistics.mean(vals))
    return _agg(per_file, platform=platform)


def _collect_tps_stats(
    tp_results: list[dict],
    variant: str,
    platform: str,
    client: str | None,
) -> dict:
    """Aggregate TPS values across throughput files for (variant, platform, [client])."""
    tps_list: list[float] = []
    for r in tp_results:
        if r.get("variant") != variant or r.get("platform") != platform:
            continue
        if client is not None:
            r_client = r.get("client_label", r.get("client", ""))
            if r_client != client:
                continue
        tps = r.get("throughput", {}).get("tps")
        if tps is not None:
            tps_list.append(float(tps))
    return _agg(tps_list, platform=platform)


_EVM_THESIS_OPS = [
    ("contribute",          "Doprinos (contribute)"),
    ("finalize",            "Finalizacija (finalize)"),
    ("withdrawMilestone_0", "Isplata 0 (withdraw_0)"),
    ("withdrawMilestone_1", "Isplata 1 (withdraw_1)"),
    ("withdrawMilestone_2", "Isplata 2 (withdraw_2)"),
    ("refund",              "Povraćaj (refund)"),
]

_SOL_THESIS_OPS = [
    ("contribute", "Doprinos (contribute)"),
    ("finalize",   "Finalizacija (finalize)"),
    ("withdraw",   "Isplata (withdraw)"),
    ("refund",     "Povraćaj (refund)"),
]

# Full client_label strings as stored in result JSON files
_CLIENT_PYTHON = "Python web3.py / anchorpy"
_CLIENT_TS     = "TypeScript viem / Anchor TS"
_CLIENT_DOTNET = ".NET Nethereum / Solnet"


def _build_thesis_61_rows(
    results: list[dict], client: str = _CLIENT_PYTHON
) -> tuple[list[list], list[str]]:
    """Tabela 6.1 — EVM lifecycle gas costs: operations × V1/V2/V3."""
    variants = ["V1", "V2", "V3"]
    headers = ["Operacija"] + [f"{v} (gas)\nmean ± SE [IQR] (N)" for v in variants]
    rows = []
    for op_prefix, op_label in _EVM_THESIS_OPS:
        row: list = [op_label]
        for v in variants:
            s = _collect_op_stats(results, v, "EVM", client, op_prefix, "cost")
            row.append(_fmt_stats(s, decimals=0) + f" (N={s['n']})")
        rows.append(row)
    return rows, headers


def _build_thesis_66_rows(
    results: list[dict],
) -> tuple[list[list], list[str]]:
    """Tabela 6.6 — EVM throughput TPS from lifecycle files: clients × V1/V2/V3.

    Uses lifecycle throughput.tps (50 sequential contributes within lifecycle run)
    which matches the methodology used for the original thesis measurements.
    """
    variants = ["V1", "V2", "V3"]
    clients = [
        (_CLIENT_PYTHON, "Python"),
        (_CLIENT_TS,     "TypeScript"),
        (_CLIENT_DOTNET, ".NET"),
    ]
    headers = ["Klijent"] + [f"{v} (TPS)\nmean ± SE [IQR] (N)" for v in variants]
    rows = []
    for client_key, client_label in clients:
        row: list = [client_label]
        for v in variants:
            s = _collect_tps_stats(results, v, "EVM", client_key)
            row.append(_fmt_stats(s, decimals=2) + f" (N={s['n']})")
        rows.append(row)
    return rows, headers


def _build_thesis_67_rows(
    results: list[dict], client: str = _CLIENT_PYTHON
) -> tuple[list[list], list[str]]:
    """Tabela 6.7 — Solana lifecycle fees: operations × V4/V5."""
    variants = ["V4", "V5"]
    headers = ["Operacija"] + [f"{v} (lam)\nmean ± SE [IQR] (N)" for v in variants]
    rows = []
    for op_prefix, op_label in _SOL_THESIS_OPS:
        row: list = [op_label]
        for v in variants:
            s = _collect_op_stats(results, v, "Solana", client, op_prefix, "cost")
            row.append(_fmt_stats(s, decimals=0) + f" (N={s['n']})")
        rows.append(row)
    return rows, headers


def print_thesis_tables(
    results: list[dict],
    tp_results: list[dict],
    fmt: str = "github",
) -> None:
    """Print Tabele 6.1, 6.6, 6.7 with cross-file CI/IQR statistics."""
    print("\n" + "=" * 100)
    print(f"TABELA 6.1 — EVM lifecycle gas costs (V1/V2/V3, klijent: {_CLIENT_PYTHON}, cross-file N runs)")
    print("=" * 100)
    rows, headers = _build_thesis_61_rows(results)
    print(_render(rows, headers, fmt, caption="Tabela 6.1 — EVM troškovi životnog ciklusa"))

    print("\n" + "=" * 100)
    print("TABELA 6.6 — Throughput TPS (EVM V1/V2/V3 × klijenti, cross-file N runs)")
    print("=" * 100)
    rows, headers = _build_thesis_66_rows(results)
    print(_render(rows, headers, fmt, caption="Tabela 6.6 — Propusnost po varijanti i klijentu"))

    print("\n" + "=" * 100)
    print(f"TABELA 6.7 — Solana lifecycle fees (V4/V5, klijent: {_CLIENT_PYTHON}, cross-file N runs)")
    print("=" * 100)
    rows, headers = _build_thesis_67_rows(results)
    print(_render(rows, headers, fmt, caption="Tabela 6.7 — Solana troškovi životnog ciklusa"))


# ---------------------------------------------------------------------------
# Format renderers
# ---------------------------------------------------------------------------

def _render_github(rows: list[list], headers: list[str]) -> str:
    return tabulate(rows, headers=headers, tablefmt="github")


def _render_csv(rows: list[list], headers: list[str]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return buf.getvalue()


def _render_latex(rows: list[list], headers: list[str], caption: str = "") -> str:
    col_spec = "l" + "r" * (len(headers) - 1)
    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\begin{tabular}{" + col_spec + r"}",
        r"\toprule",
        " & ".join(f"\\textbf{{{h}}}" for h in headers) + r" \\",
        r"\midrule",
    ]
    for row in rows:
        lines.append(" & ".join(str(c) for c in row) + r" \\")
    lines += [
        r"\bottomrule",
        r"\end{tabular}",
    ]
    if caption:
        lines.append(f"\\caption{{{caption}}}")
    lines.append(r"\end{table}")
    return "\n".join(lines)


def _render(rows: list[list], headers: list[str], fmt: str, caption: str = "") -> str:
    if fmt == "csv":
        return _render_csv(rows, headers)
    elif fmt == "latex":
        return _render_latex(rows, headers, caption)
    else:
        return _render_github(rows, headers)


# ---------------------------------------------------------------------------
# Legacy two-file comparison (kept for backward compat)
# ---------------------------------------------------------------------------

def load_results(evm_path: pathlib.Path, sol_path: pathlib.Path) -> tuple[dict | None, dict | None]:
    evm_data: dict | None = None
    sol_data: dict | None = None

    if evm_path.exists():
        with open(evm_path) as fh:
            evm_data = json.load(fh)
        _validate(evm_data, str(evm_path))
    else:
        print(f"[warn] EVM results not found at {evm_path}. Run: python benchmarks/run_tests.py --platform evm",
              file=sys.stderr)

    if sol_path.exists():
        with open(sol_path) as fh:
            sol_data = json.load(fh)
        _validate(sol_data, str(sol_path))
    else:
        print(f"[warn] Solana results not found at {sol_path}. Run: python benchmarks/run_tests.py --platform solana",
              file=sys.stderr)

    if evm_data is None and sol_data is None:
        sys.exit("[error] No results found. Run run_tests.py first.")

    return evm_data, sol_data


def print_comparison(evm_data: dict | None, sol_data: dict | None, fmt: str = "github") -> None:
    print("\n" + "=" * 100)
    print("CROSS-CHAIN BENCHMARK COMPARISON — MVP Baseline")
    evm_variant = evm_data.get("variant", "EVM")   if evm_data else "EVM (no data)"
    sol_variant = sol_data.get("variant", "Solana") if sol_data else "Solana (no data)"
    print(f"  {evm_variant}  vs.  {sol_variant}")
    print("=" * 100)

    rows, headers = _build_operation_rows(evm_data, sol_data)
    rows.append(_build_throughput_row(evm_data, sol_data))
    print(_render(rows, headers, fmt, caption="Cross-chain operation comparison"))

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

    print()
    print("Footnotes")
    print("---------")
    print("(1) Hardhat automines instantly. EVM latency = local execution time only.")
    print("(2) solana-test-validator is single-threaded. TPS does not represent production.")
    print("(3) EVM gas varies: first tx has cold SSTORE penalties (~+51k gas).")
    print("(4) Solana fees are flat (5,000 lam/sig). No cost gradient across operations.")
    print()


# ---------------------------------------------------------------------------
# Multi-file comparison
# ---------------------------------------------------------------------------

def print_multi_comparison(results: list[dict], fmt: str = "github", output: pathlib.Path | None = None) -> None:
    """Print a per-variant/client/env comparison from all loaded result files."""
    if not results:
        print("[warn] No lifecycle result files found.", file=sys.stderr)
        return

    print("\n" + "=" * 100)
    print("BENCHMARK RESULTS — ALL VARIANTS × CLIENTS × ENVIRONMENTS")
    print(f"  {len(results)} result file(s) loaded")
    print("=" * 100)

    # ── 1. Multi-client summary table ─────────────────────────────────────────
    rows, headers = _build_multi_client_rows(results)
    rendered = _render(rows, headers, fmt, caption="Benchmark summary by variant, client, and environment")
    print(rendered)

    # ── 2. Per-variant cross-environment tables ───────────────────────────────
    variants_seen: set[str] = {r.get("variant", "?") for r in results}
    for variant in sorted(variants_seen):
        variant_results = [r for r in results if r.get("variant") == variant]
        evm_results = [r for r in variant_results if r.get("platform") == "EVM"]
        sol_results = [r for r in variant_results if r.get("platform") == "Solana"]

        if not evm_results and not sol_results:
            continue

        # Pick first EVM and first Solana for per-op comparison
        evm_data = evm_results[0] if evm_results else None
        sol_data = sol_results[0] if sol_results else None

        if evm_data or sol_data:
            print(f"\n--- Variant {variant}: per-operation costs ---")
            rows, headers = _build_operation_rows(evm_data, sol_data)
            rows.append(_build_throughput_row(evm_data, sol_data))
            print(_render(rows, headers, fmt,
                          caption=f"Variant {variant} operation costs and latency"))

    # ── 3. Output to file if requested ────────────────────────────────────────
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        rows, headers = _build_multi_client_rows(results)
        content = _render(rows, headers, fmt,
                          caption="Benchmark summary by variant, client, and environment")
        output.write_text(content)
        print(f"\n[output] Written to {output}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse raw benchmark results and print cross-chain comparison tables."
    )
    parser.add_argument(
        "--results-dir",
        default=str(config.RESULTS_DIR),
        help="Directory containing result JSON files (default: benchmarks/results/)",
    )
    parser.add_argument(
        "--format",
        choices=["github", "csv", "latex"],
        default="github",
        help="Output format: github (default), csv, or latex",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Write rendered output to this file (optional)",
    )
    # Legacy two-file args (backward compat)
    parser.add_argument("--evm",    default=None, help="Path to EVM raw JSON (legacy)")
    parser.add_argument("--solana", default=None, help="Path to Solana raw JSON (legacy)")
    parser.add_argument(
        "--thesis",
        action="store_true",
        help="Print Tabele 6.1/6.6/6.7 with cross-file CI/IQR statistics (for thesis)",
    )
    args = parser.parse_args()

    out_path = pathlib.Path(args.output) if args.output else None

    # Legacy mode: explicit --evm / --solana paths
    if args.evm or args.solana:
        evm_path = pathlib.Path(args.evm) if args.evm else config.EVM_RAW_RESULTS
        sol_path = pathlib.Path(args.solana) if args.solana else config.SOLANA_RAW_RESULTS
        evm_data, sol_data = load_results(evm_path, sol_path)
        print_comparison(evm_data, sol_data, fmt=args.format)
        return

    # Thesis mode: cross-file statistics for Tabele 6.1/6.6/6.7
    if args.thesis:
        results_dir = pathlib.Path(args.results_dir)
        if not results_dir.exists():
            sys.exit(f"[error] Results directory not found: {results_dir}. Run benchmarks first.")
        results = load_all_results(results_dir)
        tp_results = load_throughput_results(results_dir)
        print_thesis_tables(results, tp_results, fmt=args.format)
        return

    # Multi-file mode: scan results directory
    results_dir = pathlib.Path(args.results_dir)
    if not results_dir.exists():
        sys.exit(f"[error] Results directory not found: {results_dir}. Run benchmarks first.")

    results = load_all_results(results_dir)
    print_multi_comparison(results, fmt=args.format, output=out_path)


if __name__ == "__main__":
    main()
