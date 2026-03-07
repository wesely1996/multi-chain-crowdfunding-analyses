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

### M-V4-1 · Localnet (solana-test-validator) — Fee & Latency Benchmark

**Date:** 2026-03-07
**Environment:** `solana-test-validator` (local, `--reset`; Unix socket from WSL `~` home)
**Anchor version:** `@coral-xyz/anchor` 0.32.1
**Solana web3.js:** `@solana/web3.js` 1.95.4
**SPL Token:** `@solana/spl-token` 0.3.11
**Script:** `contracts/solana/scripts/benchmark.ts`

#### Scenario Parameters

| Parameter | Value |
|-----------|-------|
| Payment token | SPL mint (6 decimals, localnet) |
| Contribution per contributor | 10 USDC-equivalent (10,000,000 raw units) |
| `soft_cap` | 100 USDC-equivalent |
| `hard_cap` | 500 USDC-equivalent |
| Milestone schedule | [30%, 30%, 40%] |
| Contributors (`N`) | 50 (sequential, distinct keypairs) |
| Deadline | 5-second fast campaign (finalize/withdraw sub-benchmark) |
| Priority fees | None set (base fee only) |

#### 4.1 `fund()` — Sequential Fee & Latency (N = 50)

| Metric | Lamports | SOL |
|--------|----------:|----:|
| Fee avg | 10,000 | 0.000010000 |
| Fee min | 10,000 | 0.000010000 |
| Fee max | 10,000 | 0.000010000 |
| Latency avg (ms) | — | 409 |
| Latency min (ms) | — | 315 |
| Latency max (ms) | — | 497 |

**Observation — flat fee model [fact]:**
Solana charges a base fee of 5,000 lamports per signature. The `fund()` instruction requires
two signers (payer + contributor), yielding a deterministic 10,000 lamports per transaction
regardless of instruction complexity. There is no analogue to EVM gas units; computational
cost is measured separately in Compute Units (CUs) and capped at 200,000 CU/instruction by
default. CU consumption was not recorded in this benchmark run and should be added in a
follow-up using `ComputeBudgetProgram.setComputeUnitLimit`.

**Observation — latency spread [assumption]:**
The 315–497 ms range on localnet reflects round-trip RPC latency to the local validator
plus slot-confirmation time (localnet slots advance at ~400 ms). The spread is not caused by
fee variability (fees are flat) but by slot-boundary timing: a transaction landing early in
a slot confirms faster than one submitted just after a slot boundary. This variance is
expected to be higher on devnet (variable congestion) and should be re-measured there.

#### 4.2 `finalize_campaign()` — Fee & Latency

| Metric | Lamports | SOL | Time (ms) |
|--------|----------:|----:|----------:|
| Fee | 5,000 | 0.000005000 | 306 |

**Observation:** `finalize_campaign()` has a single signer (the caller), hence the base fee
is 5,000 lamports (one signature). This is the only instruction in the benchmark that costs
half the contribution fee, consistent with the single-signer design in the Anchor program.

#### 4.3 `withdraw_milestone()` — Per-Milestone Fee & Latency

| Index | Allocation | Fee (lamports) | SOL | Time (ms) |
|------:|----------:|---------------:|----:|----------:|
| 0 | 30 % | 10,000 | 0.000010000 | 479 |
| 1 | 30 % | 10,000 | 0.000010000 | 340 |
| 2 | 40 % | 10,000 | 0.000010000 | 451 |

**Observation — uniform fee, variable latency [fact]:**
Unlike EVM `withdrawMilestone()`, which showed a strong descending gas cost pattern driven
by cold-to-warm SSTORE transitions, Solana fees are slot-count-independent: all three
milestone withdrawals cost exactly 10,000 lamports (two signers: creator + program).
The latency variation (340–479 ms) is attributable to slot-boundary timing, not instruction
complexity. The absence of a cost gradient across milestones is a structurally significant
cross-chain difference: Solana's account model pre-allocates storage at account creation
(rent-exempt deposit), so there is no zero-to-nonzero write penalty at instruction time.

#### 4.4 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time | 20,738 ms |
| Throughput (TPS) | 2.41 |

**Observation — sequential throughput [note]:**
The 2.41 TPS figure reflects a worst-case sequential benchmark: each contribution is
submitted and confirmed before the next is issued. Localnet slot time (~400 ms) is the
dominant factor; on devnet the per-transaction latency is typically higher (500–1,500 ms)
but the sequential TPS methodology is identical to the EVM benchmark for controlled
comparison. Parallel submission (e.g. pipelining without confirmation) would yield
substantially higher throughput but is out of scope for this controlled comparison.

---

### M-V4-2 · Devnet — Fee & Latency Benchmark

> **Status: pending.**
> Expected additional columns: `slot confirmation latency (s)`, `prioritization fee (lamports)`,
> `cost (USD at time of measurement)`, `CU consumed per instruction`.

---

## Cross-Chain Comparison Table

> **Localnet baseline** — USD costs require testnet runs with known gas/SOL prices at time of
> measurement. Fiat columns will be populated in M-V1-2 (Sepolia) and M-V4-2 (devnet).
> EVM latency was not recorded in M-V1-1 (gas-only run); devnet latency for V4 is pending.

### Raw-unit comparison (localnet)

| Metric | V1 EVM / Hardhat localnet | V4 Solana / localnet |
|--------|--------------------------|---------------------|
| `contribute()` avg cost | 103,257 gas | 10,000 lamports (0.00001 SOL) |
| `contribute()` cost spread (min→max) | 102,231 → 153,531 gas | 10,000 → 10,000 lamports (flat) |
| `finalize()` cost | 47,050 gas | 5,000 lamports (0.000005 SOL) |
| `withdrawMilestone()` — index 0 | 93,125 gas | 10,000 lamports |
| `withdrawMilestone()` — index 1 | 58,975 gas | 10,000 lamports |
| `withdrawMilestone()` — index 2 | 50,459 gas | 10,000 lamports |
| `contribute()` avg latency (ms) | — (not recorded) | 409 |
| Throughput — 50 contributions total (ms) | — (not recorded) | 20,738 |
| Throughput (TPS) | — (not recorded) | 2.41 |

### Fiat-cost comparison (testnet) — pending

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

5. **Solana fee model.** Solana charges a base fee of 5,000 lamports per signature per
   transaction. Instructions with two signers (e.g. `fund`, `withdraw_milestone`) cost
   10,000 lamports; instructions with one signer (e.g. `finalize_campaign`) cost 5,000
   lamports. There is no per-instruction gas metering analogous to EVM gas units. Compute
   Unit (CU) consumption is a separate resource limit (default 200,000 CU/instruction) and
   was not recorded in this benchmark run. Priority fees (`ComputeBudgetProgram`) were not
   set, so all fees represent the minimum base cost. CU consumption and priority-fee
   sensitivity should be measured in the devnet run.

6. **Solana rent-exempt deposits.** Account creation on Solana requires a one-time
   rent-exempt SOL deposit (e.g. ~0.002 SOL for a 128-byte PDA account). These deposits
   are not transaction fees and are recoverable on account closure. They are excluded from
   the per-instruction fee figures above but should be reported as part of the total
   deployment cost in the devnet comparison.
