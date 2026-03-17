"""
evm_utils.py -- Thin re-export shim for backward compatibility.

All client logic has been moved to clients/python/evm/client.py.
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
from clients.python.evm.client import (  # noqa: E402, F401
    get_web3,
    load_abi,
    load_artifact,
    derive_account,
    get_account,
    send_tx,
    build_and_send,
)

from typing import Any


def make_op_record(name: str, receipt: Any, latency: int,
                   scenario: str, variant: str, client: str, env: str) -> dict:
    """Build a schema-v2 operation record from an EVM receipt.

    This is a benchmark concern (result schema construction), not a client
    concern, so it stays in the benchmark layer.
    """
    return {
        "operation": name,
        "gas_used": receipt.gasUsed,
        "status": receipt.status,
        "latency_ms": latency,
        "scenario": scenario,
        "variant": variant,
        "client": client,
        "env": env,
    }
