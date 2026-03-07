# Measurements

This document records quantitative performance measurements collected during the implementation
and evaluation of the multi-chain crowdfunding smart contracts. Results are organized by
implementation variant and execution environment. All raw figures are reported first; derived
metrics and cross-chain comparisons are deferred to the analysis chapter of the thesis.

---

## Notation

| Symbol | Meaning |
|--------|---------|
| `N` | Number of sequential contributions in the benchmark run |
| `G_avg` | Arithmetic mean gas consumed across all N transactions |
| `G_min` | Minimum gas consumed in a single transaction |
| `G_max` | Maximum gas consumed in a single transaction |
| `G_total` | Sum of gas consumed across all N transactions |
| [fact] | Directly measured or compiler-verified |
| [assumption] | Reasonable inference; should be verified before thesis submission |
| [note] | Contextual remark |

---

## V1 — EVM / ERC-20 Receipt Token (MVP)

### M-V1-1 · Local Hardhat Network — Gas Benchmark

**Date:** 2026-03-07
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.20
**Optimizer:** enabled, 200 runs
**Toolchain:** `@nomicfoundation/hardhat-toolbox` (Hardhat local network)
**Script:** `contracts/evm/scripts/benchmark.ts`

#### Scenario Parameters

| Parameter | Value |
|-----------|-------|
| Payment token | MockERC20 ("Mock USDC", 6 decimals) |
| Contribution per contributor | 10 USDC (10,000,000 raw units) |
| `softCap` | 100 USDC |
| `hardCap` | 500 USDC |
| Milestone schedule | [30%, 30%, 40%] |
| Contributors (`N`) | 50 (sequential, distinct EOAs) |
| Deadline | 30 days (advanced via `evm_increaseTime`) |

#### 4.1 `contribute()` — Sequential Gas Consumption (N = 50)

| Metric | Gas Units |
|--------|----------:|
| `G_avg` | 103,257 |
| `G_min` | 102,231 |
| `G_max` | 153,531 |
| `G_total` | 5,162,850 |

**Observation — cold vs. warm SSTORE spread [assumption]:**
The maximum (153,531 gas) occurs on the first contribution and is approximately 51,300 gas
higher than the minimum. This spread is consistent with EIP-2929 cold-storage penalties: the
first `contribute()` call writes `totalRaised` and the ERC-20 receipt-token `totalSupply` to
storage slots whose value transitions from zero to non-zero (SSTORE zero→nonzero costs 20,000
gas per slot). All subsequent transactions write `totalRaised` and `totalSupply` from
non-zero to non-zero (5,000 gas per slot), yielding a saving of approximately 30,000 gas per
transaction. Each call also writes to a fresh `contributions[msg.sender]` slot (zero→nonzero,
20,000 gas) and mints receipt tokens to a fresh recipient balance (zero→nonzero, 20,000 gas),
which are invariant across contributors and therefore do not contribute to the min/max spread.
The narrow band between `G_min` and `G_avg` (1,026 gas) indicates that contributions 2–50 are
highly uniform in cost. [assumption — to be confirmed against per-transaction gas trace]

#### 4.2 `finalize()` — Gas Consumption

| Metric | Gas Units |
|--------|----------:|
| Gas used | 47,050 |

**Observation:** `finalize()` is permissionless and callable by any account after the deadline.
Its cost is fixed for a given milestone configuration: it writes `finalized = true`,
evaluates `totalRaised >= softCap` to set `success`, and emits the `Finalized` event. No token
transfers occur at this stage, which explains the comparatively low gas cost.

#### 4.3 `withdrawMilestone()` — Per-Milestone Gas Consumption

| Index | Allocation | Gas Units | Delta vs. Previous |
|------:|----------:|----------:|-------------------:|
| 0 | 30 % | 93,125 | — |
| 1 | 30 % | 58,975 | −34,150 |
| 2 | 40 % | 50,459 | −8,516 |

**Observation — descending cost pattern [assumption]:**
The significant drop from milestone 0 (93,125 gas) to milestone 1 (58,975 gas) is consistent
with two cold-to-warm SSTORE transitions that occur only once: (a) `currentMilestone`
increments from zero to one on the first withdrawal (zero→nonzero, 20,000 gas), becoming
non-zero on all subsequent calls (non-zero→non-zero, 5,000 gas); and (b) the creator's
ERC-20 payment-token balance is zero before the first transfer and non-zero thereafter,
incurring the same penalty. Together these account for approximately 30,000 gas, consistent
with the observed 34,150 gas drop.
The smaller reduction from milestone 1 to milestone 2 (8,516 gas) is consistent with the
balance-sweep path used on the final milestone (transferring `balanceOf(address(this))` rather
than a computed percentage), which avoids one arithmetic operation and its associated
storage reads, and may benefit from an ERC-20 allowance or balance slot already being warm
from the previous transaction's access list. [assumption]

---

### M-V1-2 · Sepolia Testnet — Gas Benchmark

> **Status: pending.**
> Testnet deployment configuration is in place (`contracts/evm/.env.example`,
> `hardhat.config.ts` `sepolia` network entry). Measurements will be recorded here after the
> first successful Sepolia deployment and benchmark run. Expected additional columns:
> `gasPrice (gwei)`, `cost (ETH)`, `cost (USD at time of measurement)`,
> `block confirmation latency (s)`.

---

## V4 — Solana / SPL + Token-2022

> **Status: pending.**
> Anchor program implementation is in progress. Measurements will be recorded here after the
> first successful `anchor test` run on localnet and devnet.
> Expected metrics: compute units per instruction, lamport fee per transaction,
> finality time (slot confirmation), and throughput (TPS over 50 sequential contributions).

---

## Cross-Chain Comparison Table

> **Status: pending** — will be populated once both V1 (Sepolia) and V4 (devnet) baselines
> are available.

| Metric | V1 EVM / Sepolia | V4 Solana / devnet |
|--------|-----------------|-------------------|
| `contribute()` avg cost (USD) | — | — |
| `finalize()` cost (USD) | — | — |
| `withdrawMilestone()` avg cost (USD) | — | — |
| Finality time (s) | — | — |
| Throughput — 50 contributions total time (s) | — | — |
| Throughput (TPS) | — | — |

---

## Methodology Notes

1. **Local vs. testnet gas units.** Gas unit counts measured on the Hardhat local network are
   deterministic and independent of network congestion. They represent a lower bound on
   computational cost and are suitable for algorithmic comparison. Fiat-denominated cost
   estimates require testnet (or mainnet) runs with a known gas price at the time of
   measurement.

2. **Sequential throughput.** The benchmark script submits contributions one at a time and
   awaits each receipt before submitting the next. This measures worst-case sequential
   latency, not parallelized throughput. The 50-transaction total (5,162,850 gas) fits within
   a single Ethereum block's gas limit (~30,000,000 gas on mainnet at the time of writing),
   meaning all 50 could theoretically be included in one block if submitted simultaneously.
   The sequential methodology is chosen to ensure reproducibility and to match the Solana
   benchmark scenario for a controlled comparison.

3. **Mock token.** The ERC-20 payment token used in this benchmark is `MockERC20`, which
   implements a public `mint()` function absent from production tokens. Its transfer and
   approval gas costs are representative of a standard ERC-20 implementation (no hooks, no
   permit). Any deviation from a real token's gas profile should be noted when reporting
   testnet results.

4. **Optimizer settings.** The Solidity compiler was run with the optimizer enabled at 200
   runs. This setting optimizes for execution cost over deployment cost and is the standard
   choice for contracts expected to be called frequently. Deployment gas costs are not
   reported in this benchmark run but should be recorded for the testnet comparison.
