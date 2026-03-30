"""
solana/finalize.py -- Finalize a Solana crowdfunding campaign.

Usage:
    python -m clients.python sol:finalize
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from clients.python.solana import config as sol_config
from clients.python.solana.client import get_client, load_keypair, send_and_confirm, get_fee, load_idl
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


async def _finalize(variant: str) -> TxOutput:
    """Call finalize on the campaign."""
    from anchorpy import Program, Provider, Wallet, Context
    from solders.pubkey import Pubkey
    from solana.rpc.types import TxOpts

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

    no_confirm_opts = TxOpts(skip_confirmation=True, skip_preflight=True)

    t0 = ms()
    sig = await program.rpc["finalize"](
        ctx=Context(
            accounts={
                "caller": payer.pubkey(),
                "campaign": campaign_pda,
            },
            options=no_confirm_opts,
        ),
    )
    await send_and_confirm(client, sig)
    latency = ms() - t0
    fee = await get_fee(client, sig)

    await client.close()

    return TxOutput(
        chain="solana",
        operation="finalize",
        tx_hash=str(sig),
        block_number=None,
        gas_used=fee,
        status="success",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Finalize a Solana campaign.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT)
    parsed = parser.parse_args(args)

    try:
        output = asyncio.run(_finalize(parsed.variant))
        print_result(output)
    except Exception as exc:
        print_error("finalize", exc, chain="solana")


if __name__ == "__main__":
    main()
