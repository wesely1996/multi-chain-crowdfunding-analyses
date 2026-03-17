# Scope Definition

This document defines and justifies the implementation scope for the thesis comparative analysis.
It must be read before making any implementation or measurement decisions. Scope boundaries are
established here so that the comparative analysis in M7–M8 rests on a controlled, reproducible
foundation rather than ad-hoc decisions made during implementation.

> **Label legend used throughout this document:**
> - `[fact]` — verified against source files, specifications, or tooling output
> - `[assumption]` — reasonable inference not yet verified against a running system
> - `[recommendation]` — design guidance that could be changed, with stated rationale

---

## 1. Purpose

A comparative analysis is only valid when the compared implementations are symmetric: same
lifecycle, same parameters, same measurement methodology. Defining scope upfront enforces this
symmetry. It also prevents scope creep during implementation from invalidating measurements
already taken.

The four thesis contract variants span multiple token standards and two blockchain platforms.
Not all variants are required for the MVP comparison. This document defines which variant forms
the controlled baseline, which are planned extensions, and what is intentionally excluded.

---

## 2. Contract Variants

| # | Variant | Platform | Token standard | Status | Justification |
|---|---------|----------|---------------|--------|---------------|
| 1 | ERC-20 receipt token per campaign | EVM | ERC-20 | **Implemented** | Simplest EVM token standard; direct counterpart to SPL |
| 2 | ERC-4626 vault shares | EVM | ERC-4626 | **Implemented** | Campaign IS the vault token; no separate receipt token deployed |
| 3 | ERC-1155 tier rewards | EVM | ERC-1155 | **Implemented** | Tier-based (Bronze/Silver/Gold); per-tier refund with ERC-1155 burn |
| 4 | SPL Token (classic) | Solana | SPL | **Implemented** | Direct counterpart to ERC-20; classic SPL Token program |
| 5 | Token-2022 (SPL extensions) | Solana | Token-2022 | **Implemented** | Separate Anchor program (`crowdfunding_token2022`); 9/9 tests passing |

`[fact]` All five variants are implemented. Localnet benchmark runs for all five variants are complete (see `benchmarks/results/`). Testnet runs (Sepolia, Solana devnet) are pending.

---

## 3. Why ERC-20 + SPL as the Controlled Baseline

1. **Tooling parity** `[fact]`: Both ERC-20 (OpenZeppelin 5.1.x) and SPL Token (Anchor 0.32.1
   `anchor-spl`) have mature, well-maintained libraries with comprehensive test coverage. Tooling
   asymmetry would introduce noise into DX metrics.

2. **Metric comparability** `[recommendation]`: ERC-20 and SPL are the simplest fungible token
   standards on their respective platforms. Any performance difference measured between the two
   reflects platform characteristics, not token standard complexity.

3. **Absence of yield and extension complexity** `[fact]`: ERC-4626 requires integrating an
   external yield vault (e.g., Aave, Compound). Token-2022 extensions (transfer hooks, interest-
   bearing) require additional CPIs. Neither is relevant to the core crowdfunding lifecycle and
   both would confound cost measurements.

4. **Reproducibility** `[recommendation]`: SPL Token accounts have fixed size. Token-2022
   extension accounts have variable size depending on enabled extensions. Fixed account sizes
   make lamport rent calculations deterministic and reproducible across runs.

5. **Historical comparability** `[assumption]`: ERC-20 gas costs are extensively documented in
   prior literature. SPL Token transfer costs are similarly well-characterised. Comparisons against
   the MVP baseline can be validated against published benchmarks; ERC-4626 and Token-2022 have
   less historical data available.

---

## 4. Evaluation Metrics Alignment

| Metric | How MVP scope enables fair measurement |
|--------|---------------------------------------|
| Transaction cost (gas / lamports) | Single contract/program per campaign; no proxy or factory overhead `[fact]` |
| Confirmation / finality time | Measured per-transaction on localnet with deterministic clock; no mempool variance `[fact]` |
| Throughput (50 sequential contributions) | Identical contribution loop on both platforms; same parameter set `[recommendation]` |
| Lines of code (LOC) | Counted per implementation; helper libraries counted separately `[recommendation]` |
| Setup steps (DX) | Documented in `docs/setup.md`; step count is an objective metric `[fact]` |
| Time to first successful transaction | Recorded from clean environment using setup.md instructions `[assumption]` |

---

## 4a. Client Layer Scope

The three integration client layers — TypeScript, .NET, and Python — evolve in parallel with the
contract variants. Excluding a variant from MVP benchmarks does not exclude it from the final
client abstraction goals. The benchmark scope and the client architecture scope are distinct.

| Stage | TypeScript client | .NET client | Python client | Variants supported |
|-------|------------------|-------------|---------------|-------------------|
| MVP | viem (EVM ERC-20) + Anchor TS (Solana SPL) | Nethereum (EVM ERC-20) + Solana.NET/RPC (Solana SPL) | web3.py (EVM ERC-20) + anchorpy (Solana SPL) | V1 + V4 (SPL only) |
| Full thesis scope | Extended to ERC-4626, ERC-1155, and Token-2022 variants | Extended to ERC-4626, ERC-1155, and Token-2022 variants | V1/V2/V3 branching in `evm/contribute.py`; V4/V5 in `solana/contribute.py` | V1 + V2 + V3 + V4 + V5 |

`[recommendation]` All three client layers are designed from the start to be variant-aware. A
client's absence of support for a planned variant at MVP stage is a temporary implementation-stage
limitation, not the intended final design.

`[fact]` The repository layout is `clients/ts/`, `clients/dotnet/`, and `clients/python/`.
The Python client doubles as a library: `benchmarks/run_tests.py` and `benchmarks/throughput_test.py`
import from `clients.python.*` directly for in-process measurement. It can also be driven as a
subprocess via `python benchmarks/run_client_benchmark.py --client python`.

---

## 5. What Is Intentionally Excluded

The following features are explicitly out of scope for the MVP. Each exclusion is a deliberate
decision, not an oversight.

| Feature | Reason excluded | Future work reference |
|---------|----------------|----------------------|
| ERC-4626 external yield accumulation | The ERC-4626 variant IS implemented (V2) but without integration to an external yield vault. On-chain yield (Aave/Compound integration) would make the EVM contract depend on third-party state, breaking controlled comparison | Implemented as standalone vault without yield source |
| ERC-1155 arbitrary multi-token combinations | V3 ERC-1155 is implemented with three fixed tiers. Open-ended multi-token schemas (arbitrary IDs, hybrid NFT+ERC-20) are excluded as they cannot be cleanly benchmarked | Implemented (3-tier Bronze/Silver/Gold) |
| Token-2022 extensions (transfer hooks, interest-bearing, confidential transfers) | Variable-size extension accounts and additional CPIs confound cost measurements | Thesis variant 5; see §8 |
| Upgradeability / proxy patterns (EVM: EIP-1967 transparent proxy; Solana: BPF upgradeable loader) | Proxy indirection adds deploy/call overhead not present in Solana's native program model; breaks cost symmetry | Not planned — thesis focuses on immutable contracts |
| On-chain governance (voting, timelock) | Out of scope for crowdfunding lifecycle; would require separate governance token | Not planned |
| Multi-token reward systems (e.g. NFT + ERC-20 hybrid) | Combines two thesis variants; cannot be cleanly benchmarked as a unit | Not planned in MVP |

---

## 6. Statement Labels

All material claims in this document and in `docs/architecture.md` are labelled:

| Label | Meaning |
|-------|---------|
| `[fact]` | Verified against source files, official specifications, tooling output, or test results |
| `[assumption]` | Reasonable inference based on available evidence; should be validated before thesis submission |
| `[recommendation]` | Design or methodology choice that has alternatives; rationale is stated and the choice can be revisited |

Where a claim has no label it should be treated as `[assumption]` and investigated before the
comparative analysis chapter is written.

---

## 7. Reproducibility Constraints

All benchmark results must be reproducible from a clean environment using the versions below.
Any deviation from these versions must be documented in `docs/measurements.md`.

### 7.1 Toolchain Version Matrix

`[fact]` — extracted from `docs/setup.md` (tested baseline):

| Tool | Version | Scope |
|------|---------|-------|
| Node.js | 20.x LTS | EVM + Solana (TypeScript tooling) |
| TypeScript | 5.4.x | EVM client, Solana tests |
| Hardhat | 2.22.x | EVM compilation, testing, local node |
| `@openzeppelin/contracts` | 5.1.x | ERC-20 base implementation |
| Solidity | 0.8.24 | EVM contract compiler (Cancun EVM target; required for OZ ERC4626 `mcopy`) |
| Rust | stable (1.84+) | Solana program compilation |
| Solana CLI | 3.0.15 (stable) | Program deployment, account inspection |
| Anchor CLI | 0.32.1 | Build, test, deploy orchestration |
| `anchor-lang` | 0.32.1 | Solana program framework |
| `anchor-spl` | 0.32.1 | SPL Token CPI helpers |
| `@coral-xyz/anchor` (TS) | 0.30.1 | TS client Anchor SDK |
| `@solana/web3.js` | 1.95.4 | Solana RPC and transaction building |
| viem | 2.21.x | EVM client RPC and contract interaction |
| Python | 3.12 (3.11–3.13 also work) | Benchmark harness + Python client (`clients/python/`) |
| web3.py | 6.20.3 | Python EVM interaction |
| solana-py | 0.36.6 | Python Solana RPC client |
| solders | 0.26.0 | Python Solana types (Rust extension) |
| anchorpy | 0.21.0 | Python Anchor IDL client |

### 7.2 Measurement Environments

The thesis uses two tiers of benchmark environments:

**Tier 1 — Localnet (initial validation only):**
`[recommendation]` Early-stage runs use localnet (Hardhat in-process node for EVM;
`solana-test-validator` for Solana) to validate harness correctness and establish gas/fee
baselines before spending real testnet funds. Rationale:

- **Determinism**: no mempool congestion, no validator variability, no fee market fluctuations.
- **Cost**: testnet faucets are rate-limited; 50-transaction throughput tests would exhaust faucet budgets quickly.
- **Isolation**: unaffected by other users' transactions.

Localnet data is used in `docs/measurements.md` as a reference baseline but is **not displayed
in the dashboard**.

**Tier 2 — Testnet (dashboard and final thesis data):**
`[fact]` All dashboard results and final thesis comparative measurements are collected on
**Sepolia** (EVM variants V1–V3) and **Solana devnet** (Solana variants V4–V5). Testnet data
captures real network latency, fee market conditions, and slot-confirmation timing.

`[assumption]` Localnet gas unit counts are deterministic and equal to testnet gas units (EVM
gas is network-independent). Absolute latency and fee values differ on testnet due to network
conditions and fee market dynamics — the thesis analysis must acknowledge this difference.

---

## 8. Out of Scope / Future Work

### 8.1 ERC-4626 — Vault Shares (Thesis Variant 2) `[Implemented]`

`CrowdfundingCampaign4626.sol` + `CrowdfundingFactory4626.sol` are fully implemented and tested
(26 tests). The campaign contract extends OZ `ERC4626`: the campaign itself IS the vault share
token — no separate `CampaignToken` is deployed. Standard ERC-4626 entry points (`deposit`,
`mint`, `withdraw`, `redeem`) are disabled with custom errors (`UseContributeInstead` /
`UseRefundInstead`) to preserve the crowdfunding state machine invariants.

Key design decisions:
- `contribute(amount)` calls `_mint(msg.sender, amount)` directly (not `_deposit`) to avoid
  double event emission and to decouple from ERC-4626's yield-ratio preview math.
- `refund()` calls `_burn(msg.sender, amount)` directly, symmetric with `contribute`.
- `maxDeposit / maxMint / maxWithdraw / maxRedeem` all return 0 to signal to ERC-4626-aware
  integrators that standard vault flows are not supported.
- The underlying asset (`asset()`) is the payment token (e.g. USDC); shares are minted 1:1.

**Out of scope for V2:** external yield protocol integration (Aave, Compound). The V2 contract
holds the payment token directly without routing it to a yield vault. If yield mechanics were
added, the contract would depend on third-party state, breaking the controlled benchmark
comparison. Yield integration is not planned for the thesis scope.

### 8.2 ERC-1155 — Tier-Based Campaigns (Thesis Variant 3) `[Implemented]`

`CrowdfundingCampaign1155.sol` + `CrowdfundingFactory1155.sol` + `CampaignTierToken.sol` are
fully implemented and tested (27 tests). Three fixed tiers (Bronze 100 USDC, Silver 500 USDC,
Gold 1,000 USDC) are defined at campaign creation. Contributors select a tier via
`contribute(tierId)` and receive one ERC-1155 token of that ID. Refunds are per-tier via
`refund(tierId)`, which burns one tier token and returns the tier price in payment token.

Key design decisions:
- `tierContributions[address][tierId]` tracks count of tokens held per tier; `contributions[address]`
  tracks total USDC for softCap/hardCap accounting (consistent with V1/V2).
- The `CampaignTierToken` (ERC-1155) is deployed by the campaign constructor with an
  `onlyCampaign` modifier on `mint` / `burn`, mirroring the `CampaignToken` (ERC-20) pattern.
- `CrowdfundingFactory1155.createCampaign` emits `CampaignCreated1155` with both the campaign
  and the tier token address (four fields total).

### 8.3 Token-2022 — SPL Extensions (Thesis Variant 5)

Token-2022 extends the SPL Token standard with optional extensions attached to mint and token
accounts. It is implemented as a **separate Anchor program** (variant 5) alongside the classic
SPL variant (variant 4), enabling direct side-by-side comparison of costs, fees, and DX.
Relevant extensions for crowdfunding include:

- **Transfer fee**: automatically deduct a platform fee on each contribution transfer.
- **Interest-bearing**: accrue interest on held tokens, enabling yield-like semantics without
  an external vault.
- **Confidential transfers**: hide contribution amounts using ElGamal encryption (zero-knowledge).

The Solana architecture supports this as a separate program (V5): a new Anchor program uses
`anchor-spl`'s `Token2022` program type instead of `Token`, with extension initialisation
instructions added where needed. Account sizes become variable (extension data appended to
mint/token accounts), which is the main engineering complexity increase relative to the SPL
variant (V4). Both programs coexist in the workspace for side-by-side benchmarking.
