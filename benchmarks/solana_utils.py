"""
solana_utils.py — Shared Solana helpers for the benchmark harness.

Imported by run_tests.py and throughput_test.py.
"""

from __future__ import annotations
from typing import Any
import time


async def airdrop_and_wait(client, pubkey, lamports: int, sleep_s: float = 2.0) -> None:
    """Request airdrop and wait for confirmation."""
    await client.request_airdrop(pubkey, lamports)
    import asyncio; await asyncio.sleep(sleep_s)


def find_pda(seeds: list[bytes], program_id) -> Any:
    """Thin wrapper around Pubkey.find_program_address."""
    from solders.pubkey import Pubkey
    addr, _ = Pubkey.find_program_address(seeds, program_id)
    return addr


def ms() -> int:
    return int(time.time() * 1000)


def make_op_record(name: str, sig: str, fee: int, latency: int,
                   scenario: str, variant: str, client: str, env: str) -> dict:
    """Build a schema-v2 operation record from a Solana transaction."""
    return {
        "operation": name,
        "fee_lamports": fee,
        "signature": sig,
        "latency_ms": latency,
        "scenario": scenario,
        "variant": variant,
        "client": client,
        "env": env,
    }
