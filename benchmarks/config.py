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
# Run identity — variant and client under test
# ---------------------------------------------------------------------------

# VARIANT selects which contract variant is being benchmarked.
# Override with VARIANT env var or --variant CLI arg.
# V1=ERC-20, V2=ERC-4626, V3=ERC-1155, V4=SPL Token, V5=Token-2022
VARIANT: str = os.getenv("VARIANT", "V1")

# CLIENT identifies the client library driving the benchmark.
# Override with CLIENT env var.
# python | ts | dotnet
CLIENT: str = os.getenv("CLIENT", "python")

# BENCHMARK_ENV overrides auto-detected environment label.
# Set to "sepolia", "hardhat-localnet", "solana-localnet", "solana-devnet".
BENCHMARK_ENV: str = os.getenv("BENCHMARK_ENV", "")

# Human-readable labels for reporting
VARIANT_LABELS: dict[str, str] = {
    "V1": "ERC-20 receipt tokens",
    "V2": "ERC-4626 vault shares",
    "V3": "ERC-1155 tier tokens",
    "V4": "SPL Token (classic)",
    "V5": "Token-2022 extensions",
}

CLIENT_LABELS: dict[str, str] = {
    "python": "Python web3.py / anchorpy",
    "ts": "TypeScript viem / Anchor TS",
    "dotnet": ".NET Nethereum / Solnet",
}

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

# Variant → name of the CampaignCreated event emitted by that factory
EVM_CAMPAIGN_CREATED_EVENT: dict[str, str] = {
    "V1": "CampaignCreated",
    "V2": "CampaignCreated4626",
    "V3": "CampaignCreated1155",
}

# Variant → (factory_artifact, campaign_artifact, mock_erc20_artifact)
EVM_VARIANT_ARTIFACTS: dict[str, tuple[pathlib.Path, pathlib.Path, pathlib.Path]] = {
    "V1": (FACTORY_ARTIFACT, CAMPAIGN_ARTIFACT, MOCK_ERC20_ARTIFACT),
    "V2": (
        EVM_ARTIFACTS_DIR / "CrowdfundingFactory4626.sol" / "CrowdfundingFactory4626.json",
        EVM_ARTIFACTS_DIR / "CrowdfundingCampaign4626.sol" / "CrowdfundingCampaign4626.json",
        MOCK_ERC20_ARTIFACT,
    ),
    "V3": (
        EVM_ARTIFACTS_DIR / "CrowdfundingFactory1155.sol" / "CrowdfundingFactory1155.json",
        EVM_ARTIFACTS_DIR / "CrowdfundingCampaign1155.sol" / "CrowdfundingCampaign1155.json",
        MOCK_ERC20_ARTIFACT,
    ),
}

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

# Solana program IDs — must match `declare_id!` in lib.rs and Anchor.toml
# Override per-variant with SOLANA_PROGRAM_ID_V4 / SOLANA_PROGRAM_ID_V5 env vars.
SOLANA_PROGRAM_ID_V4: str = os.getenv(
    "SOLANA_PROGRAM_ID_V4",
    "4agCFfWuoR6MPGXeAb6cXQTHcWmxvqD29uanxJd4bkXv",
)
SOLANA_PROGRAM_ID_V5: str = os.getenv(
    "SOLANA_PROGRAM_ID_V5",
    "AtaYCBbNJJwwwckTouZ2G4ZgrzPNT2JtZF1yL7zUxQpC",
)
# Alias kept for code that still reads SOLANA_PROGRAM_ID directly (e.g. throughput script).
SOLANA_PROGRAM_ID: str = SOLANA_PROGRAM_ID_V4

# Variant → (py_idl_path, program_id)
SOLANA_VARIANT_ARTIFACTS: dict[str, tuple[pathlib.Path, str]] = {
    "V4": (SOLANA_PY_IDL_PATH, SOLANA_PROGRAM_ID_V4),
    "V5": (
        REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding_token2022.python.json",
        SOLANA_PROGRAM_ID_V5,
    ),
}

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

# Solana fast-deadline campaigns (finalize/withdraw/refund lifecycle setup).
# These campaigns must expire quickly so the benchmark doesn't stall.
# Deadline = FAST_DEADLINE_BASE_SECS + n_contributes * FAST_DEADLINE_PER_CONTRIB_SECS,
# so campaigns with more contributors get proportionally more runway.
FAST_DEADLINE_BASE_SECS: int = int(os.getenv("FAST_DEADLINE_BASE_SECS", "15"))
# Per-contribution allowance: covers mint_to + contribute RPC + confirmation round-trip.
FAST_DEADLINE_PER_CONTRIB_SECS: int = int(os.getenv("FAST_DEADLINE_PER_CONTRIB_SECS", "5"))
# Extra buffer added after the deadline before calling finalize, to avoid
# clock skew between the client and the validator.
FAST_DEADLINE_BUFFER_SECS: int = int(os.getenv("FAST_DEADLINE_BUFFER_SECS", "5"))

# Milestone schedule — must sum to 100
MILESTONES: list[int] = [30, 30, 40]

# Refund scenario: soft cap above total raised (5 × 10 = 50 USDC) but ≤ hardCap
SOFT_CAP_REFUND: int = 400 * (10 ** DECIMALS)    # 400 USDC — never reached by 5 contributors

# ---------------------------------------------------------------------------
# Results output
# ---------------------------------------------------------------------------

RESULTS_DIR: pathlib.Path = REPO_ROOT / "benchmarks" / "results"

# Legacy raw per-run JSON files (kept for backward compatibility)
EVM_RAW_RESULTS:    pathlib.Path = RESULTS_DIR / "evm_raw.json"
SOLANA_RAW_RESULTS: pathlib.Path = RESULTS_DIR / "solana_raw.json"


def _infer_env(variant: str) -> str:
    """Infer environment label from RPC URLs when BENCHMARK_ENV is not set."""
    v = variant.upper()
    if v in ("V1", "V2", "V3"):
        rpc = EVM_RPC_URL
        if "infura" in rpc or "alchemy" in rpc or "sepolia" in rpc or "11155111" in rpc:
            return "sepolia"
        return "hardhat-localnet"
    else:
        rpc = SOLANA_RPC_URL
        if "devnet" in rpc or "api.devnet" in rpc:
            return "solana-devnet"
        return "solana-localnet"


def results_path(variant: str, client: str, kind: str, env: str | None = None, timestamp: int | None = None) -> pathlib.Path:
    """Return result file path including timestamp so multiple runs accumulate.

    kind: "lifecycle" | "throughput"
    e.g., V1_python_hardhat-localnet_lifecycle_1742834400.json
    """
    import time as _time
    resolved_env = env or BENCHMARK_ENV or _infer_env(variant)
    ts = timestamp or int(_time.time())
    return RESULTS_DIR / f"{variant}_{client}_{resolved_env}_{kind}_{ts}.json"
