# Benchmark Dashboard

Next.js 14 web application for visualising multi-chain crowdfunding benchmark results and triggering live benchmark runs.

## Prerequisites

- Node.js 20.x LTS
- Benchmark result files in `benchmarks/results/` (schema v2 JSON — produced by the Python harness)
- Python venv set up at `benchmarks/.venv` (required for the live-run API)

## Install and run

```bash
cd dashboard
npm install
npm run dev        # development server with hot reload
```

Open [http://localhost:3000](http://localhost:3000).

For a production build:

```bash
npm run build
npm start
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home: result cards grouped by (variant, client, environment). Click a card to drill into charts. |
| `/benchmarks` | Full comparison view: ComparisonTable + GasChart + LatencyChart + ThroughputChart. |
| `/run` | Full-page run form — equivalent to the sidebar run panel. |

## Features

- **Results overview** — loads all schema v2 `*.json` files from `../benchmarks/results/`, groups by `(variant, client, environment, kind)`, shows latest file per group.
- **Filter bar** — filter by variant (V1–V5), client (python/ts/dotnet), or environment; refresh reloads from disk.
- **Result cards** — click to drill into per-operation gas/fee, latency, and summary metric cards.
- **Comparative charts** — side-by-side TPS and cost-per-TPS bar charts; per-operation gas/fee and latency charts.
- **Comparison table** — cross-variant operation table; click a client column header to sort by cost or latency.
- **Run panel** — select variant/client/benchmark type, start a live run, output streams in real time via polling.

## API routes

All routes require the Node.js runtime.

| Route | Method | Description |
|-------|--------|-------------|
| `/api/benchmarks` | GET | Returns all loaded `BenchmarkFile[]` from `benchmarks/results/` |
| `/api/run` | POST | Spawns `benchmarks/run_tests.py` as a subprocess; returns `{ id, status: "running" }` (HTTP 202) |
| `/api/run/[id]` | GET | Returns status, stdout/stderr output, and result file path for a run |

### Run request body

```json
{
  "variant": "V1",
  "client": "python",
  "kind": "lifecycle"
}
```

Valid values: `variant` = V1–V5 | `client` = python / ts / dotnet | `kind` = lifecycle / throughput

## Result file discovery

The dashboard resolves `../benchmarks/results` relative to its working directory. Start the server from `dashboard/` so this path is correct. Only schema v2 files (`"schema_version": "2"`) are displayed; legacy files are silently skipped.

## Notes

- Run state is held in in-process memory — it resets when the Next.js server restarts.
- V2 and V3 benchmarks require EVM contract artifacts to be compiled (`npx hardhat compile`) before triggering a run from the UI.
- For full setup and benchmark workflow see [`docs/setup.md`](../docs/setup.md) and [`docs/end-to-end.md`](../docs/end-to-end.md).
