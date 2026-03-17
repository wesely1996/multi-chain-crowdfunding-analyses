"""
solana_utils.py -- Thin re-export shim for backward compatibility.

All client logic has been moved to clients/python/solana/client.py.
This file re-exports the public API so existing benchmark scripts
(run_tests.py, throughput_test.py) continue to work without changes
to their internal import paths.

make_op_record() remains here because it is a benchmark-specific
concern (schema-v2 result record construction), not a client concern.
"""

import sys
import pathlib

# Allow imports from repo root so `clients.python` resolves
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from clients.python.shared.output import ms  # noqa: E402, F401
from clients.python.solana.client import (  # noqa: E402, F401
    find_pda,
    airdrop_and_wait,
    send_and_confirm,
    get_fee,
    get_client,
    load_keypair,
)


def make_op_record(name: str, sig: str, fee: int, latency: int,
                   scenario: str, variant: str, client: str, env: str) -> dict:
    """Build a schema-v2 operation record from a Solana transaction.

    This is a benchmark concern (result schema construction), not a client
    concern, so it stays in the benchmark layer.
    """
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
