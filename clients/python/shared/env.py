"""
shared/env.py -- Environment variable helpers shared across EVM and Solana clients.
"""

from __future__ import annotations

import os

DECIMALS = 6  # USDC decimals


def require_env(name: str) -> str:
    """Return the value of env var `name`, or raise if unset/empty."""
    val = os.environ.get(name)
    if not val:
        raise EnvironmentError(f"Required env var {name!r} is not set")
    return val
