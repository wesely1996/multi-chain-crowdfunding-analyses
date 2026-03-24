"""
solana/create_mint.py -- Create a new SPL token payment mint on localnet.

Run this after `solana-test-validator --reset` to recreate the payment mint.
Mints tokens to the payer's ATA and prints the address for SOLANA_PAYMENT_MINT.

Usage:
    python -m clients.python sol:create_mint
    python -m clients.python sol:create_mint --amount 50000
    python -m clients.python sol:create_mint --variant V5   # Token-2022
"""

from __future__ import annotations

import argparse
import asyncio

from clients.python.solana import config as sol_config
from clients.python.solana.client import get_client, load_keypair, airdrop_and_wait


async def _create_mint(amount_units: int, variant: str) -> str:
    from spl.token.async_client import AsyncToken as SPLAsyncToken
    from spl.token.constants import TOKEN_PROGRAM_ID
    from solders.pubkey import Pubkey

    TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

    client = get_client()
    payer = load_keypair()

    balance = await client.get_balance(payer.pubkey())
    if balance.value < 1_000_000_000:
        print("[setup] Airdropping SOL to payer...")
        await airdrop_and_wait(client, payer.pubkey(), 2_000_000_000)

    print("[setup] Creating payment mint...")
    payment_mint = await SPLAsyncToken.create_mint(
        client, payer, payer.pubkey(), sol_config.DECIMALS, token_prog
    )
    mint_pubkey = payment_mint.pubkey

    print("[setup] Creating payer ATA and minting tokens...")
    ata = await payment_mint.create_account(payer.pubkey())
    await payment_mint.mint_to(ata, payer, amount_units)
    await asyncio.sleep(2)

    await client.close()

    print(f"\nPayment mint : {mint_pubkey}")
    print(f"Payer ATA    : {ata}")
    print(f"Tokens minted: {amount_units / 10**sol_config.DECIMALS:.2f}")
    print(f"\nUpdate .env:")
    print(f"  SOLANA_PAYMENT_MINT={mint_pubkey}")

    return str(mint_pubkey)


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Create SPL payment mint on localnet.")
    parser.add_argument("--variant", default=sol_config.SOLANA_VARIANT,
                        help="V4 (SPL Token, default) or V5 (Token-2022)")
    parser.add_argument("--amount", type=float, default=10_000.0,
                        help="Tokens to mint to payer (USDC units, default 10000)")
    parsed = parser.parse_args(args)

    amount_units = int(parsed.amount * 10 ** sol_config.DECIMALS)
    asyncio.run(_create_mint(amount_units, parsed.variant))


if __name__ == "__main__":
    main()
