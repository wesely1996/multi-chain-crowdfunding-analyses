"""
solana/contribute.py -- Contribute to a Solana crowdfunding campaign.

V4: SPL Token program
V5: Token-2022 program (same logic, different program ID)

Usage:
    python -m clients.python sol:contribute --amount 10       # 10 USDC
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from clients.python.solana import config as sol_config
from clients.python.solana.client import get_client, load_keypair, find_pda, send_and_confirm, get_fee, load_idl
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


async def _contribute(variant: str, amount: int) -> TxOutput:
    """Contribute to a campaign and return TxOutput."""
    from anchorpy import Program, Provider, Wallet, Context
    from solders.pubkey import Pubkey
    from spl.token.constants import TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    from spl.token.instructions import get_associated_token_address
    from solders.sysvar import RENT
    from solders.system_program import ID as SYSTEM_PROGRAM_ID
    from solana.rpc.types import TxOpts

    TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

    py_idl_path, program_id_str = sol_config.SOLANA_VARIANT_ARTIFACTS[variant]
    program_id = Pubkey.from_string(program_id_str)

    client = get_client()
    contributor = load_keypair()
    wallet = Wallet(contributor)
    provider = Provider(client, wallet)

    idl = load_idl(py_idl_path)
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
    receipt_mint_pda = find_pda([b"receipt_mint", bytes(campaign_pda)], program_id)
    contrib_record_pda = find_pda([b"contributor", bytes(campaign_pda), bytes(contributor.pubkey())], program_id)
    contributor_payment_ata = get_associated_token_address(contributor.pubkey(), payment_mint, token_program_id=token_prog)
    contributor_receipt_ata = get_associated_token_address(contributor.pubkey(), receipt_mint_pda, token_program_id=token_prog)

    no_confirm_opts = TxOpts(skip_confirmation=True, skip_preflight=True)

    t0 = ms()
    sig = await program.rpc["contribute"](
        amount,
        ctx=Context(
            accounts={
                "contributor": contributor.pubkey(),
                "campaign": campaign_pda,
                "contributor_record": contrib_record_pda,
                "contributor_payment_ata": contributor_payment_ata,
                "vault": vault_pda,
                "contributor_receipt_ata": contributor_receipt_ata,
                "receipt_mint": receipt_mint_pda,
                "payment_mint": payment_mint,
                "token_program": token_prog,
                "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM_ID,
                "rent": RENT,
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
        operation="contribute",
        tx_hash=str(sig),
        block_number=None,
        gas_used=fee,
        status="success",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"amount": amount, "variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Contribute to a Solana campaign.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT)
    parser.add_argument("--amount", type=float, default=10.0,
                        help="Contribution amount in USDC")
    parsed = parser.parse_args(args)

    try:
        output = asyncio.run(_contribute(parsed.variant, int(round(parsed.amount * 10 ** sol_config.DECIMALS))))
        print_result(output)
    except Exception as exc:
        print_error("contribute", exc, chain="solana")


if __name__ == "__main__":
    main()
