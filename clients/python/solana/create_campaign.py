"""
solana/create_campaign.py -- Initialize a crowdfunding campaign on Solana.

Usage:
    python -m clients.python sol:create_campaign
    python -m clients.python sol:create_campaign --deadline-seconds 60
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


async def _create_campaign(
    variant: str,
    soft_cap: int,
    hard_cap: int,
    deadline_seconds: int,
    milestones: list[int],
) -> TxOutput:
    """Initialize a campaign and return TxOutput."""
    from anchorpy import Program, Provider, Wallet, Context
    from solders.pubkey import Pubkey
    from spl.token.constants import TOKEN_PROGRAM_ID
    from solders.sysvar import RENT
    from solders.system_program import ID as SYSTEM_PROGRAM_ID

    TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

    py_idl_path, program_id_str = sol_config.SOLANA_VARIANT_ARTIFACTS[variant]
    program_id = Pubkey.from_string(program_id_str)

    client = get_client()
    payer = load_keypair()
    wallet = Wallet(payer)
    provider = Provider(client, wallet)

    idl = load_idl(py_idl_path)
    program = Program(idl, program_id, provider)

    payment_mint_str = sol_config.SOLANA_PAYMENT_MINT
    if not payment_mint_str:
        raise EnvironmentError("SOLANA_PAYMENT_MINT env var is not set.")
    payment_mint = Pubkey.from_string(payment_mint_str)

    campaign_id_val = int(time.time() * 1000) & 0xFFFFFFFF
    campaign_id_bytes = campaign_id_val.to_bytes(8, "little")

    campaign_pda = find_pda([b"campaign", bytes(payer.pubkey()), campaign_id_bytes], program_id)
    vault_pda = find_pda([b"vault", bytes(campaign_pda)], program_id)
    receipt_mint_pda = find_pda([b"receipt_mint", bytes(campaign_pda)], program_id)

    deadline_ts = int(time.time()) + deadline_seconds

    from solana.rpc.types import TxOpts
    no_confirm_opts = TxOpts(skip_confirmation=True, skip_preflight=True)

    t0 = ms()
    sig = await program.rpc["initialize_campaign"](
        campaign_id_val, soft_cap, hard_cap, deadline_ts,
        bytes(milestones),
        ctx=Context(
            accounts={
                "creator": payer.pubkey(),
                "campaign": campaign_pda,
                "payment_mint": payment_mint,
                "vault": vault_pda,
                "receipt_mint": receipt_mint_pda,
                "token_program": token_prog,
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
        operation="create_campaign",
        tx_hash=str(sig),
        block_number=None,
        gas_used=fee,
        status="success",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={
            "campaign": str(campaign_pda),
            "campaignId": campaign_id_val,
            "vault": str(vault_pda),
            "receiptMint": str(receipt_mint_pda),
            "variant": variant,
        },
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Initialize a Solana crowdfunding campaign.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT)
    parser.add_argument("--soft-cap", type=float, default=100.0, help="Soft cap in USDC")
    parser.add_argument("--hard-cap", type=float, default=500.0, help="Hard cap in USDC")
    parser.add_argument("--deadline-seconds", type=int, default=sol_config.DEADLINE_DAYS * 86400)
    parsed = parser.parse_args(args)

    try:
        output = asyncio.run(_create_campaign(
            variant=parsed.variant,
            soft_cap=int(round(parsed.soft_cap * 10 ** sol_config.DECIMALS)),
            hard_cap=int(round(parsed.hard_cap * 10 ** sol_config.DECIMALS)),
            deadline_seconds=parsed.deadline_seconds,
            milestones=sol_config.MILESTONES,
        ))
        print_result(output)
    except Exception as exc:
        print_error("create_campaign", exc, chain="solana")


if __name__ == "__main__":
    main()
