# Benchmark Dashboard

Next.js 14 web application for visualising multi-chain crowdfunding benchmark results and triggering live benchmark runs.

## Prerequisites

- Node.js 20.x LTS
- Benchmark result files in `benchmarks/results/` (schema v2 JSON — produced by the Python harness)
- Python venv set up at `clients/python/.venv` (required for the live-run API)

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

| Route         | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `/`           | Home: result cards grouped by (variant, client, environment). Click a card to drill into charts. |
| `/benchmarks` | Full comparison view: ComparisonTable + GasChart + LatencyChart + ThroughputChart.               |
| `/run`        | Full-page run form — equivalent to the sidebar run panel.                                        |

## Features

- **Results overview** — loads all schema v2 `*.json` files from `../benchmarks/results/`, groups by `(variant, client, environment, kind)`, shows latest file per group. Files follow the naming convention `{VARIANT}_{CLIENT}_{ENV}_{KIND}_{TIMESTAMP}.json` (e.g. `V1_python_hardhat-localnet_lifecycle_1774369893.json`); the timestamp allows multiple runs to accumulate without overwriting.
- **Filter bar** — filter by variant (V1–V5), client (python/ts/dotnet), or environment; refresh reloads from disk.
- **Result cards** — click to drill into per-operation gas/fee, latency, and summary metric cards.
- **Comparative charts** — side-by-side TPS and cost-per-TPS bar charts; per-operation gas/fee and latency charts.
- **Comparison table** — cross-variant operation table; click a client column header to sort by cost or latency.
- **Run panel** — select variant/client/benchmark type, start a live run, output streams in real time via polling.

## API routes

All routes require the Node.js runtime.

| Route             | Method | Description                                                                                             |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `/api/benchmarks` | GET    | Returns all loaded `BenchmarkFile[]` from `benchmarks/results/`                                         |
| `/api/run`        | POST   | Spawns the appropriate benchmark script as a subprocess; returns `{ id, status: "running" }` (HTTP 202) |
| `/api/run/[id]`   | GET    | Returns status and stdout/stderr output for a run                                                       |
| `/api/runs`       | GET    | Returns all run history entries sorted newest to oldest                                                 |

### Run request body

```json
{
  "variant": "V1",
  "client": "python",
  "kind": "lifecycle",
  "environment": "hardhat-localnet"
}
```

Valid values:

- `variant`: V1–V5 (V1–V3 are EVM; V4–V5 are Solana)
- `client`: `python` / `ts` / `dotnet`
- `kind`: `lifecycle` / `throughput`
- `environment`: `hardhat-localnet` / `sepolia` (EVM) | `solana-localnet` / `solana-devnet` (Solana)

The API selects the script automatically:

- `lifecycle` → `benchmarks/run_client_benchmark.py`
- `throughput` → `benchmarks/run_throughput_client.py`

## Result file discovery

The dashboard resolves `../benchmarks/results` relative to its working directory. Start the server from `dashboard/` so this path is correct. Only schema v2 files (`"schema_version": "2"`) are displayed; legacy files are silently skipped.

Result files follow the naming convention:

```
{VARIANT}_{CLIENT}_{ENV}_{KIND}_{TIMESTAMP}.json
```

Example: `V1_python_hardhat-localnet_lifecycle_1774369893.json`

The timestamp (Unix epoch seconds) is embedded by `benchmarks/config.py::results_path()` at write time. Multiple runs for the same combination accumulate as separate files; the dashboard deduplicates to the latest for cards and passes all runs to the Comparative Analysis chart for averaging.

## Notes

- Run state is held in in-process memory — it resets when the Next.js server restarts.
- V2 and V3 benchmarks require EVM contract artifacts to be compiled (`npx hardhat compile`) before triggering a run from the UI.
- For full setup and benchmark workflow see [`docs/setup.md`](../docs/setup.md) and [`docs/end-to-end.md`](../docs/end-to-end.md).

---

## Quick start — all contract/client combinations

Minimum steps to collect results for every combination.

### One-time setup

**Terminal A — EVM node (keep running):**

```powershell
cd contracts/evm
npm install
npx hardhat compile
npx hardhat node
```

**Python venv (from repo root, once):**

```powershell
cd clients\python
python -m venv .venv
.venv\Scripts\activate
python -m pip install --no-deps web3==6.20.3
python -m pip install lru-dict==1.3.0
python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0
python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" "eth-typing>=3.0.0,<5" ^
    "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" "eth-hash[pycryptodome]>=0.5.1" ^
    "jsonschema>=4.0.0" "protobuf>=4.21.6" aiohttp requests pyunormalize rlp ^
    "websockets>=10.0,<16.0" typing-extensions "toolz>=0.11.2,<0.12.0"
```

**Terminal B — Dashboard (keep running):**

```powershell
cd dashboard
npm install
npm run dev    # open http://localhost:3000/run
```

**`.env` at repo root** — copy from `.env.example`, set at minimum:

```
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC_URL=http://127.0.0.1:8545
```

> The value above is the Hardhat default account #0 private key — public knowledge, safe for localnet only.

### EVM combinations (Windows native)

Select `hardhat-localnet` in the environment dropdown (default). The benchmark script auto-deploys contracts — no separate deploy step needed.

| Variant      | Client      | Extra setup                                |
| ------------ | ----------- | ------------------------------------------ |
| V1 / V2 / V3 | test-script | None — fully self-contained                |
| V1 / V2 / V3 | python      | venv active + `.env` with `PRIVATE_KEY`    |
| V1 / V2 / V3 | ts          | `cd clients/ts && npm install` (once)      |
| V1 / V2 / V3 | dotnet      | `cd clients/dotnet && dotnet build` (once) |

Dashboard flow: select variant → client → kind → env=`hardhat-localnet` → **Start Run**.

Results appear under `/benchmarks` after the run completes.

### Solana combinations (WSL only)

The dashboard disables Solana variants (V4, V5) when accessed from a Windows browser — the Python harness imports `anchorpy` unconditionally, which requires the Solana toolchain available only in WSL. To use the dashboard UI for Solana runs, start the Next.js server from WSL so the browser connects via a non-Windows user agent.

**WSL Terminal A — validator (keep running):**

```bash
# Run from WSL home (~), not from /mnt/c/...
solana-test-validator --reset
```

**WSL Terminal B — build and deploy programs (once per reset):**

```bash
cd /mnt/c/<path-to-repo>/contracts/solana
npm install
anchor build
anchor deploy
```

**WSL Terminal C — dashboard (keep running):**

```bash
cd /mnt/c/<path-to-repo>/dashboard
npm run dev    # open http://localhost:3000/run
```

Open `http://localhost:3000/run` in your browser, select **V4** or **V5**, choose `solana-localnet` or `solana-devnet`, pick a client and kind, then click **Start Run**. The Windows block is not triggered when the server runs under WSL.

**Alternative — run benchmarks directly from WSL (no dashboard):**

```bash
cd /mnt/c/<path-to-repo>
source clients/python/.venv/bin/activate
VARIANT=V4 python benchmarks/run_tests.py --platform solana
VARIANT=V5 python benchmarks/run_tests.py --platform solana
```

Results land in `benchmarks/results/` and appear in the `/benchmarks` page after a refresh.

### How each client is invoked

| Client        | Mechanism                       | What runs                                               |
| ------------- | ------------------------------- | ------------------------------------------------------- |
| `test-script` | In-process Python               | `run_tests.py` — direct web3.py calls                   |
| `python`      | Python subprocess               | `clients/python/` scripts via `run_client_benchmark.py` |
| `ts`          | `npm run <op>` subprocess       | `clients/ts/src/evm/*.ts` via tsx                       |
| `dotnet`      | `dotnet run -- <op>` subprocess | `clients/dotnet/` project                               |

`run_client_benchmark.py` injects `FACTORY_ADDRESS`, `CAMPAIGN_ADDRESS`, and `PAYMENT_TOKEN_ADDRESS` from the auto-deploy output into each subprocess environment — the ts and dotnet clients do not need those values pre-set in `.env`.
