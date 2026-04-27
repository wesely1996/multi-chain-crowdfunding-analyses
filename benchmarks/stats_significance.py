"""Pairwise significance tests for thesis Tabela 6.X.

EVM (V1/V2/V3): Welch t-test on per-file means across lifecycle runs.
Solana (V4/V5): Mann–Whitney U on per-file means across lifecycle runs.
Bonferroni correction: 4 comparisons → α_corrected = 0.05 / 4 = 0.0125.

Usage (from repo root, venv active):
    python benchmarks/stats_significance.py [--results-dir benchmarks/results] [--format github|csv|latex]
"""

from __future__ import annotations

import argparse
import pathlib
import statistics
import sys

import config

# ---------------------------------------------------------------------------
# Shared loader (mirrors collect_metrics.py without importing it to avoid
# circular issues when running standalone)
# ---------------------------------------------------------------------------

def _load_result_file(path: pathlib.Path) -> dict | None:
    import json
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        print(f"[warn] skipping {path.name}: {exc}", file=sys.stderr)
        return None


def _load_lifecycle(results_dir: pathlib.Path) -> list[dict]:
    files = sorted(results_dir.glob("*_lifecycle*.json"))
    out = []
    for f in files:
        d = _load_result_file(f)
        if d is not None:
            out.append(d)
    return out


def _load_throughput(results_dir: pathlib.Path) -> list[dict]:
    files = sorted(results_dir.glob("*_throughput*.json"))
    out = []
    for f in files:
        d = _load_result_file(f)
        if d is not None:
            out.append(d)
    return out


# ---------------------------------------------------------------------------
# Sample extraction helpers
# ---------------------------------------------------------------------------

def _ops_by_prefix(operations: list[dict], prefix: str) -> list[dict]:
    return [o for o in operations if o.get("name", "").startswith(prefix)]


def _collect_samples(
    results: list[dict],
    variant: str,
    platform: str,
    client: str | None,
    op_prefix: str,
    field: str,
) -> list[float]:
    """Return per-file means for (variant, platform, [client], op_prefix, field)."""
    per_file: list[float] = []
    for r in results:
        if r.get("variant") != variant or r.get("platform") != platform:
            continue
        if client is not None:
            r_client = r.get("client_label", r.get("client", ""))
            if r_client != client:
                continue
        ops = _ops_by_prefix(r.get("operations", []), op_prefix)
        vals = [float(o[field]) for o in ops if o.get(field) is not None]
        if vals:
            per_file.append(statistics.mean(vals))
    return per_file


def _collect_tps_samples(
    tp_results: list[dict],
    variant: str,
    platform: str,
    client: str | None,
) -> list[float]:
    """Return TPS values per throughput file for (variant, platform, [client])."""
    out: list[float] = []
    for r in tp_results:
        if r.get("variant") != variant or r.get("platform") != platform:
            continue
        if client is not None:
            r_client = r.get("client_label", r.get("client", ""))
            if r_client != client:
                continue
        tps = r.get("throughput", {}).get("tps")
        if tps is not None:
            out.append(float(tps))
    return out


# ---------------------------------------------------------------------------
# Statistical tests
# ---------------------------------------------------------------------------

def welch_t(a: list[float], b: list[float]) -> tuple[float, float]:
    """Return (t, p) for two-sided Welch t-test."""
    from scipy.stats import ttest_ind  # type: ignore
    if len(a) < 2 or len(b) < 2:
        return float("nan"), float("nan")
    result = ttest_ind(a, b, equal_var=False)
    return float(result.statistic), float(result.pvalue)


def mann_whitney(a: list[float], b: list[float]) -> tuple[float, float]:
    """Return (U, p) for two-sided Mann–Whitney U test."""
    from scipy.stats import mannwhitneyu  # type: ignore
    if len(a) < 1 or len(b) < 1:
        return float("nan"), float("nan")
    result = mannwhitneyu(a, b, alternative="two-sided")
    return float(result.statistic), float(result.pvalue)


# ---------------------------------------------------------------------------
# Comparison definitions
# (4 comparisons → Bonferroni α_corr = 0.05/4 = 0.0125)
# ---------------------------------------------------------------------------

ALPHA_FAMILY = 0.05
N_COMPARISONS = 4
ALPHA_CORRECTED = ALPHA_FAMILY / N_COMPARISONS  # 0.0125


def _evm_diff_label(a: list[float], b: list[float]) -> str:
    if not a or not b:
        return "—"
    return f"{statistics.mean(a) - statistics.mean(b):+,.0f}"


def _sol_diff_label(a: list[float], b: list[float]) -> str:
    if not a or not b:
        return "—"
    ma = statistics.median(a)
    mb = statistics.median(b)
    diff = ma - mb
    if diff == 0.0:
        return "0"
    return f"{diff:+,.3f}"


def _sig(p: float) -> str:
    if p != p:  # NaN
        return "N/A (premalo podataka)"
    return "DA" if p < ALPHA_CORRECTED else "NE"


def build_significance_table(
    lifecycle: list[dict],
    tp_results: list[dict],
    client: str = "python",
) -> tuple[list[list], list[str]]:
    """Build rows and headers for Tabela 6.X."""

    # --- EVM: gas cost on 'contribute', pairwise V1/V2/V3
    v1 = _collect_samples(lifecycle, "V1", "EVM", client, "contribute", "cost")
    v2 = _collect_samples(lifecycle, "V2", "EVM", client, "contribute", "cost")
    v3 = _collect_samples(lifecycle, "V3", "EVM", client, "contribute", "cost")

    t12, p12 = welch_t(v1, v2)
    t13, p13 = welch_t(v1, v3)
    t23, p23 = welch_t(v2, v3)

    # --- Solana: TPS, V4 vs V5
    s4 = _collect_tps_samples(tp_results, "V4", "Solana", client)
    s5 = _collect_tps_samples(tp_results, "V5", "Solana", client)
    u45, p45 = mann_whitney(s4, s5)

    def _pfmt(p: float) -> str:
        if p != p:
            return "—"
        if p < 0.0001:
            return "< 0.0001"
        return f"{p:.4f}"

    def _sfmt(stat: float) -> str:
        if stat != stat:
            return "—"
        import math
        if math.isinf(stat):
            return "±∞ †"
        return f"{stat:.3f}"

    headers = [
        "Poređenje",
        "Metrika",
        "Test",
        "Statistika",
        f"p-vrednost",
        f"Značajno (α={ALPHA_CORRECTED:.4f})",
        "Razlika (srednje vrednosti)",
        f"N_A / N_B",
    ]

    rows = [
        [
            "V1 vs V2 (EVM)",
            "contribute gas",
            "Welch t",
            _sfmt(t12), _pfmt(p12), _sig(p12),
            _evm_diff_label(v1, v2),
            f"{len(v1)} / {len(v2)}",
        ],
        [
            "V1 vs V3 (EVM)",
            "contribute gas",
            "Welch t",
            _sfmt(t13), _pfmt(p13), _sig(p13),
            _evm_diff_label(v1, v3),
            f"{len(v1)} / {len(v3)}",
        ],
        [
            "V2 vs V3 (EVM)",
            "contribute gas",
            "Welch t",
            _sfmt(t23), _pfmt(p23), _sig(p23),
            _evm_diff_label(v2, v3),
            f"{len(v2)} / {len(v3)}",
        ],
        [
            "V4 vs V5 (Solana)",
            "TPS",
            "Mann–Whitney U",
            _sfmt(u45), _pfmt(p45), _sig(p45),
            _sol_diff_label(s4, s5),
            f"{len(s4)} / {len(s5)}",
        ],
    ]

    return rows, headers


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _render(rows, headers, fmt: str) -> str:
    from tabulate import tabulate  # type: ignore
    tablefmt = {"github": "github", "csv": "tsv", "latex": "latex"}.get(fmt, "github")
    return tabulate(rows, headers=headers, tablefmt=tablefmt)


# ---------------------------------------------------------------------------
# Thesis narrative (Serbian, passive voice)
# ---------------------------------------------------------------------------

NARRATIVE_TEMPLATE = """
Statistička značajnost razlika između varijanti proverena je korišćenjem porodice od {n} poređenja
uz Bonferroni korekciju (α_corr = {alpha_corr:.4f}). Za EVM varijante (N po grupi prikazano u tabeli)
primenjen je Welch-ov t-test na sredinama troškova operacije 'contribute' po datoteci.
Za Solana varijante primenjen je Mann–Whitney U test na vrednostima propusnosti (TPS).
† Statistika t = ±∞ javlja se kada je varijansa unutar grupe jednaka nuli — troškovi gasa na
Hardhat lokalnoj mreži su deterministički (isti iznos u svakom pokretanju). Razlike između
varijanti su apsolutne i p-vrednost < 0.0001 je pouzdana.
""".strip()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pairwise significance tests for thesis Tabela 6.X."
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
    )
    parser.add_argument(
        "--client",
        default="Python web3.py / anchorpy",
        help="Client label to filter (default: 'Python web3.py / anchorpy')",
    )
    args = parser.parse_args()

    results_dir = pathlib.Path(args.results_dir)
    if not results_dir.exists():
        sys.exit(f"[error] Results directory not found: {results_dir}. Run benchmarks first.")

    lifecycle = _load_lifecycle(results_dir)
    tp_results = _load_throughput(results_dir)

    rows, headers = build_significance_table(lifecycle, tp_results, client=args.client)

    print("\n" + "=" * 110)
    print(f"TABELA 6.X — Statistička značajnost razlika između varijanti (Bonferroni α={ALPHA_CORRECTED:.4f}, {N_COMPARISONS} poređenja)")
    print("=" * 110)
    print(_render(rows, headers, args.format))
    print()
    print(NARRATIVE_TEMPLATE.format(n=N_COMPARISONS, alpha_corr=ALPHA_CORRECTED))
    print()
    print(f"Napomena: EVM — Welch t-test (equal_var=False); Solana — Mann–Whitney U (two-sided).")
    print(f"          Bonferroni korekcija: α_family={ALPHA_FAMILY} / {N_COMPARISONS} = {ALPHA_CORRECTED:.4f}.")


if __name__ == "__main__":
    main()
