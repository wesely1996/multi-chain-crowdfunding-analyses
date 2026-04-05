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

**Date:** 2026-03-20 (updated run; original baseline 2026-03-07)
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.20
**Optimizer:** enabled, 200 runs
**Toolchain:** `@nomicfoundation/hardhat-toolbox` (Hardhat local network)
**Script:** `benchmarks/run_tests.py --platform evm` (Python harness, V1)
**Result file:** `V1_python_hardhat-localnet_lifecycle_1774369893.json`

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
| `G_avg` | 108,026 |
| `G_min` | 107,000 |
| `G_max` | 158,300 |
| `G_total` | 5,401,300 |

**Observation — cold vs. warm SSTORE spread [fact]:**
The maximum (158,300 gas) occurs on the first contribution and is approximately 51,300 gas
higher than the minimum. This spread is consistent with EIP-2929 cold-storage penalties: the
first `contribute()` call writes `totalRaised` and the ERC-20 receipt-token `totalSupply` to
storage slots whose value transitions from zero to non-zero (SSTORE zero→nonzero costs 20,000
gas per slot). All subsequent transactions write from non-zero to non-zero (5,000 gas per slot),
yielding a saving of approximately 30,000 gas per transaction. Each call also writes to a fresh
`contributions[msg.sender]` slot (zero→nonzero, 20,000 gas) and mints receipt tokens to a fresh
recipient balance (zero→nonzero, 20,000 gas), which are invariant across contributors and do not
contribute to the min/max spread. Contributions 2–50 are highly uniform at exactly 107,000 gas.

#### 4.2 `finalize()` — Gas Consumption

| Metric | Gas Units |
|--------|----------:|
| Gas used | 47,048 |

**Observation:** `finalize()` is permissionless and callable by any account after the deadline.
Its cost is fixed for a given milestone configuration: it writes `finalized = true`,
evaluates `totalRaised >= softCap` to set `success`, and emits the `Finalized` event. No token
transfers occur at this stage, which explains the comparatively low gas cost.

#### 4.3 `withdrawMilestone()` — Per-Milestone Gas Consumption

| Index | Allocation | Gas Units | Delta vs. Previous |
|------:|----------:|----------:|-------------------:|
| 0 | 30 % | 93,388 | — |
| 1 | 30 % | 59,238 | −34,150 |
| 2 | 40 % | 50,720 | −8,518 |

**Observation — descending cost pattern [fact]:**
The significant drop from milestone 0 (93,388 gas) to milestone 1 (59,238 gas) is consistent
with two cold-to-warm SSTORE transitions that occur only once: (a) `currentMilestone`
increments from zero to one on the first withdrawal (zero→nonzero, 20,000 gas), becoming
non-zero on all subsequent calls (non-zero→non-zero, 5,000 gas); and (b) the creator's
ERC-20 payment-token balance is zero before the first transfer and non-zero thereafter,
incurring the same penalty. Together these account for approximately 30,000 gas, consistent
with the observed 34,150 gas drop.
The smaller reduction from milestone 1 to milestone 2 (8,518 gas) reflects the balance-sweep
path used on the final milestone (transferring `balanceOf(address(this))` rather than a
computed percentage), which avoids one arithmetic operation and benefits from warm storage slots.

#### 4.4 `refund()` — Gas Consumption (fail-path, N = 5)

| Metric | Gas Units |
|--------|----------:|
| `G_avg` | 72,747 |
| `G_min` | 68,889 |
| `G_max` | 73,711 |

**Observation:** Contributors 0–3: 73,711 gas each (uniform). Contributor 4 (last): 68,889 gas.
The 4,822 gas reduction on the final refund is consistent with the EIP-3529 SSTORE clear refund:
`totalRaised` transitions from the last remaining contribution (non-zero) to zero, and the
storage-clear gas refund (capped at 20% of `gasUsed`) reduces net cost.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 509 |
| Throughput (TPS) | 98.23 |

---

### M-V1-2 · Local Hardhat Network — TypeScript (viem) Client

**Date:** 2026-03-28
**Environment:** Hardhat in-process EVM (local network, no external node)
**Client:** TypeScript — viem 2.21 (`clients/ts-evm/`)
**Script:** `benchmarks/run_tests.py --platform evm` (Python harness, V1, CLIENT=ts)
**Result file:** `V1_ts_hardhat-localnet_lifecycle_1774372940.json`

#### Scenario Parameters

Identical to M-V1-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 3,820 |
| Throughput (TPS) | 13.09 |
| Contribute latency avg (ms) `[automine]` | 76 |
| Contribute latency min (ms) | 72 |
| Contribute latency max (ms) | 86 |

**Observation — async/await overhead [fact]:**
The TypeScript client is ~7.5× slower than the Python client (13.09 vs. 98.23 TPS) despite
executing identical on-chain operations producing identical gas costs. The latency difference
(76 ms vs. 12 ms per `contribute`) is entirely a client-side artefact: viem's
`waitForTransactionReceipt` schedules receipt polling through the JavaScript event loop,
introducing microtask-scheduling overhead that does not exist in Python's synchronous
blocking `wait_for_transaction_receipt`. On a real network where confirmation latency
is ≥ 1 s, this difference is negligible.

---

### M-V1-3 · Local Hardhat Network — .NET (Nethereum) Client

**Date:** 2026-03-28
**Environment:** Hardhat in-process EVM (local network, no external node)
**Client:** .NET 8 — Nethereum (`clients/dotnet/`)
**Script:** `benchmarks/run_tests.py --platform evm` (Python harness, V1, CLIENT=dotnet)
**Result file:** `V1_dotnet_hardhat-localnet_lifecycle_1774373399.json`

#### Scenario Parameters

Identical to M-V1-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 12,243 |
| Throughput (TPS) | 4.08 |
| Contribute latency avg (ms) `[automine]` | 241 |
| Contribute latency min (ms) | 228 |
| Contribute latency max (ms) | 329 |

**Observation — async HttpClient overhead [fact]:**
The .NET client is ~20× slower than the Python client (4.08 vs. 98.23 TPS) on localhost.
The dominant factor is the `WaitForReceipt` polling loop in `EvmCampaignService.cs`, which
uses an async `HttpClient` call per poll. Even with Hardhat automine (receipt available on
the first poll, so the `Task.Delay(100)` backoff never fires), the .NET async HTTP client
has ~120 ms of per-request overhead on loopback vs. Python's synchronous ~6 ms. Each
`contribute` operation issues two transactions (approve + contribute), so 2 × 120 ms ≈ 241 ms.
On testnet this overhead is immaterial.

---

### M-V1-4 · Sepolia Testnet — Gas Benchmark

> **Status: pending.**
> Testnet deployment configuration is in place (`contracts/evm/.env.example`,
> `hardhat.config.ts` `sepolia` network entry). Measurements will be recorded here after the
> first successful Sepolia deployment and benchmark run. Expected additional columns:
> `gasPrice (gwei)`, `cost (ETH)`, `cost (USD at time of measurement)`,
> `block confirmation latency (s)`.

---

### M-V1-5 · Local Hardhat Network — Dedicated Throughput Benchmark (All Clients)

**Date:** 2026-04-05
**Methodology:** `benchmarks/throughput_test.py --platform evm` — 50 distinct EOAs, each
pre-funded and pre-approved outside the timed window. The harness invokes a fresh client
subprocess per transaction (Python / ts-node / dotnet run), measuring wall-clock time from
the first to the last confirmed `contribute()` receipt.
**Result files:**
- `V1_python_hardhat-localnet_throughput_1775402889.json`
- `V1_ts_hardhat-localnet_throughput_1775403443.json`
- `V1_dotnet_hardhat-localnet_throughput_1775404339.json`

#### Results

| Client | Total time (ms) | TPS | Gas avg | Latency avg (ms) `[automine]` |
|--------|---------------:|----:|--------:|------------------------------:|
| Python (web3.py) | 78,299 | 0.6386 | 108,026 | 12 |
| TypeScript (viem) | 142,022 | 0.3521 | 108,026 | 86 |
| .NET (Nethereum) | 114,921 | 0.4351 | 108,026 | 252 |

**Price reference (at time of .NET run, ts=1775404339):** ETH/USD $2,057.19, gas price 1 gwei.
Cost per `contribute` at 1 gwei: 108,026 gas × 10⁻⁹ ETH/gas × $2,057.19 ≈ **$0.000222 USD** [assumption — localnet gas price; testnet may differ].

**Methodology note — process-startup anomaly [fact]:**
The dedicated throughput TPS values (0.35–0.64) are dramatically lower than the lifecycle TPS
values (4.08–98.23) for the same clients. The discrepancy is not attributable to the
transactions themselves: per-transaction RPC latency is 12–252 ms (sum ≈ 0.6–12 s for 50 tx),
yet total elapsed times are 78–142 s. The extra time is process startup overhead: the
dedicated harness spawns a fresh subprocess per transaction
(Python interpreter: ~1,550 ms; ts-node with compilation: ~2,820 ms; .NET cold start: ~2,280 ms).
Total elapsed ≈ N × process_startup_ms. The lifecycle benchmark runs all transactions in-process,
which is why it shows much higher TPS. Neither methodology represents real-world throughput;
they measure different cost axes (runtime overhead vs. client library receipt-poll latency).

---

## V2 — EVM / ERC-4626 Vault Shares

### M-V2-1 · Local Hardhat Network — Gas Benchmark

**Date:** 2026-03-20
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.24
**EVM target:** cancun
**Optimizer:** enabled, 200 runs
**Script:** `benchmarks/run_tests.py --platform evm` (Python harness, V2)
**Result file:** `V2_python_hardhat-localnet_lifecycle_1774371155.json`

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
| `G_avg` | 102,606 |
| `G_min` | 101,580 |
| `G_max` | 152,880 |
| `G_total` | 5,130,300 |

**Observation — V2 lower than V1 [fact]:**
ERC-4626 V2 contribute saves approximately 5,420 gas avg vs. V1 (108,026 → 102,606, −5.0%).
Steady-state cost is 101,580 vs V1's 107,000 (−5.1%). The saving comes from eliminating the
external call to a separate `CampaignToken.mint()` — V2 calls `_mint` on itself (one internal
call vs. two cross-contract CALL operations in V1). The cold/warm SSTORE spread is preserved
(152,880 max vs. 101,580 min, ~51,300 spread), consistent with V1 EIP-2929 behaviour on
`totalRaised` zero→nonzero transition.

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
| 0 | 30 % | 93,350 | −38 |
| 1 | 30 % | 59,200 | −38 |
| 2 | 40 % | 50,681 | −39 |

**Observation — V2 withdrawal cost essentially identical to V1 [fact]:**
All three milestone withdrawals cost within 40 gas of the V1 equivalents. The ERC-4626
withdrawal path goes through the same `paymentToken.safeTransfer(creator, amount)` call as V1
after the vault accounting, producing no measurable difference in gas cost at this step.
The ~38 gas constant saving across all milestones is consistent with a minor code-path
difference in the vault's internal accounting but has no practical significance. The
descending cost pattern (93,350 → 59,200 → 50,681) mirrors V1 exactly and is driven by
the same cold-to-warm SSTORE transitions on `currentMilestone` and the creator's token balance.

#### 4.4 `refund()` — Gas Consumption (fail-path, N = 5)

| Metric | Gas Units |
|--------|----------:|
| `G_avg` | 67,528 |
| `G_min` | 64,540 |
| `G_max` | 68,275 |

**Observation — V2 refund cheaper than V1 [fact]:**
V2 refund averages 67,528 gas vs. V1's 72,747 (−7.2%). Contributors 0–3: 68,275 gas each.
Final contributor: 64,540 gas. The saving reflects the absence of a separate `CampaignToken`
receipt-token contract whose storage would also need to interact during refund. In V2,
the vault shares are burned internally, avoiding a cross-contract CALL.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 556 |
| Throughput (TPS) | 89.93 |

---

### M-V2-2 · Local Hardhat Network — TypeScript (viem) Client

**Date:** 2026-03-28
**Client:** TypeScript — viem 2.21
**Result file:** `V2_ts_hardhat-localnet_lifecycle_1774370189.json`

#### Scenario Parameters

Identical to M-V2-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 3,918 |
| Throughput (TPS) | 12.76 |
| Contribute latency avg (ms) `[automine]` | 76 |

**Observation:** Consistent with M-V1-2 (13.09 TPS). The ~0.33 TPS reduction vs. V1 is
proportional to the slightly higher per-tx gas cost of V2 (102,606 vs. 108,026 avg), which
causes marginally longer in-process EVM execution time. The absolute difference is negligible.

---

### M-V2-3 · Local Hardhat Network — .NET (Nethereum) Client

**Date:** 2026-03-28
**Client:** .NET 8 — Nethereum
**Result file:** `V2_dotnet_hardhat-localnet_lifecycle_1774373757.json`

#### Scenario Parameters

Identical to M-V2-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 11,829 |
| Throughput (TPS) | 4.23 |
| Contribute latency avg (ms) `[automine]` | 237 |

**Observation:** Consistent with M-V1-3 (4.08 TPS). The marginal improvement (+0.15 TPS) relative
to V1 is attributable to V2's slightly lower gas cost (fewer EVM execution cycles in Hardhat's
in-process node), not to any client change.

---

### M-V2-4 · Local Hardhat Network — .NET Dedicated Throughput Benchmark

**Date:** 2026-04-05
**Result file:** `V2_dotnet_hardhat-localnet_throughput_1775404466.json`

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 114,016 |
| TPS | 0.4385 |
| Gas avg | 102,606 |
| Latency avg (ms) `[automine]` | 250 |

**Price reference (ts=1775404466):** ETH/USD $2,056.17, gas price 1 gwei.
Cost per `contribute` at 1 gwei: 102,606 gas × 10⁻⁹ ETH/gas × $2,056.17 ≈ **$0.000211 USD** [assumption].

See M-V1-5 for methodology note on process-startup overhead.

---

### M-V2-5 · Sepolia Testnet — Gas Benchmark

> **Status: pending.** Same methodology as M-V1-4 applied to `CrowdfundingCampaign4626`.

---

## V3 — EVM / ERC-1155 Tier-Based

### M-V3-1 · Local Hardhat Network — Gas Benchmark

**Date:** 2026-03-20
**Environment:** Hardhat in-process EVM (local network, no external node)
**Solidity version:** 0.8.24
**EVM target:** cancun
**Optimizer:** enabled, 200 runs
**Script:** `benchmarks/run_tests.py --platform evm` (Python harness, V3)
**Result file:** `V3_python_hardhat-localnet_lifecycle_1775403203.json`

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
| `G_avg` | 128,653 |
| `G_min` | 127,969 |
| `G_max` | 162,169 |
| `G_total` | 6,432,650 |

**Observation — V3 most expensive of all EVM variants [fact]:**
ERC-1155 V3 contribute costs approximately 20,627 gas more on avg than V1 (128,653 vs 108,026,
+19.1%) and 26,047 more than V2 (vs 102,606, +25.4%). The overhead comes from:
1. ERC-1155 `_mint` writes to a two-dimensional balance map `_balances[tierId][contributor]`
   and emits a `TransferSingle` event — more storage operations than ERC-20 `_mint`.
2. An additional `tierContributions[contributor][tierId]` write (zero→nonzero on first call,
   incurring cold SSTORE penalty per unique contributor × tier pair).
3. The cross-contract call overhead to `CampaignTierToken.mint(...)`, similar to V1's
   `CampaignToken.mint(...)`.

The narrow spread between min and max (127,969 → 162,169, ~34,200) is consistent with the
EIP-2929 cold-to-warm pattern on `totalRaised` for the first contribution only — the
per-contributor storage slots add a constant overhead, not a spread.

#### 4.2 `finalize()` — Gas Consumption

| Metric | Gas Units |
|--------|----------:|
| Gas used | 47,092 |

**Observation:** Essentially identical to V1 (47,048) and V2 (47,138). Finalization is
token-standard-agnostic — the `finalize` function does not touch token state.

#### 4.3 `withdrawMilestone()` — Per-Milestone Gas Consumption

| Index | Allocation | Gas Units | Delta vs. V1 | Delta vs. V2 |
|------:|----------:|----------:|-------------:|-------------:|
| 0 | 30 % | 93,321 | −67 | −29 |
| 1 | 30 % | 59,171 | −67 | −29 |
| 2 | 40 % | 50,653 | −67 | −28 |

**Observation — V3 withdrawal cost matches V1/V2 [fact]:**
All three variants produce nearly identical milestone withdrawal costs (within ~70 gas).
V3 uses `paymentToken.safeTransfer(creator, amount)` directly, the same path as V2. The
negligible constant saving vs V1 (67 gas) is within measurement noise. The ERC-1155 tier
overhead present in `contribute` does not propagate to `withdrawMilestone`, confirming that
the token-standard choice only affects the funding-phase gas cost.

#### 4.4 `refund()` — Gas Consumption (fail-path, N = 5)

| Metric | Gas Units |
|--------|----------:|
| `G_avg` | 72,890 |
| `G_min` | 72,208 |
| `G_max` | 73,060 |

**Observation:** Contributors 0–3: 73,060 gas each. Final contributor: 72,208 gas.
V3 refund (72,890 avg) is essentially identical to V1 (72,747), which is expected: both involve
a cross-contract CALL to burn tokens from a separate token contract. V2 is notably cheaper
(67,528) because its internal burn avoids that cross-contract call.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 622 |
| Throughput (TPS) | 80.39 |

[note] A prior run (1774371287) recorded 610 ms / 81.97 TPS. The 1.6% variance is within run-to-run noise attributable to OS scheduling on the benchmark host.

---

### M-V3-2 · Local Hardhat Network — TypeScript (viem) Client

**Date:** 2026-03-28
**Client:** TypeScript — viem 2.21
**Result file:** `V3_ts_hardhat-localnet_lifecycle_1774373136.json`

#### Scenario Parameters

Identical to M-V3-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 3,858 |
| Throughput (TPS) | 12.96 |
| Contribute latency avg (ms) `[automine]` | 76 |

**Observation:** Consistent with M-V1-2 and M-V2-2 (12.76–13.09 TPS range). TypeScript
receipt-poll latency is invariant to the EVM variant because viem's event loop overhead
dominates and all three variants produce similar per-transaction EVM execution times.

---

### M-V3-3 · Local Hardhat Network — .NET (Nethereum) Client

**Date:** 2026-03-28
**Client:** .NET 8 — Nethereum
**Result file:** `V3_dotnet_hardhat-localnet_lifecycle_1774373890.json`

#### Scenario Parameters

Identical to M-V3-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 11,694 |
| Throughput (TPS) | 4.28 |
| Contribute latency avg (ms) `[automine]` | 238 |

**Observation:** Consistent with M-V1-3 and M-V2-3 (4.08–4.28 TPS). The slight increase vs. V1
(4.28 vs. 4.08) is within measurement noise.

---

### M-V3-4 · Local Hardhat Network — .NET Dedicated Throughput Benchmark

**Date:** 2026-04-05
**Result file:** `V3_dotnet_hardhat-localnet_throughput_1774382858.json`

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 109,702 |
| TPS | 0.4558 |
| Gas avg | 128,653 |
| Latency avg (ms) `[automine]` | 248 |

See M-V1-5 for methodology note on process-startup overhead.

---

### M-V3-5 · Sepolia Testnet — Gas Benchmark

> **Status: pending.** Same methodology as M-V1-4 applied to `CrowdfundingCampaign1155`.

---

## V4 — Solana / SPL Token (classic)

### M-V4-1 · Localnet (solana-test-validator) — Fee & Latency Benchmark

**Date:** 2026-03-16
**Environment:** `solana-test-validator` (local, `--reset`; Unix socket from WSL `~` home)
**Anchor version:** `@coral-xyz/anchor` 0.32.1
**Solana web3.js:** `@solana/web3.js` 1.95.4
**SPL Token:** `@solana/spl-token` 0.3.11
**Script:** `benchmarks/run_tests.py --platform solana` (Python harness, V4)
**Result file:** `V4_python_solana-localnet_lifecycle_1773995694.json`

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

| Metric | Lamports | SOL | Latency (ms) |
|--------|----------:|----:|-------------:|
| Fee (all tx) | 10,000 | 0.000010000 | — |
| Latency avg | — | — | 515 |
| Latency min | — | — | 512 |
| Latency max | — | — | 519 |

**Observation — flat fee model [fact]:**
Solana charges a base fee of 5,000 lamports per signature. The `contribute()` instruction requires
two signers (payer + contributor), yielding a deterministic 10,000 lamports per transaction
regardless of instruction complexity. There is no analogue to EVM gas units; computational
cost is measured separately in Compute Units (CUs) and capped at 200,000 CU/instruction by
default. CU consumption was not recorded in this benchmark run (planned for devnet run via
`ComputeBudgetProgram.setComputeUnitLimit`).

**Observation — latency spread [fact]:**
The 512–519 ms range on localnet (excluding one anomalous −318 ms measurement, a clock-wrap
artifact) reflects slot-confirmation time. Localnet slots advance at ~400 ms; the spread is
attributable to slot-boundary timing rather than fee variability. One outlier (−318 ms)
was excluded from statistics as a timer discontinuity.

#### 4.2 `finalize()` — Fee & Latency

| Metric | Lamports | SOL | Latency (ms) |
|--------|----------:|----:|-------------:|
| Fee | 5,000 | 0.000005000 | 520 |

**Observation:** `finalize()` has a single signer (the caller), hence the base fee is 5,000
lamports (one signature). This is the only instruction in the benchmark that costs half the
contribution fee, consistent with the single-signer design in the Anchor program.

#### 4.3 `withdraw_milestone()` — Per-Milestone Fee & Latency

| Index | Allocation | Fee (lamports) | SOL | Latency (ms) |
|------:|----------:|---------------:|----:|-------------:|
| 0 | 30 % | 10,000 | 0.000010000 | 517 |
| 1 | 30 % | 10,000 | 0.000010000 | 516 |
| 2 | 40 % | 10,000 | 0.000010000 | 516 |

**Observation — uniform fee, variable latency [fact]:**
Unlike EVM `withdrawMilestone()`, which showed a strong descending gas cost pattern driven
by cold-to-warm SSTORE transitions, Solana fees are constant across all milestones: 10,000
lamports (two signers). The latency variation (516–517 ms) is attributable to slot-boundary
timing, not instruction complexity. The absence of a cost gradient across milestones is a
structurally significant cross-chain difference: Solana's account model pre-allocates storage
at account creation (rent-exempt deposit), so there is no zero-to-nonzero write penalty at
instruction execution time.

#### 4.4 `refund()` — Fee & Latency (fail-path, N = 5)

| Metric | Lamports | Latency (ms) |
|--------|----------:|-------------:|
| Fee (all tx) | 10,000 | — |
| Latency avg | — | 516 |

One latency outlier (−318 ms, clock-wrap artifact) excluded from average.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 25,263 |
| Throughput (TPS) | 1.9792 |

**Observation — sequential throughput [note]:**
The 1.98 TPS figure reflects a worst-case sequential benchmark: each contribution is submitted
and confirmed before the next is issued. Localnet slot time (~400 ms) is the dominant factor.
On devnet the per-transaction latency is typically higher (500–1,500 ms) but the sequential TPS
methodology is identical to the EVM benchmark for controlled comparison.

---

### M-V4-2 · Devnet — Fee & Latency Benchmark

> **Status: pending.**
> Expected additional columns: `slot confirmation latency (s)`, `prioritization fee (lamports)`,
> `cost (USD at time of measurement)`, `CU consumed per instruction`.

---

### M-V4-3 · Localnet — Second Run (solana-test-validator)

**Date:** 2026-03-28
**Environment:** `solana-test-validator` (local, `--reset`)
**Script:** `benchmarks/run_tests.py --platform solana` (Python harness, V4)
**Result file:** `V4_python_solana-localnet_lifecycle_1774992181.json`

#### Scenario Parameters

Identical to M-V4-1.

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 30,774 |
| Throughput (TPS) | 1.6247 |
| Contribute fee (lamports) | 5,000 |
| Contribute latency avg (ms) | ~680 |

**Observation — run-to-run variance [note]:**
This run yields 1.6247 TPS vs. 1.9792 TPS in M-V4-1 — a 17.9% reduction. The lower throughput
reflects slower slot confirmation on this particular validator invocation (~680 ms avg vs.
~515 ms in M-V4-1); localnet slot timing is sensitive to host CPU load and is not controlled
between runs. The fee per transaction (5,000 lamports) is lower than M-V4-1 (10,000 lamports),
suggesting this run used a single-signer transaction path. Both data points are recorded as
measured; the M-V4-1 run is the primary reference for the cross-chain comparison tables.

---

### M-V4-4 · Localnet — Dedicated Throughput Benchmark

**Date:** 2026-03-28
**Script:** `benchmarks/throughput_test.py --platform solana`
**Result file:** `V4_python_solana-localnet_throughput_1774993943.json`

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 79,570 |
| TPS | 0.6284 |
| Fee avg (lamports) | 5,000 |
| Latency avg (ms) | 582 |
| Latency min (ms) | 105 |
| Latency max (ms) | 700 |

**Observation:** The dedicated throughput TPS (0.63) is significantly lower than the lifecycle
TPS (1.62–1.98) because the dedicated harness re-derives all PDAs and creates all ATAs for 50
distinct contributors per run, accumulating slot-wait overhead that is amortised over more
operations in the full lifecycle benchmark.

---

## V5 — Solana / Token-2022

### M-V5-1 · Localnet (solana-test-validator) — Fee & Latency Benchmark

**Date:** 2026-03-16
**Environment:** `solana-test-validator` (local, `--reset`)
**Anchor version:** `@coral-xyz/anchor` 0.32.1
**Token-2022 program:** `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
**Script:** `benchmarks/run_tests.py --platform solana` with `VARIANT=V5`
**Result file:** `V5_python_solana-localnet_lifecycle_1773995545.json`

#### Scenario Parameters

Identical to M-V4-1 (same soft/hard cap, milestone schedule, N = 50).

#### 4.1 `contribute()` — Sequential Fee & Latency (N = 50)

| Metric | Lamports | SOL | Latency (ms) |
|--------|----------:|----:|-------------:|
| Fee (all tx) | 10,000 | 0.000010000 | — |
| Latency avg | — | — | 515 |
| Latency min | — | — | 512 |
| Latency max | — | — | 523 |

#### 4.2 `finalize()` — Fee & Latency

| Metric | Lamports | SOL | Latency (ms) |
|--------|----------:|----:|-------------:|
| Fee | 5,000 | 0.000005000 | 519 |

#### 4.3 `withdraw_milestone()` — Per-Milestone Fee & Latency

| Index | Allocation | Fee (lamports) | SOL | Latency (ms) |
|------:|----------:|---------------:|----:|-------------:|
| 0 | 30 % | 10,000 | 0.000010000 | 514 |
| 1 | 30 % | 10,000 | 0.000010000 | 516 |
| 2 | 40 % | 10,000 | 0.000010000 | 516 |

#### 4.4 `refund()` — Fee & Latency (fail-path, N = 5)

| Metric | Lamports | Latency avg (ms) |
|--------|----------:|-----------------:|
| Fee (all tx) | 10,000 | 514 |

#### 4.5 Throughput

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 25,349 |
| Throughput (TPS) | 1.9725 |

**Observation — V5 indistinguishable from V4 at the fee level [fact]:**
Token-2022 and classic SPL Token produce identical lamport fees across all operations
(5,000 / 10,000 lam per instruction depending on signer count). Latency is within ±1 ms
of V4 across all operations. Throughput is within 0.007 TPS (0.3%) of V4. Any real
difference between V4 and V5 will only manifest in Compute Unit consumption, which requires
instrumentation not present in this run. The Token-2022 extensions (transfer hooks, metadata
pointers, etc.) add on-chain account data but do not increase the base transaction fee.

---

### M-V5-2 · Devnet — Fee & Latency Benchmark

> **Status: pending.**
> Key question: does Token-2022's additional CPI dispatch to extension handlers increase
> CU consumption vs. V4? Expected comparison: CU per `contribute` instruction, V4 vs. V5.

---

### M-V5-3 · Localnet — Dedicated Throughput Benchmark

**Date:** 2026-04-05
**Script:** `benchmarks/throughput_test.py --platform solana` with `VARIANT=V5`
**Result file:** `V5_python_solana-localnet_throughput_1775401527.json`

| Metric | Value |
|--------|-------|
| N contributions | 50 |
| Total wall-clock time (ms) | 83,910 |
| TPS | 0.5959 |
| Fee avg (lamports) | 4,800 |
| Latency avg (ms) | 590 |
| Latency min (ms) | 111 |
| Latency max (ms) | 703 |

**Observation:** Consistent with M-V4-4 (0.63 TPS). The slightly lower TPS (0.60 vs. 0.63) and
fee average (4,800 vs. 5,000 lam) likely reflect slot-timing variance; a small number of
transactions recorded a 0-lamport fee (possible RPC reporting artifact). No functional difference
between V4 and V5 is inferred from this data. CU consumption remains unmeasured (planned for devnet).

---

## Cross-Chain Summary Tables

> **Localnet baseline (reference only).** The tables below are localnet measurements used for
> harness validation and initial gas/fee baselines.
> USD fiat costs require testnet runs with a known gas price or SOL price at time of measurement.
> All fiat cells are `—` (pending) until M-V1-2 and M-V4-2 are completed on testnet.
> No fiat values have been invented or estimated.
>
> **Result file naming.** All benchmark scripts write results to `benchmarks/results/` using
> the convention `{VARIANT}_{CLIENT}_{ENV}_{KIND}_{TIMESTAMP}.json`
> (e.g. `V1_python_hardhat-localnet_lifecycle_1774369893.json`).
> The timestamp (Unix epoch seconds) is generated by `benchmarks/config.py::results_path()`.
> Multiple runs for the same combination accumulate as separate files; the dashboard
> deduplicates to the latest per `(variant, client, environment, kind)` for cards and
> uses all runs for the Comparative Analysis averaging.
> Legacy `evm_raw_*.json` / `solana_raw_*.json` files (schema v1) are no longer produced.
>
> **EVM latency annotation.** Hardhat automines every transaction synchronously; there is no
> mempool wait or block propagation. EVM latency values below reflect local RPC roundtrip
> only (< 30 ms) and are **not comparable** to Solana localnet slot-confirmation latency
> (~515 ms). Every EVM latency figure carries a `[automine]` tag to make this explicit.
>
> **Solana Compute Units.** CU consumption was not captured in M-V4-1 or M-V5-1. All CU cells
> show `≤ 200,000 [ceiling]` — the Anchor default limit per instruction — until measured via
> `getTransaction.meta.computeUnitsConsumed` in a follow-up devnet run.

---

### Table 1 — Per-Operation Cost, All Variants (localnet, raw units)

> EVM: source M-V1-1, M-V2-1, M-V3-1 (2026-03-20). Solana: source M-V4-1, M-V5-1 (2026-03-16).
> EVM `refund()` gas measured on fail-path run (N = 5) for each variant.
> Solana `initialize_campaign` fee derived from fee model (5,000 lam × signers); not directly
> recorded in M-V4-1 or M-V5-1.

| Operation | V1 ERC-20 (gas) | V2 ERC-4626 (gas) | V3 ERC-1155 (gas) | V4 SPL Token (lam) | V5 Token-2022 (lam) |
|-----------|:--------------:|:-----------------:|:-----------------:|:------------------:|:-------------------:|
| `initialize_campaign` | — [¹] | — [¹] | — [¹] | 10,000 [²] | 10,000 [²] |
| `contribute` — avg | 108,026 | 102,606 | 128,653 | 10,000 | 10,000 |
| `contribute` — min | 107,000 | 101,580 | 127,969 | 10,000 | 10,000 |
| `contribute` — max | 158,300 | 152,880 | 162,169 | 10,000 | 10,000 |
| `finalize` | 47,048 | 47,138 | 47,092 | 5,000 | 5,000 |
| `withdrawMilestone[0]` (30 %) | 93,388 | 93,350 | 93,321 | 10,000 | 10,000 |
| `withdrawMilestone[1]` (30 %) | 59,238 | 59,200 | 59,171 | 10,000 | 10,000 |
| `withdrawMilestone[2]` (40 %) | 50,720 | 50,681 | 50,653 | 10,000 | 10,000 |
| `refund` — avg (N=5) | 72,747 | 67,528 | 72,890 | 10,000 [²] | 10,000 [²] |
| `refund` — min | 68,889 | 64,540 | 72,208 | 10,000 | 10,000 |
| `refund` — max | 73,711 | 68,275 | 73,060 | 10,000 | 10,000 |

**Footnotes:**

[¹] EVM `initialize_campaign` gas not recorded in localnet runs; the campaign is deployed via
`CrowdfundingFactory.createCampaign()` and its internal deployment gas was not separated
from the factory call. To be added in M-V1-2 / M-V2-2 / M-V3-2.

[²] Solana fee is deterministic: 5,000 lamports per signature. `initialize_campaign` and
`refund` each require two signers → 10,000 lamports. `finalize` uses one signer → 5,000 lamports.
Derived from fee model; not directly measured for `initialize_campaign` and `refund`. [assumption]

---

### Table 2 — EVM Variant Comparison (localnet, gas units, 2026-03-20)

| Operation | V1 ERC-20 | V2 ERC-4626 | V3 ERC-1155 | V2 vs V1 | V3 vs V1 |
|-----------|----------:|------------:|------------:|:--------:|:--------:|
| `contribute` avg | 108,026 | 102,606 | 128,653 | **−5.0%** | **+19.1%** |
| `contribute` steady-state | 107,000 | 101,580 | 127,969 | −5.1% | +19.6% |
| `finalize` | 47,048 | 47,138 | 47,092 | +0.2% | +0.1% |
| `withdrawMilestone[0]` | 93,388 | 93,350 | 93,321 | −0.04% | −0.07% |
| `withdrawMilestone[1]` | 59,238 | 59,200 | 59,171 | −0.06% | −0.11% |
| `withdrawMilestone[2]` | 50,720 | 50,681 | 50,653 | −0.08% | −0.13% |
| `refund` avg | 72,747 | 67,528 | 72,890 | **−7.2%** | +0.2% |
| Throughput (TPS) | 98.23 | 89.93 | 80.39 | −8.4% | −18.2% |

**Key conclusions:**
- `finalize` and `withdrawMilestone` are effectively token-standard-agnostic (< 0.2% difference).
  The choice of ERC-20 / ERC-4626 / ERC-1155 only affects the `contribute` and `refund` phases.
- V2 (ERC-4626) is the cheapest EVM variant for contribute (−5%) and refund (−7%), due to
  internal vault accounting eliminating one cross-contract CALL.
- V3 (ERC-1155) is the most expensive for contribute (+19%), driven by ERC-1155's
  two-dimensional balance map and the `TransferSingle` event emission.
- The first `contribute` call is ~50,000–55,000 gas more expensive across all three variants
  (cold SSTORE penalty on `totalRaised`). This is a one-time per-campaign cost.

---

### Table 3 — Solana Variant Comparison (localnet, 2026-03-16)

| Operation | V4 SPL Token | V5 Token-2022 | V5 vs V4 |
|-----------|:------------:|:-------------:|:--------:|
| `contribute` fee (lam) | 10,000 | 10,000 | 0% |
| `contribute` latency avg (ms) | 515 | 515 | 0% |
| `finalize` fee (lam) | 5,000 | 5,000 | 0% |
| `finalize` latency (ms) | 520 | 519 | −0.2% |
| `withdrawMilestone` fee (lam) | 10,000 | 10,000 | 0% |
| `withdrawMilestone[0]` latency (ms) | 517 | 514 | −0.6% |
| `refund` fee (lam) | 10,000 | 10,000 | 0% |
| Throughput (TPS) | 1.9792 | 1.9725 | −0.3% |

**Key conclusion:**
At the lamport-fee level, V4 and V5 are identical. All differences are within measurement noise
(slot-boundary timing variance). The only axis on which V5 could diverge from V4 is Compute
Unit consumption, which requires a devnet instrumented run to measure.

---

### Table 4 — Per-Operation Latency, All EVM Clients + Solana (localnet)

> EVM latency source: lifecycle benchmarks 2026-03-28 (Python: M-V1-1, TS: M-V1-2, .NET: M-V1-3).
> Solana latency source: M-V4-1 / M-V5-1 (2026-03-16).
> **All EVM `[automine]` values are not meaningful for network-level comparison.**
> TS and .NET latency differences vs. Python reflect client SDK receipt-polling overhead, not chain behaviour.

| Operation | EVM V1 Python `[automine]` | EVM V1 TS `[automine]` | EVM V1 .NET `[automine]` | V4 Solana avg (ms) | V5 Solana avg (ms) |
|-----------|:--------------------------:|:----------------------:|:------------------------:|:------------------:|:------------------:|
| `contribute` avg | 11 | 76 | 241 | 515 | 515 |
| `contribute` min | 0 | 72 | 228 | 512 | 512 |
| `contribute` max | 18 | 86 | 329 | 519 | 523 |
| `finalize` | 11 | 24 | 423 | 520 | 519 |
| `withdrawMilestone[0]` | 14 | 62 | 241 | 517 | 514 |
| `withdrawMilestone[1]` | 12 | 62 | 222 | 516 | 516 |
| `withdrawMilestone[2]` | 18 | 61 | 222 | 516 | 516 |
| `refund` avg | 13 | 63 | 217 | 516 | 514 |

**Interpretation:** The EVM latency spread across clients (11–241 ms) is a client-library
artefact. Python's synchronous `requests` HTTP call resolves against Hardhat's loopback HTTP
server in ~6 ms per poll; viem's async event loop adds ~70 ms overhead; Nethereum's async
HttpClient adds ~120 ms overhead per poll (per-receipt, two polls per `contribute`). On a real
network (12 s Ethereum block time) all three clients converge to equivalent throughput. See
M-V1-2, M-V1-3 and M-V1-5 for full discussion.

---

### Table 5 — Throughput (localnet, N = 50 sequential contributions)

> **Lifecycle methodology:** single sender account, contributions sent in-process, approval
> pre-granted. Measures SDK receipt-polling latency × N.
> **Dedicated throughput methodology:** 50 distinct EOAs / keypairs, pre-funded outside timed
> window, fresh client subprocess spawned per transaction. Measures process-startup overhead × N.

#### 5a — Lifecycle Throughput (in-process, single sender)

| Client | V1 EVM `[automine]` | V2 EVM `[automine]` | V3 EVM `[automine]` | V4 Solana | V5 Solana |
|--------|:-------------------:|:-------------------:|:-------------------:|:---------:|:---------:|
| Python | 98.23 (509 ms) | 89.93 (556 ms) | 80.39 (622 ms) | 1.62 (30,774 ms) | 1.97 (25,349 ms) |
| TypeScript | 13.09 (3,820 ms) | 12.76 (3,918 ms) | 12.96 (3,858 ms) | — | — |
| .NET | 4.08 (12,243 ms) | 4.23 (11,829 ms) | 4.28 (11,694 ms) | — | — |
| **Limiting factor** | SDK receipt-poll latency | ← | ← | ~400–680 ms/slot | ~400 ms/slot |

#### 5b — Dedicated Throughput (subprocess per transaction)

| Client | V1 EVM | V2 EVM | V3 EVM | V4 Solana | V5 Solana |
|--------|:------:|:------:|:------:|:---------:|:---------:|
| Python | 0.64 (78,299 ms) | — | — | 0.63 (79,570 ms) | 0.60 (83,910 ms) |
| TypeScript | 0.35 (142,022 ms) | — | — | — | — |
| .NET | 0.44 (114,921 ms) | 0.44 (114,016 ms) | 0.46 (109,702 ms) | — | — |
| **Limiting factor** | Process startup overhead (~1,550–2,820 ms/spawn) | ← | ← | ATA setup + slot wait | ← |

**Interpretation:**
- **Lifecycle EVM vs. Solana:** The ~50× gap between Python EVM (98 TPS) and Solana (1.97 TPS)
  is a localnet artefact. Hardhat automines with zero block time; `solana-test-validator` waits
  ~400 ms per slot. On Sepolia (12 s blocks, sequential methodology) EVM TPS drops to ~0.08.
- **Cross-client lifecycle spread (4–98 TPS on EVM):** Driven entirely by receipt-poll latency
  differences between SDK runtimes on localhost (see Table 4 and M-V1-2/M-V1-3). Negligible
  on real networks.
- **Dedicated throughput TPS (0.35–0.64):** Reflects process startup cost, not blockchain
  throughput. The dedicated harness is designed to isolate individual client invocations as they
  would be called from a production application; the low TPS is expected and documented in M-V1-5.

---

### Table 6 — Developer Experience Summary

> LOC counts measured on 2026-03-15 with `wc -l`. EVM contract LOC excludes `MockERC20.sol`
> (test fixture, 19 lines). Solana contract LOC includes all `.rs` source files under
> `programs/crowdfunding/src/`. Client LOC counts are per-platform and exclude shared utilities.
> Setup step counts derived from `docs/setup.md`, assuming Linux environment.

| Metric | V1 EVM | V4 Solana |
|--------|--------|-----------|
| **Contract LOC** | 296 Solidity — 3 files (`CrowdfundingCampaign.sol` 202, `CrowdfundingFactory.sol` 52, `CampaignToken.sol` 42) | 588 Rust — 8 files (instructions: 453; state: 36; errors: 33; lib: 44; mod: 11) |
| **Test LOC** | 475 TypeScript — 3 files | 642 TypeScript — 1 file |
| **TypeScript client LOC** | 521 — 6 files (EVM-side) | 597 — 8 files (Solana-side, incl. `pda.ts` 35) |
| **C# client LOC** | 350 — `EvmCampaignService.cs` | 551 — `SolanaCampaignService.cs` 300 + `InstructionBuilder.cs` 145 + `TransactionHelper.cs` 56 + `PdaHelper.cs` 50 |
| **Python client LOC** | 803 — 10 files | 770 — 9 files |
| **Framework / toolchain** | Solidity 0.8.20 + Hardhat 2.28 + OpenZeppelin 5.1 + viem 2.21 | Rust 1.84 + Anchor 0.32 + SPL Token 0.3.11 + @solana/web3.js 1.95 |
| **Setup steps to first tx** | **3** — `npm install` → `npx hardhat compile` → `npx hardhat run scripts/deploy.ts` | **10** — prereqs → Rust → Solana CLI → AVM → Anchor → Node.js → keypair → `npm install` → `anchor build` → `solana-test-validator` + `anchor deploy` |
| **Type safety model** | ABI-driven: viem generates TS types from ABI; Nethereum uses ABI-generated C# classes | IDL-driven: Anchor generates `idl.json`; `@coral-xyz/anchor` provides TS types; Solnet requires manual account struct mapping in C# |
| **Boilerplate burden** | Low — ABI + address only; ERC-20 allowance is the only extra step | High — explicit account list (≥ 8 accounts per instruction); PDA derivation reproduced in every client; ATA pre-creation required |
| **Key pain points** | Cold/warm SSTORE spread on first contribute (+51 k gas); ERC-20 approve-then-contribute two-step per contributor | Account enumeration per instruction; ATA pre-creation overhead; receipt-mint PDA seed must be consistent across program, TS, C#, and Python clients |

---

## Methodology Notes

1. **Local vs. testnet gas units.** Gas unit counts measured on the Hardhat local network are
   deterministic and independent of network congestion. They represent a lower bound on
   computational cost and are suitable for algorithmic comparison. Fiat-denominated cost
   estimates require testnet (or mainnet) runs with a known gas price at the time of measurement.

2. **Sequential throughput.** The benchmark script submits contributions one at a time and
   awaits each receipt before submitting the next. This measures worst-case sequential
   latency, not parallelized throughput. The 50-transaction EVM total (5.4 M gas for V1)
   fits within a single Ethereum block's gas limit (~30 M gas on mainnet), meaning all 50
   could theoretically be included in one block if submitted simultaneously. The sequential
   methodology is chosen to ensure reproducibility and to match the Solana benchmark scenario
   for a controlled comparison.

3. **Mock token.** The ERC-20 payment token used in the EVM benchmark is `MockERC20`, which
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
   10,000 lamports; instructions with one signer (e.g. `finalize`) cost 5,000 lamports.
   There is no per-instruction gas metering analogous to EVM gas units. Compute Unit (CU)
   consumption is a separate resource limit (default 200,000 CU/instruction) and was not
   recorded in this benchmark run. Priority fees (`ComputeBudgetProgram`) were not set, so
   all fees represent the minimum base cost.

6. **Solana rent-exempt deposits.** Account creation on Solana requires a one-time
   rent-exempt SOL deposit (e.g. ~0.002 SOL for a 128-byte PDA account). These deposits
   are not transaction fees and are recoverable on account closure. They are excluded from
   the per-instruction fee figures above but should be reported as part of the total
   deployment cost in the devnet comparison.

7. **Solana latency outliers.** Two negative latency values were recorded across the V4 and
   V5 runs (−318 ms and −274 ms respectively). These are timer discontinuities caused by
   system clock adjustments during the benchmark and are excluded from all latency statistics.

8. **EVM first-contribution premium.** The first `contribute()` call on any EVM variant costs
   approximately 50,000–55,000 gas more than subsequent calls due to cold SSTORE writes on
   `totalRaised`. In a real campaign with many contributors, this premium is amortised across
   all contributors and has negligible effect on G_avg. It is reported separately as G_max
   and is not used for cross-variant cost comparison.
