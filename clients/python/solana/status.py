"""
solana/status.py -- Read campaign state from Solana (no transaction).

Usage:
    python -m clients.python sol:status
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from clients.python.solana import config as sol_config
from clients.python.solana.client import get_client, load_keypair, load_idl
from clients.python.shared.output import _now_iso, print_error


async def _status(variant: str) -> dict:
    """Read and return campaign state as a dict."""
    from anchorpy import Program, Provider, Wallet
    from solders.pubkey import Pubkey

    py_idl_path, program_id_str = sol_config.SOLANA_VARIANT_ARTIFACTS[variant]
    program_id = Pubkey.from_string(program_id_str)

    client = get_client()
    payer = load_keypair()
    wallet = Wallet(payer)
    provider = Provider(client, wallet)

    idl = load_idl(py_idl_path)
    program = Program(idl, program_id, provider)

    campaign_addr = sol_config.SOLANA_CAMPAIGN_PDA
    if not campaign_addr:
        raise EnvironmentError("SOLANA_CAMPAIGN_ADDRESS env var is not set.")
    campaign_pda = Pubkey.from_string(campaign_addr)

    # Fetch the campaign account data
    campaign_data = await program.account["Campaign"].fetch(campaign_pda)

    await client.close()

    # Convert to dict -- anchorpy returns a namespace object
    return {
        "chain": "solana",
        "operation": "status",
        "variant": variant,
        "campaign": str(campaign_pda),
        "creator": str(campaign_data.creator) if hasattr(campaign_data, 'creator') else None,
        "totalRaised": campaign_data.total_raised if hasattr(campaign_data, 'total_raised') else None,
        "finalized": campaign_data.finalized if hasattr(campaign_data, 'finalized') else None,
        "softCap": campaign_data.soft_cap if hasattr(campaign_data, 'soft_cap') else None,
        "hardCap": campaign_data.hard_cap if hasattr(campaign_data, 'hard_cap') else None,
        "deadline": campaign_data.deadline if hasattr(campaign_data, 'deadline') else None,
        "currentMilestone": campaign_data.current_milestone if hasattr(campaign_data, 'current_milestone') else None,
        "timestamp": _now_iso(),
    }


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Read Solana campaign state.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT)
    parsed = parser.parse_args(args)

    try:
        result = asyncio.run(_status(parsed.variant))
        print(json.dumps(result))
    except Exception as exc:
        print_error("status", exc, chain="solana")


if __name__ == "__main__":
    main()
