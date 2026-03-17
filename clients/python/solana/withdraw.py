"""
solana/withdraw.py -- Withdraw a milestone from a successful Solana campaign.

Usage:
    python -m clients.python sol:withdraw
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from clients.python.solana import config as sol_config
from clients.python.solana.client import get_client, load_keypair, find_pda, send_and_confirm, get_fee
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


async def _withdraw(variant: str) -> TxOutput:
    """Call withdraw_milestone on the campaign."""
    from anchorpy import Program, Provider, Wallet, Idl, Context
    from solders.pubkey import Pubkey
    from spl.token.constants import TOKEN_PROGRAM_ID
    from spl.token.instructions import get_associated_token_address
    from solana.rpc.types import TxOpts

    TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

    py_idl_path, program_id_str = sol_config.SOLANA_VARIANT_ARTIFACTS[variant]
    program_id = Pubkey.from_string(program_id_str)

    client = get_client()
    creator = load_keypair()
    wallet = Wallet(creator)
    provider = Provider(client, wallet)

    with open(py_idl_path) as fh:
        idl = Idl.from_json(fh.read())
    program = Program(idl, program_id, provider)

    campaign_addr = sol_config.SOLANA_CAMPAIGN_PDA
    if not campaign_addr:
        raise EnvironmentError("SOLANA_CAMPAIGN_ADDRESS env var is not set.")
    campaign_pda = Pubkey.from_string(campaign_addr)

    payment_mint_str = sol_config.SOLANA_PAYMENT_MINT
    if not payment_mint_str:
        raise EnvironmentError("SOLANA_PAYMENT_MINT env var is not set.")
    payment_mint = Pubkey.from_string(payment_mint_str)

    vault_pda = find_pda([b"vault", bytes(campaign_pda)], program_id)
    creator_payment_ata = get_associated_token_address(creator.pubkey(), payment_mint)

    no_confirm_opts = TxOpts(skip_confirmation=True, skip_preflight=True)

    t0 = ms()
    sig = await program.rpc["withdraw_milestone"](
        ctx=Context(
            accounts={
                "creator": creator.pubkey(),
                "campaign": campaign_pda,
                "vault": vault_pda,
                "creator_payment_ata": creator_payment_ata,
                "payment_mint": payment_mint,
                "token_program": token_prog,
            },
            signers=[],
            options=no_confirm_opts,
        ),
    )
    await send_and_confirm(client, sig)
    latency = ms() - t0
    fee = await get_fee(client, sig)

    await client.close()

    return TxOutput(
        chain="solana",
        operation="withdraw",
        tx_hash=str(sig),
        block_number=None,
        gas_used=fee,
        status="success",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Withdraw a milestone from a Solana campaign.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT)
    parsed = parser.parse_args(args)

    try:
        output = asyncio.run(_withdraw(parsed.variant))
        print_result(output)
    except Exception as exc:
        print_error("withdraw", exc, chain="solana")


if __name__ == "__main__":
    main()
