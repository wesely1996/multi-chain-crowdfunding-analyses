# Multi-Chain Crowdfunding Smart Contract

**Master's Thesis** — Department of Information Technology
**Student:** Nikola Veselinović (53m/24)
**Supervisor:** Prof. dr Lidija Foror

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
| 1 | EVM – Receipt tokens per campaign | ERC-20 | MVP |
| 2 | EVM – Vault shares with on-chain yield | ERC-4626 | Planned |
| 3 | EVM – Tier-based campaigns | ERC-1155 | Planned |
| 4 | Solana – SPL Token (classic) | SPL | MVP |
| 5 | Solana – Token-2022 (SPL extensions) | Token-2022 | Planned |

## Repository Structure

```
contracts/evm/        – Solidity contracts + Hardhat/Foundry tests and deploy scripts
contracts/solana/     – Anchor program (programs/crowdfunding/) + tests
clients/ts-evm/       – TypeScript + viem client helpers
clients/dotnet/       – C# + Nethereum client
benchmarks/           – Python + web3.py benchmark harness; results in results/
docs/                 – Architecture, measurements, security, and scope documentation
```

## Integration Clients

| Client | Stack | Purpose |
|--------|-------|---------|
| `clients/ts-evm/` | TypeScript + viem | Primary EVM interaction |
| `clients/dotnet/` | C# + Nethereum | .NET integration layer |
| `benchmarks/` | Python + web3.py | Automated benchmarking and metric collection |
| `contracts/solana/` | TypeScript + Anchor | Solana program deployment and testing |

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

### EVM

```bash
cd contracts/evm
npx hardhat compile        # or: forge build
npx hardhat test           # or: forge test
ts-node scripts/deploy.ts
```

### Solana

```bash
cd contracts/solana
anchor build
anchor test
```

### Benchmarks

```bash
python benchmarks/run_tests.py
python benchmarks/throughput_test.py
python benchmarks/collect_metrics.py
```

## References

- Wood, G. (2014). *Ethereum: A secure decentralised generalised transaction ledger.*
- Buterin, V. (2013). *Ethereum Whitepaper.*
- Antonopoulos, A. & Wood, G. (2018). *Mastering Ethereum.* O'Reilly.
- Lamport, L., Shostak, R., & Pease, M. (1982). The Byzantine Generals Problem. *ACM TOPLAS.*
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/)
- [Anchor Framework](https://book.anchor-lang.com/)
- [SPL Token Program](https://spl.solana.com/token)
- [ERC Standards](https://eips.ethereum.org/erc)
