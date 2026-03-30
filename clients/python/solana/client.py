"""
solana/client.py -- Core Solana helpers for the Python client.

Migrated from benchmarks/solana_utils.py. Contains only client-level
concerns (RPC connection, keypair loading, PDA derivation, airdrop).
Benchmark-specific helpers (make_op_record) remain in the benchmark scripts.
"""

from __future__ import annotations

import asyncio
import functools
import json
from typing import Any

from clients.python.shared.output import ms


def get_client(rpc_url: str | None = None):
    """Return an AsyncClient connected to rpc_url."""
    from solana.rpc.async_api import AsyncClient
    from solana.rpc.commitment import Confirmed

    from clients.python.solana.config import SOLANA_RPC_URL

    url = rpc_url or SOLANA_RPC_URL
    return AsyncClient(url, commitment=Confirmed)


def load_keypair(path: str | None = None):
    """Load a Keypair from a JSON file (Solana CLI format: [u8; 64])."""
    from solders.keypair import Keypair

    from clients.python.solana.config import SOLANA_KEYPAIR_PATH

    kp_path = path or SOLANA_KEYPAIR_PATH
    with open(kp_path) as fh:
        key_bytes = json.load(fh)
    return Keypair.from_bytes(bytes(key_bytes))


def find_pda(seeds: list[bytes], program_id) -> Any:
    """Thin wrapper around Pubkey.find_program_address."""
    from solders.pubkey import Pubkey
    addr, _ = Pubkey.find_program_address(seeds, program_id)
    return addr


async def airdrop_and_wait(client, pubkey, lamports: int, sleep_s: float = 2.0) -> None:
    """Request airdrop and wait for confirmation."""
    await client.request_airdrop(pubkey, lamports)
    await asyncio.sleep(sleep_s)


async def send_and_confirm(client, sig, max_retries: int = 120, interval: float = 0.5) -> None:
    """
    Poll get_signature_statuses until confirmed.
    Avoids the solana.py last_valid_block_height timeout issue.
    """
    for _ in range(max_retries):
        resp = await client.get_signature_statuses([sig])
        st = resp.value[0]
        if st and st.confirmation_status is not None:
            return
        await asyncio.sleep(interval)
    raise RuntimeError(f"Transaction not confirmed after {max_retries * interval}s: {sig}")


async def get_fee(client, sig) -> int:
    """Fetch the fee paid for a confirmed transaction."""
    resp = await client.get_transaction(sig, max_supported_transaction_version=0)
    if resp.value and resp.value.transaction.meta:
        return resp.value.transaction.meta.fee
    return 0


@functools.lru_cache(maxsize=None)
def load_idl(idl_path):
    """Load and cache an Anchor IDL from a JSON file. One file read per unique path."""
    from anchorpy import Idl
    with open(idl_path) as fh:
        return Idl.from_json(fh.read())
