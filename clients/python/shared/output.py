"""
shared/output.py -- Structured JSON output for the Python client.

Mirrors the TxOutput interface from clients/ts/src/shared/output.ts
and the .NET equivalent, ensuring all three clients produce identical
JSON schemas for benchmark aggregation.
"""

from __future__ import annotations

import dataclasses
import json
import sys
import time
from typing import Any, Literal, Optional


@dataclasses.dataclass
class TxOutput:
    chain: Literal["evm", "solana"]
    operation: str
    tx_hash: Optional[str]
    block_number: Optional[int]
    gas_used: Optional[int]   # gas units (EVM) or lamports (Solana)
    status: Literal["success", "reverted"]
    timestamp: str            # ISO-8601
    elapsed_ms: int
    data: dict[str, Any]


def print_result(output: TxOutput) -> None:
    """Print TxOutput as camelCase JSON to stdout (matches TS/dotnet contract)."""
    d = {
        "chain": output.chain,
        "operation": output.operation,
        "txHash": output.tx_hash,
        "blockNumber": output.block_number,
        "gasUsed": output.gas_used,
        "status": output.status,
        "timestamp": output.timestamp,
        "elapsedMs": output.elapsed_ms,
        "data": output.data,
    }
    print(json.dumps(d))


def print_error(operation: str, err: Exception, chain: str = "evm") -> None:
    """Print error JSON to stderr, then exit 1."""
    d = {
        "chain": chain,
        "operation": operation,
        "status": "error",
        "error": str(err),
        "timestamp": _now_iso(),
    }
    print(json.dumps(d), file=sys.stderr)
    sys.exit(1)


def ms(start: float = 0.0) -> int:
    """
    If start == 0, return current epoch time in milliseconds (legacy behaviour
    matching evm_utils.ms() and solana_utils.ms()).

    If start > 0, return elapsed milliseconds since `start` (from time.time()).
    """
    now = int(time.time() * 1000)
    if start == 0.0:
        return now
    return now - int(start * 1000) if start < 1e12 else now - int(start)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
