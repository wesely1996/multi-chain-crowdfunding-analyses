"""
evm_utils.py — Shared EVM helpers for the benchmark harness.

Imported by run_tests.py, throughput_test.py, and run_client_benchmark.py
to avoid repeating module-level imports and utility functions.
"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json, time

from web3 import Web3                        # single import at module level
from web3.middleware import geth_poa_middleware


def ms() -> int:
    """Current epoch time in milliseconds."""
    return int(time.time() * 1000)


def load_abi(artifact_path: Path) -> list:
    """Load ABI array from a Hardhat artifact JSON file."""
    with open(artifact_path) as f:
        return json.load(f)["abi"]


def send_tx(w3: Web3, tx: dict, signer) -> tuple[Any, int]:
    """Sign, send, and wait for receipt. Returns (receipt, latency_ms)."""
    t0 = ms()
    signed = w3.eth.account.sign_transaction(tx, signer.key)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return receipt, ms() - t0


def make_op_record(name: str, receipt: Any, latency: int,
                   scenario: str, variant: str, client: str, env: str) -> dict:
    """Build a schema-v2 operation record from an EVM receipt."""
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


def derive_account(index: int, mnemonic: str, w3: Web3):
    """Derive an HD wallet account at a given index."""
    w3.eth.account.enable_unaudited_hdwallet_features()
    return w3.eth.account.from_mnemonic(mnemonic, account_path=f"m/44'/60'/0'/0/{index}")
