"""
solana/config.py -- Solana client configuration loaded from environment variables.

Mirrors the env vars expected by clients/ts/src/solana/config.ts.
"""

from __future__ import annotations

import os
import pathlib

# ---------------------------------------------------------------------------
# Repository root
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent.parent

# ---------------------------------------------------------------------------
# RPC and wallet configuration
# ---------------------------------------------------------------------------
SOLANA_RPC_URL: str = os.getenv("SOLANA_RPC_URL", "http://127.0.0.1:8899")

SOLANA_KEYPAIR_PATH: str = os.getenv(
    "SOLANA_KEYPAIR_PATH",
    os.getenv("ANCHOR_WALLET", str(pathlib.Path.home() / ".config" / "solana" / "id.json")),
)

# ---------------------------------------------------------------------------
# Program and campaign addresses
# ---------------------------------------------------------------------------
SOLANA_PROGRAM_ID_V4: str = os.getenv(
    "SOLANA_PROGRAM_ID_V4",
    "4agCFfWuoR6MPGXeAb6cXQTHcWmxvqD29uanxJd4bkXv",
)
SOLANA_PROGRAM_ID_V5: str = os.getenv(
    "SOLANA_PROGRAM_ID_V5",
    "AtaYCBbNJJwwwckTouZ2G4ZgrzPNT2JtZF1yL7zUxQpC",
)
# Alias for code that reads SOLANA_PROGRAM_ID directly.
SOLANA_PROGRAM_ID: str = SOLANA_PROGRAM_ID_V4

SOLANA_CAMPAIGN_PDA: str = os.getenv("SOLANA_CAMPAIGN_ADDRESS", "")
SOLANA_PAYMENT_MINT: str = os.getenv("SOLANA_PAYMENT_MINT", "")
SOLANA_CAMPAIGN_ID: str = os.getenv("SOLANA_CAMPAIGN_ID", "")

# ---------------------------------------------------------------------------
# Variant selection
# ---------------------------------------------------------------------------
SOLANA_VARIANT: str = os.getenv("VARIANT", os.getenv("SOLANA_VARIANT", "V4"))

# ---------------------------------------------------------------------------
# IDL paths
# ---------------------------------------------------------------------------
SOLANA_RAW_IDL_PATH: pathlib.Path = (
    REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding.json"
)

SOLANA_PY_IDL_PATH: pathlib.Path = pathlib.Path(
    os.getenv(
        "SOLANA_PY_IDL_PATH",
        str(REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding.python.json"),
    )
)

# Variant -> (py_idl_path, program_id)
SOLANA_VARIANT_ARTIFACTS: dict[str, tuple[pathlib.Path, str]] = {
    "V4": (SOLANA_PY_IDL_PATH, SOLANA_PROGRAM_ID_V4),
    "V5": (
        REPO_ROOT / "contracts" / "solana" / "target" / "idl" / "crowdfunding_token2022.python.json",
        SOLANA_PROGRAM_ID_V5,
    ),
}

# ---------------------------------------------------------------------------
# Scenario parameters (match EVM for fair comparison)
# ---------------------------------------------------------------------------
DECIMALS: int = 6
CONTRIB_AMOUNT: int = 10 * (10 ** DECIMALS)
SOFT_CAP: int = 100 * (10 ** DECIMALS)
HARD_CAP: int = 500 * (10 ** DECIMALS)
DEADLINE_DAYS: int = 30
MILESTONES: list[int] = [30, 30, 40]
SOFT_CAP_REFUND: int = 400 * (10 ** DECIMALS)
