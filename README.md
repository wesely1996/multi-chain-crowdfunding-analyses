# Multi-Chain Crowdfunding Smart Contract

**Master's Thesis** — Department of Information Technology

**Student:** Nikola Veselinović (53m/24)

**Supervisor:** Prof. dr Lidija Foror

**GitHubRepo:** https://github.com/wesely1996/multi-chain-crowdfunding-analyses

## Overview

This repository contains the research implementation for the thesis:

> *Development of a Smart Contract for a Multi-Blockchain Crowdfunding Platform – Implementation, Integration, and Comparative Analysis of Performance and Engineering Complexity*

The goal is to implement a canonical crowdfunding model across multiple blockchain platforms and perform a controlled comparative analysis of quantitative performance (transaction costs, finality time, throughput) and qualitative aspects (security, Developer Experience, integration complexity).

## Contract Variants

All variants implement the same lifecycle:

```
Init → Funding (softCap, hardCap, deadline) → Finalize → Success (withdraw by milestones)
                                                       └→ Fail (refund contributors)
```

| # | Variant | Standard | Status |
|---|---------|----------|--------|
| 1 | EVM – Receipt tokens per campaign | ERC-20 | Implemented |
| 2 | EVM – Vault shares with on-chain yield | ERC-4626 | Implemented |
| 3 | EVM – Tier-based campaigns | ERC-1155 | Implemented |
| 4 | Solana – SPL Token (classic) | SPL | Implemented |
| 5 | Solana – Token-2022 (SPL extensions) | Token-2022 | Implemented |

## Repository Structure

```
contracts/evm/        – Solidity contracts (V1/V2/V3) + Hardhat tests and deploy scripts
contracts/solana/     – Anchor programs (V4 crowdfunding, V5 crowdfunding_token2022) + tests
clients/python/       – Python + web3.py / anchorpy CLI client (EVM and Solana)
clients/ts/           – TypeScript + viem / Anchor TS lifecycle scripts (EVM and Solana)
clients/dotnet/       – C# + Nethereum / Solnet client
benchmarks/           – Benchmark orchestration (imports clients/python/); results in benchmarks/results/
dashboard/            – Next.js 14 web app for visualising and triggering benchmark runs
docs/                 – Architecture, measurements, security, and scope documentation
```

## Integration Clients

| Client | Stack | Purpose |
|--------|-------|---------|
| `clients/python/` | Python + web3.py / anchorpy | Python CLI client (EVM and Solana lifecycle) |
| `clients/ts/` | TypeScript + viem / Anchor TS | EVM and Solana lifecycle scripts |
| `clients/dotnet/` | C# + Nethereum / Solnet | .NET integration layer |
| `benchmarks/` | Python (imports `clients/python/`) | Benchmark orchestration and metric collection |
| `dashboard/` | Next.js 14 + Recharts | Benchmark visualisation and live run triggering |

## Metrics

**Quantitative:**
- Transaction cost (gas / network fees)
- Transaction confirmation / finality time
- Throughput: 50 sequential contributions — total time and TPS

**Qualitative (Developer Experience):**
- Lines of code (LOC) per implementation
- Setup and configuration steps
- Time to first successful transaction
- Typing quality and boilerplate availability

## Quick Start

### EVM (all three variants)

```bash
cd contracts/evm
npm install
npx hardhat compile                                    # compile V1, V2, V3 contracts
npx hardhat test                                       # run all 77 tests
npx hardhat run scripts/deploy.ts                      # deploy all variants locally
```

### Solana (V4 SPL + V5 Token-2022)

```bash
cd contracts/solana
npm install
anchor build
anchor test
```

### Python Client

```bash
cd clients/python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../..

# Standalone operations (from repo root)
python -m clients.python evm:deploy --variant V1
python -m clients.python evm:contribute --amount 10000000
python -m clients.python sol:contribute --amount 10000000
python -m clients.python evm:status
```

### Python Benchmarks

Result files are written to `benchmarks/results/` as
`{VARIANT}_{CLIENT}_{ENV}_{KIND}_{TIMESTAMP}.json` (e.g. `V1_python_hardhat-localnet_lifecycle_1774369893.json`).
Multiple runs accumulate; the dashboard picks the latest per combination.

```bash
# Start Hardhat node in a separate terminal: cd contracts/evm && npx hardhat node
VARIANT=V1 python benchmarks/run_tests.py --platform evm
VARIANT=V2 python benchmarks/run_tests.py --platform evm
VARIANT=V3 python benchmarks/run_tests.py --platform evm

# Throughput benchmark (timed contribution phase only)
VARIANT=V1 python benchmarks/throughput_test.py --platform evm

# Start solana-test-validator + anchor deploy first
VARIANT=V4 python benchmarks/run_tests.py --platform solana
VARIANT=V5 python benchmarks/run_tests.py --platform solana

# Subprocess-driven client benchmark (used internally by the dashboard run panel)
python benchmarks/run_client_benchmark.py \
    --platform evm --client python --variant V1 --env hardhat-localnet

python benchmarks/collect_metrics.py    # print cross-variant comparison table
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev        # open http://localhost:3000
```

<img width="1917" height="917" alt="image" src="https://github.com/user-attachments/assets/a0773a0a-8a00-411b-8854-790c6ea9c3ff" />


## Documentation

| File | Contents |
|------|---------|
| `docs/setup.md` | Quick start guide + full environment setup, toolchain versions, benchmark scripts reference |
| `docs/architecture.md` | Contract state machine, storage layouts, PDA design, decision log |
| `docs/measurements.md` | Benchmark results ledger (M-V1-1, M-V4-1, …) |
| `docs/scope.md` | Thesis scope, variant definitions, assumption tracking |

## References

- Wood, G. (2014). *Ethereum: A secure decentralised generalised transaction ledger.*
- Buterin, V. (2013). *Ethereum Whitepaper.*
- Antonopoulos, A. & Wood, G. (2018). *Mastering Ethereum.* O'Reilly.
- Lamport, L., Shostak, R., & Pease, M. (1982). The Byzantine Generals Problem. *ACM TOPLAS.*
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/)
- [Anchor Framework](https://book.anchor-lang.com/)
- [SPL Token Program](https://spl.solana.com/token)
- [ERC Standards](https://eips.ethereum.org/erc)
