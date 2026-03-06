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
| 1 | ERC-20 receipt token per campaign | EVM | ERC-20 | **MVP** | Simplest EVM token standard; direct counterpart to SPL |
| 2 | ERC-4626 vault shares | EVM | ERC-4626 | Planned | Yield mechanics require external DeFi protocol integration |
| 3 | ERC-1155 tier rewards | EVM | ERC-1155 | Planned | Multi-token IDs add complexity orthogonal to core lifecycle |
| 4 | SPL + Token-2022 | Solana | SPL / Token-2022 | **MVP** (SPL only) | Token-2022 extensions planned as variant 4 extension |

`[fact]` Variants 1 and 4 (SPL) are the MVP implementations. Variants 2, 3, and Token-2022
extensions are planned for later thesis milestones and are fully excluded from MVP benchmarks.

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

## 5. What Is Intentionally Excluded

The following features are explicitly out of scope for the MVP. Each exclusion is a deliberate
decision, not an oversight.

| Feature | Reason excluded | Future work reference |
|---------|----------------|----------------------|
| ERC-4626 vault yield accumulation | Requires external yield protocol integration; would make EVM contract depend on third-party state, breaking controlled comparison | Thesis variant 2; see §8 |
| ERC-1155 tier-based rewards | Multi-token IDs (one per tier) add account/state complexity orthogonal to crowdfunding lifecycle | Thesis variant 3; see §8 |
| Token-2022 extensions (transfer hooks, interest-bearing, confidential transfers) | Variable-size extension accounts and additional CPIs confound cost measurements | Thesis variant 4 extension; see §8 |
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
| Solidity | 0.8.20 | EVM contract compiler |
| Rust | stable (1.84+) | Solana program compilation |
| Solana CLI | 3.0.15 (stable) | Program deployment, account inspection |
| Anchor CLI | 0.32.1 | Build, test, deploy orchestration |
| `anchor-lang` | 0.32.1 | Solana program framework |
| `anchor-spl` | 0.32.1 | SPL Token CPI helpers |

### 7.2 Localnet Rationale

`[recommendation]` All performance measurements are taken on localnet (Hardhat in-process node
for EVM; `solana-test-validator` for Solana) rather than testnet or mainnet. Rationale:

- **Determinism**: localnet has no mempool congestion, no validator variability, no fee market
  fluctuations. Repeated runs produce consistent results.
- **Cost**: testnet faucets are rate-limited; 50-transaction throughput tests would require
  significant faucet budget.
- **Isolation**: localnet runs are unaffected by other users' transactions, ensuring the
  throughput measurement reflects only the benchmark workload.

`[assumption]` Localnet results are directionally representative of devnet behaviour. Absolute
values (finality time, fee amounts) will differ on devnet/mainnet due to network conditions and
fee market dynamics. The thesis analysis must acknowledge this limitation.

---

## 8. Out of Scope / Future Work

### 8.1 ERC-4626 — Vault Shares with On-Chain Yield (Thesis Variant 2)

The ERC-4626 vault standard wraps an underlying ERC-20 asset and accrues yield through an
external protocol. In the crowdfunding context, contributions are deposited into a yield vault
during the funding period; contributors receive vault shares rather than plain receipt tokens.
If the campaign fails, shares are redeemed for the original principal (plus any yield). If it
succeeds, yield flows to the creator.

The architecture is extensible to this variant: the ERC-20 `receiptToken` field in the singleton
contract can be replaced by an ERC-4626 `vault` reference. The lifecycle state machine is
identical; only the `fund` and `refund` functions change.

### 8.2 ERC-1155 — Tier-Based Campaigns (Thesis Variant 3)

ERC-1155 supports multiple token IDs in a single contract, making it natural for tiered
crowdfunding (e.g. token ID 1 = bronze tier at 0.1 ETH, token ID 2 = silver tier at 0.5 ETH).
Each tier has its own supply cap and reward metadata.

The architecture is extensible: the `milestonePercentages` array becomes per-tier, and the
`contributions` mapping becomes `contributions[address][tierId]`. The state machine transitions
are identical.

### 8.3 Token-2022 — SPL Extensions (Thesis Variant 4 Extension)

Token-2022 extends the SPL Token standard with optional extensions attached to mint and token
accounts. Relevant extensions for crowdfunding include:

- **Transfer fee**: automatically deduct a platform fee on each contribution transfer.
- **Interest-bearing**: accrue interest on held tokens, enabling yield-like semantics without
  an external vault.
- **Confidential transfers**: hide contribution amounts using ElGamal encryption (zero-knowledge).

The Solana architecture is extensible: replacing `anchor-spl`'s `Token` program reference with
`Token2022` and adding extension initialisation instructions is the primary change. Account
sizes become variable (extension data appended to mint/token accounts), which is the main
engineering complexity increase relative to the SPL MVP.
