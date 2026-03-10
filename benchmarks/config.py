"""
config.py — Benchmark configuration for EVM and Solana crowdfunding harness.

All tunable constants live here. Logic files import from this module only —
no addresses, keys, or RPC URLs are hardcoded elsewhere.

Usage
-----
Override any value by setting the corresponding environment variable before
running the benchmark script, e.g.:

    EVM_RPC_URL=http://127.0.0.1:8545 python benchmarks/run_tests.py

Key design constraints
----------------------
- Hardhat automines every transaction instantly; latency figures reflect
  local execution time only, NOT real network propagation.
- solana-test-validator is single-threaded; TPS figures do not represent
  production conditions.
- Hardhat is configured with accounts.count=60 (1 deployer + up to 59
  contributors) in contracts/evm/hardhat.config.ts.
"""

import os
import pathlib

# ---------------------------------------------------------------------------
# Repository root (used to locate artifacts relative to this file)
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# EVM — Hardhat localnet
# ---------------------------------------------------------------------------

EVM_RPC_URL: str = os.getenv("EVM_RPC_URL", "http://127.0.0.1:8545")

# Path to compiled Hardhat artifacts (produced by `npx hardhat compile`)
EVM_ARTIFACTS_DIR: pathlib.Path = REPO_ROOT / "contracts" / "evm" / "artifacts" / "contracts"

# Artifact paths (relative to EVM_ARTIFACTS_DIR)
FACTORY_ARTIFACT  = EVM_ARTIFACTS_DIR / "CrowdfundingFactory.sol" / "CrowdfundingFactory.json"
CAMPAIGN_ARTIFACT = EVM_ARTIFACTS_DIR / "CrowdfundingCampaign.sol" / "CrowdfundingCampaign.json"
MOCK_ERC20_ARTIFACT = EVM_ARTIFACTS_DIR / "MockERC20.sol" / "MockERC20.json"

# Hardhat default mnemonic (deterministic accounts — safe for localnet only)
# Index 0 = deployer/creator; indices 1..50 = contributors
EVM_MNEMONIC: str = os.getenv(
    "EVM_MNEMONIC",
    "test test test test test test test test test test test junk",
)

# Derivation path used by Hardhat for its default accounts
EVM_HD_PATH: str = "m/44'/60'/0'/0/{index}"

# ---------------------------------------------------------------------------
# Solana — localnet
# ---------------------------------------------------------------------------

SOLANA_RPC_URL: str = os.getenv("SOLANA_RPC_URL", "http://127.0.0.1:8899")

# Path to Anchor-compiled IDL (produced by `anchor build`)
SOLANA_RAW_IDL_PATH: pathlib.Path = (
    REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding.json"
)

# Python-compatible IDL consumed by anchorpy.
# Keep this as a separate artifact so the benchmark does not depend directly
# on whichever IDL schema the current Anchor toolchain happens to emit.
SOLANA_PY_IDL_PATH: pathlib.Path = pathlib.Path(
    os.getenv(
        "SOLANA_PY_IDL_PATH",
        str(REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding.python.json"),
    )
)

# Path to the payer wallet keypair JSON (Solana CLI default)
SOLANA_WALLET_PATH: str = os.getenv(
    "ANCHOR_WALLET",
    str(pathlib.Path.home() / ".config" / "solana" / "id.json"),
)

# Solana program ID — must match `declare_id!` in lib.rs and Anchor.toml
SOLANA_PROGRAM_ID: str = os.getenv(
    "SOLANA_PROGRAM_ID",
    "4agCFfWuoR6MPGXeAb6cXQTHcWmxvqD29uanxJd4bkXv",
)

# ---------------------------------------------------------------------------
# Scenario parameters — identical across both platforms for a fair comparison
# ---------------------------------------------------------------------------

# Number of sequential contributions in the throughput benchmark
N_CONTRIBUTIONS: int = int(os.getenv("N_CONTRIBUTIONS", "50"))

# Token amounts (6 decimal places, matching MockERC20 and the SPL mint)
DECIMALS: int = 6
CONTRIB_AMOUNT: int = 10 * (10 ** DECIMALS)      # 10 USDC per contributor
SOFT_CAP:       int = 100 * (10 ** DECIMALS)     # 100 USDC — reachable at N=10
HARD_CAP:       int = 500 * (10 ** DECIMALS)     # 500 USDC — reachable at N=50
DEADLINE_DAYS:  int = 30                          # Advance via evm_increaseTime on EVM

# Milestone schedule — must sum to 100
MILESTONES: list[int] = [30, 30, 40]

# Refund scenario: soft cap above total raised (5 × 10 = 50 USDC) but ≤ hardCap
SOFT_CAP_REFUND: int = 400 * (10 ** DECIMALS)    # 400 USDC — never reached by 5 contributors

# ---------------------------------------------------------------------------
# Results output
# ---------------------------------------------------------------------------

RESULTS_DIR: pathlib.Path = REPO_ROOT / "benchmarks" / "results"

# Raw per-run JSON files land here
EVM_RAW_RESULTS:    pathlib.Path = RESULTS_DIR / "evm_raw.json"
SOLANA_RAW_RESULTS: pathlib.Path = RESULTS_DIR / "solana_raw.json"
