"""
evm/config.py -- EVM client configuration loaded from environment variables.

Mirrors the env vars expected by clients/ts/src/evm/config.ts and
clients/dotnet/ for cross-client consistency.
"""

from __future__ import annotations

import os
import pathlib

# ---------------------------------------------------------------------------
# Repository root (for locating Hardhat artifacts)
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent.parent

# ---------------------------------------------------------------------------
# RPC and account configuration
# ---------------------------------------------------------------------------
RPC_URL: str = os.getenv("RPC_URL", os.getenv("EVM_RPC_URL", "http://127.0.0.1:8545"))

PRIVATE_KEY: str = os.getenv("PRIVATE_KEY", os.getenv("EVM_PRIVATE_KEY", ""))

# Hardhat default mnemonic (deterministic accounts -- safe for localnet only)
MNEMONIC: str = os.getenv(
    "EVM_MNEMONIC",
    "test test test test test test test test test test test junk",
)

# ---------------------------------------------------------------------------
# Contract addresses (set after deployment)
# ---------------------------------------------------------------------------
FACTORY_ADDRESS: str = os.getenv("FACTORY_ADDRESS", "")
CAMPAIGN_ADDRESS: str = os.getenv("CAMPAIGN_ADDRESS", "")
PAYMENT_TOKEN_ADDRESS: str = os.getenv("PAYMENT_TOKEN_ADDRESS", "")

# ---------------------------------------------------------------------------
# Variant selection
# ---------------------------------------------------------------------------
VARIANT: str = os.getenv("VARIANT", "V1")

# ---------------------------------------------------------------------------
# Hardhat artifact paths (per variant)
# ---------------------------------------------------------------------------
EVM_ARTIFACTS_DIR: pathlib.Path = REPO_ROOT / "contracts" / "evm" / "artifacts" / "contracts"

FACTORY_ARTIFACT  = EVM_ARTIFACTS_DIR / "CrowdfundingFactory.sol" / "CrowdfundingFactory.json"
CAMPAIGN_ARTIFACT = EVM_ARTIFACTS_DIR / "CrowdfundingCampaign.sol" / "CrowdfundingCampaign.json"
MOCK_ERC20_ARTIFACT = EVM_ARTIFACTS_DIR / "MockERC20.sol" / "MockERC20.json"

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

# Variant -> name of the CampaignCreated event emitted by that factory
EVM_CAMPAIGN_CREATED_EVENT: dict[str, str] = {
    "V1": "CampaignCreated",
    "V2": "CampaignCreated4626",
    "V3": "CampaignCreated1155",
}

# ---------------------------------------------------------------------------
# Scenario parameters
# ---------------------------------------------------------------------------
DECIMALS: int = 6
CONTRIB_AMOUNT: int = 10 * (10 ** DECIMALS)
SOFT_CAP: int = 100 * (10 ** DECIMALS)
HARD_CAP: int = 500 * (10 ** DECIMALS)
DEADLINE_DAYS: int = 30
MILESTONES: list[int] = [30, 30, 40]
SOFT_CAP_REFUND: int = 400 * (10 ** DECIMALS)
