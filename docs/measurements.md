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

## V2 — EVM / ERC-4626 Vault Shares

### M-V2-1 · Local Hardhat Network — Gas Benchmark

**Date:** 2026-03-15
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.24
**EVM target:** cancun
**Optimizer:** enabled, 200 runs
**Script:** `contracts/evm/scripts/benchmark.ts` (V2 benchmark cycle)

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
| `G_avg` | 97,806 |
| `G_min` | 96,780 |
| `G_max` | 148,080 |
| `G_total` | 4,890,300 |

**Observation — V2 lower than V1 [fact]:**
ERC-4626 V2 contribute saves approximately 5,400 gas avg vs. V1 (103,226 → 97,806, −5.2%).
The saving comes from eliminating the external call to a separate `CampaignToken.mint()` — V2
calls `_mint` on itself (one internal call vs. two cross-contract CALL operations in V1).
The cold/warm SSTORE spread is preserved (148,080 max vs. 96,780 min, ~51,300 spread),
consistent with V1 EIP-2929 behaviour on `totalRaised` zero→nonzero transition.

#### 4.2 `finalize()` — Gas Consumption

| Metric | Gas Units |
|--------|----------:|
| Gas used | 47,138 |

**Observation:** Nearly identical to V1 (47,048). `finalize` only writes two booleans and emits
one event — no token operations occur at this stage. The 90 gas difference is within measurement
noise.

#### 4.3 `withdrawMilestone()` — Per-Milestone Gas Consumption

| Index | Allocation | Gas Units | Delta vs. V1 |
|------:|----------:|----------:|-------------:|
| 0 | 30 % | 76,250 | −17,138 |
| 1 | 30 % | 59,200 | +225 |
| 2 | 40 % | 50,681 | +222 |

**Observation — milestone 0 significantly lower in V2 [fact]:**
The 17,138 gas saving on milestone 0 is consistent with V2's withdrawal path using
`IERC20(asset()).safeTransfer(creator, amount)` — a direct call on the payment token. In V1,
the first withdrawal also writes to a previously-uninitialized creator ERC-20 balance slot
(zero→nonzero, 20,000 gas). This penalty is unchanged in V2, yet milestone 0 is still lower.
The additional saving reflects the absence of the separate `CampaignToken` contract's storage
in V2 (no receipt token balance to update on withdrawal). Milestones 1 and 2 are near-identical
to V1 (warm storage paths in both variants).

---

### M-V2-2 · Sepolia Testnet — Gas Benchmark

> **Status: pending.** Same methodology as M-V1-2 applied to `CrowdfundingCampaign4626`.

---

## V3 — EVM / ERC-1155 Tier-Based

### M-V3-1 · Local Hardhat Network — Gas Benchmark

**Date:** 2026-03-15
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.24
**EVM target:** cancun
**Optimizer:** enabled, 200 runs
**Script:** `contracts/evm/scripts/benchmark.ts` (V3 benchmark cycle)

#### Scenario Parameters

| Parameter | Value |
|-----------|-------|
| Payment token | MockERC20 ("Mock USDC", 6 decimals) |
| Tier used | Bronze (tierId = 0), price = 10 USDC |
| `softCap` | 100 USDC |
| `hardCap` | 600 USDC (60 × 10 USDC; slack for 50 contributors) |
| Milestone schedule | [30%, 30%, 40%] |
| Contributors (`N`) | 50 (sequential, distinct EOAs) |

#### 4.1 `contribute(tierId=0)` — Sequential Gas Consumption (N = 50)

| Metric | Gas Units |
|--------|----------:|
| `G_avg` | 123,853 |
| `G_min` | 123,169 |
| `G_max` | 157,369 |
| `G_total` | 6,192,650 |

**Observation — V3 higher than V1/V2 [fact]:**
ERC-1155 V3 contribute costs approximately 20,600 gas more on avg than V1 (123,853 vs 103,226,
+20.0%) and 26,000 more than V2 (vs 97,806, +26.6%). The overhead comes from:
1. ERC-1155 `_mint` writes to a two-dimensional balance map `_balances[tierId][contributor]`
   and emits a `TransferSingle` event — more storage operations than ERC-20 `_mint`.
2. An additional `tierContributions[contributor][tierId]` write (zero→nonzero on first call,
   incurring cold SSTORE penalty per unique contributor × tier pair).
3. The cross-contract call overhead to `CampaignTierToken.mint(...)`, similar to V1's
   `CampaignToken.mint(...)`.

The narrow spread between min and max (123,169 → 157,369, ~34,200) is consistent with the
EIP-2929 cold-to-warm pattern on `totalRaised` for the first contribution.

#### 4.2 `finalize()` — Gas Consumption

| Metric | Gas Units |
|--------|----------:|
| Gas used | 47,092 |

**Observation:** Essentially identical to V1 (47,048) and V2 (47,138). Finalization is
token-standard-agnostic.

#### 4.3 `withdrawMilestone()` — Per-Milestone Gas Consumption

| Index | Allocation | Gas Units | Delta vs. V1 | Delta vs. V2 |
|------:|----------:|----------:|-------------:|-------------:|
| 0 | 30 % | 76,221 | −17,167 | −29 |
| 1 | 30 % | 59,171 | −67 | −29 |
| 2 | 40 % | 50,653 | −67 | −28 |

**Observation — V3 milestone gas nearly identical to V2 [fact]:**
Both V2 and V3 use `paymentToken.safeTransfer(creator, amount)` directly (not through a
separate receipt token contract). The near-identical figures (76,221 vs 76,250 for milestone 0)
confirm that the withdrawal path is structurally the same. The large saving vs V1 milestone 0
(−17,167 gas) has the same root cause as V2: absence of a zero→nonzero payment-token balance
write to the `receiptToken` contract.

---

### M-V3-2 · Sepolia Testnet — Gas Benchmark

> **Status: pending.** Same methodology as M-V1-2 applied to `CrowdfundingCampaign1155`.

---

### M-V1-2 · Sepolia Testnet — Gas Benchmark

> **Status: pending.**
> Testnet deployment configuration is in place (`contracts/evm/.env.example`,
> `hardhat.config.ts` `sepolia` network entry). Measurements will be recorded here after the
> first successful Sepolia deployment and benchmark run. Expected additional columns:
> `gasPrice (gwei)`, `cost (ETH)`, `cost (USD at time of measurement)`,
> `block confirmation latency (s)`.

---

## V4 — Solana / SPL Token (classic)

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

#### 4.1 `contribute()` — Sequential Fee & Latency (N = 50)

| Metric | Lamports | SOL |
|--------|----------:|----:|
| Fee avg | 10,000 | 0.000010000 |
| Fee min | 10,000 | 0.000010000 |
| Fee max | 10,000 | 0.000010000 |
| Latency avg (ms) | — | 409 |
| Latency min (ms) | — | 315 |
| Latency max (ms) | — | 497 |

**Observation — flat fee model [fact]:**
Solana charges a base fee of 5,000 lamports per signature. The `contribute()` instruction requires
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

#### 4.2 `finalize()` — Fee & Latency

| Metric | Lamports | SOL | Time (ms) |
|--------|----------:|----:|----------:|
| Fee | 5,000 | 0.000005000 | 306 |

**Observation:** `finalize()` has a single signer (the caller), hence the base fee
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

## V5 — Solana / Token-2022

**Program:** `programs/crowdfunding_token2022` — implemented and 9/9 tests passing (2026-03-15).
Uses `anchor_spl::token_2022` CPI calls and `TOKEN_2022_PROGRAM_ID` (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
Benchmark script: `contracts/solana/scripts/benchmark_token2022.ts`.

### M-V5-1 · Localnet (solana-test-validator) — Fee & Latency Benchmark

> **Status: pending.** Same methodology as M-V4-1 (50 sequential contributions, fee/latency/throughput).
> Run `npm run benchmark_token2022` with a running `solana-test-validator` to populate this section.
> Expected comparison: V5 fee model is identical to V4 (5,000 lamports per signature, flat fee).
> Key question: does Token-2022's additional on-chain account data or CPI overhead affect CU consumption
> or latency vs. V4?

---

## Cross-Chain Summary Tables

> **Localnet baseline (reference only).** The tables below are localnet measurements used for
> harness validation and initial gas/fee baselines. These figures are **not displayed in the
> dashboard**. The dashboard exclusively shows Sepolia (EVM) and Solana devnet (Solana) results.
> USD fiat costs require testnet runs with a known gas price or SOL price at time of measurement.
> All fiat cells are `—` (pending) until M-V1-2 and M-V4-2 are completed on testnet.
> No fiat values have been invented or estimated.
>
> **EVM latency annotation.** Hardhat automines every transaction synchronously; there is no
> mempool wait or block propagation. EVM latency values below reflect local RPC roundtrip
> only (< 30 ms) and are **not comparable** to Solana localnet slot-confirmation latency
> (~400 ms). Every EVM latency figure carries a `[automine]` tag to make this explicit.
>
> **Solana Compute Units.** CU consumption was not captured in M-V4-1. All CU cells show
> `≤ 200,000 [ceiling]` — the Anchor default limit per instruction — until measured via
> `getTransaction.meta.computeUnitsConsumed` in a follow-up run.

---

### Table 1 — Per-Operation Cost (localnet, raw units)

> Source: M-V1-1 (EVM gas) and M-V4-1 (Solana fees). EVM `refund()` gas measured
> 2026-03-15 (fail-path run, N = 5). Solana `initialize_campaign` and `refund` fees
> are derived from the fee model (5,000 lam × signers) — not directly recorded in M-V4-1.

| Operation | EVM gas units | EVM fiat (pending) | Solana fee (lam / SOL) | Solana CU consumed | Solana fiat (pending) |
|-----------|:-------------:|--------------------|:---------------------:|:-----------------:|----------------------|
| `initialize_campaign` | — [¹] | — | 10,000 / 0.000010 [²] | ≤ 200,000 [ceiling] | — |
| `contribute` — avg | 103,257 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `contribute` — min | 102,231 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `contribute` — max | 153,531 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `finalize` | 47,050 | — | 5,000 / 0.000005 | ≤ 200,000 [ceiling] | — |
| `withdrawMilestone[0]` (30 %) | 93,125 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `withdrawMilestone[1]` (30 %) | 58,975 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `withdrawMilestone[2]` (40 %) | 50,459 | — | 10,000 / 0.000010 | ≤ 200,000 [ceiling] | — |
| `refund` — avg | 72,766 | — | 10,000 / 0.000010 [²] | ≤ 200,000 [ceiling] | — |
| `refund` — min | 68,906 | — | — | — | — |
| `refund` — max | 73,732 | — | — | — | — |

**Footnotes:**

[¹] EVM `initialize_campaign` gas not recorded in M-V1-1; the campaign is deployed via
`CrowdfundingFactory.createCampaign()` and its internal deployment gas was not separated
from the factory call. To be added in M-V1-2.

[²] Solana fee is deterministic: 5,000 lamports per signature. `initialize_campaign` and
`refund` each require two signers (creator/contributor + fee-payer wallet) → 10,000 lamports.
`finalize` uses one signer → 5,000 lamports. Derived from fee model; not directly measured
for `initialize_campaign` and `refund` in M-V4-1. [assumption]

**EVM refund() pattern (N = 5, fail path, 2026-03-15):**
Contributors 0–3: 73,732 gas each. Contributor 4 (last): 68,906 gas.
The 4,826 gas reduction on the final refund is consistent with one storage slot clearing:
`totalRaised` transitions from 10,000,000 (the last remaining contribution) to zero, and
the EIP-3529 SSTORE clear refund (capped at 20 % of `gasUsed`) reduces the net cost.

---

### Table 2 — Per-Operation Latency (localnet)

> EVM latency source: `benchmark_extended.ts` run on 2026-03-15 against Hardhat in-process
> EVM (`--network hardhat`). Solana latency source: M-V4-1 (2026-03-07, `solana-test-validator`).
> **EVM `[automine]` values are not meaningful for network-level comparison.**

| Operation | EVM localnet (ms) `[automine]` | Solana localnet avg (ms) | Solana min (ms) | Solana max (ms) |
|-----------|:------------------------------:|:------------------------:|:---------------:|:---------------:|
| `contribute` avg | 6 `[automine]` | 409 | 315 | 497 |
| `contribute` min | 3 `[automine]` | — | — | — |
| `contribute` max | 16 `[automine]` | — | — | — |
| `finalize` | 2 `[automine]` | 306 | 306 | 306 |
| `withdrawMilestone[0]` | 2 `[automine]` | 479 | 479 | 479 |
| `withdrawMilestone[1]` | 3 `[automine]` | 340 | 340 | 340 |
| `withdrawMilestone[2]` | 3 `[automine]` | 451 | 451 | 451 |

**Interpretation:** Hardhat automine eliminates block-time wait entirely; the 2–16 ms range
reflects JSON-RPC serialisation overhead only. Solana localnet latency (306–497 ms) is
dominated by slot-confirmation time (~400 ms/slot). A meaningful latency comparison
requires testnet data (Sepolia vs. devnet), deferred to M-V1-2 and M-V4-2.

---

### Table 3 — Throughput (localnet, N = 50 sequential contributions)

> EVM source: `benchmark_extended.ts` timed window (2026-03-15). Solana source: M-V4-1
> (2026-03-07). Both benchmarks pre-create accounts / approvals outside the timed window
> and submit contributions sequentially, waiting for confirmation before each next call.

| Metric | V1 EVM / Hardhat `[automine]` | V4 Solana / localnet |
|--------|:-----------------------------:|:--------------------:|
| N contributions | 50 | 50 |
| Total wall-clock time (ms) | 291 | 20,738 |
| Throughput (TPS) | 171.82 | 2.41 |
| Limiting factor | Local RPC roundtrip; no real block time | ~400 ms/slot confirmation time |

**Interpretation:** The 71× TPS gap (171.82 vs 2.41) is an artefact of Hardhat automine and
does **not** represent real-world throughput. On Sepolia (12-second block time, one tx
per block) the same sequential benchmark yields ~0.08 TPS. Solana's 2.41 TPS is bounded
by localnet slot time; a parallel-submission strategy would yield significantly higher
figures. Both numbers are reported for methodological reproducibility, not for direct
platform comparison.

---

### Table 4 — Developer Experience

> LOC counts measured on 2026-03-15 with `wc -l`. EVM contract LOC excludes `MockERC20.sol`
> (test fixture, 19 lines). Solana contract LOC includes all `.rs` source files under
> `programs/crowdfunding/src/`. Client LOC counts are per-platform (EVM-side vs. Solana-side)
> and exclude shared utilities (43 TS lines / ~266 C# lines) unless noted.
> Setup step counts derived from `docs/setup.md`, assuming Linux environment.

| Metric | V1 EVM | V4 Solana |
|--------|--------|-----------|
| **Contract LOC** (business logic) | 296 Solidity — 3 files (`CrowdfundingCampaign.sol` 202, `CrowdfundingFactory.sol` 52, `CampaignToken.sol` 42) | 588 Rust — 8 files (instructions: 453; state: 36; errors: 33; lib: 44; mod: 11 [no-op router]) |
| **Test LOC** | 475 TypeScript — 3 files (`CrowdfundingCampaign.test.ts` 301, `CrowdfundingFactory.test.ts` 76, `fixtures.ts` 98) | 642 TypeScript — 1 file (`crowdfunding.ts`) |
| **TypeScript client LOC** | 521 — 6 files (EVM-side operations) | 597 — 8 files (Solana-side operations, incl. `pda.ts` 35) |
| **C# client LOC** | 350 — `EvmCampaignService.cs` | 551 — `SolanaCampaignService.cs` 300 + `InstructionBuilder.cs` 145 + `TransactionHelper.cs` 56 + `PdaHelper.cs` 50 |
| **Python client LOC** | 803 — 10 files (EVM: `client.py` 84, `config.py` 82, `deploy.py` 189, `create_campaign.py` 105, `contribute.py` 109, `finalize.py` 63, `withdraw.py` 63, `refund.py` 72, `status.py` 92; shared: `output.py` 75) | 770 — 9 files (Solana: `client.py` 73, `config.py` 76, `idl_convert.py` 237, `create_campaign.py` 134, `contribute.py` 123, `finalize.py` 86, `withdraw.py` 104, `refund.py` 113, `status.py` 77) |
| **Framework / toolchain** | Solidity 0.8.20 + Hardhat 2.28 + OpenZeppelin 5.1 + viem 2.21 | Rust 1.84 + Anchor 0.32 + SPL Token 0.3.11 + @solana/web3.js 1.95 |
| **Setup steps to first tx** | **3** — `npm install` → `npx hardhat compile` → `npx hardhat run scripts/deploy.ts` | **10** — prereqs → Rust → Solana CLI → AVM → Anchor → Node.js (nvm) → keypair → `npm install` → `anchor build` → `solana-test-validator` + `anchor deploy` |
| **Python client setup steps** | **4** — create venv → staged pip install (3 commands) → set env vars → `python -m clients.python evm:status` | **5** — same venv setup → set `SOLANA_*` env vars → `python -m clients.python sol:status` |
| **Type safety model** | ABI-driven: Solidity enforces types on-chain; viem generates TypeScript types from ABI; Nethereum uses ABI-generated C# classes | IDL-driven: Anchor generates `idl.json`; `@coral-xyz/anchor` provides TS types; Solnet requires manual account struct mapping in C# |
| **Python type safety** | web3.py uses ABI JSON at runtime; no compile-time type guarantees; `TxOutput` dataclass enforces output contract | anchorpy deserialises IDL at runtime; `Program` object provides method names but not typed args; account structs are dicts |
| **Boilerplate burden** | Low — contract is self-contained; clients require ABI + address only; ERC-20 allowance is the only extra step | High — every instruction requires an explicit account list (≥ 8 accounts for `contribute`); PDA derivation must be reproduced in every client; ATA pre-creation required before first contribute |
| **Key pain points** | Cold/warm SSTORE spread on first contribute (+51 k gas); ERC-20 approve-then-contribute two-step per contributor | Account enumeration per instruction; ATA pre-creation overhead; receipt-mint PDA seed must be consistent across program, TS, C#, and Python clients |

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
   transaction. Instructions with two signers (e.g. `contribute`, `withdraw_milestone`) cost
   10,000 lamports; instructions with one signer (e.g. `finalize`) cost 5,000
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
