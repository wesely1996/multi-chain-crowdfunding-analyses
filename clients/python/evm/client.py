"""
evm/client.py -- Core EVM helpers for the Python client.

Migrated from benchmarks/evm_utils.py. Contains only client-level
concerns (RPC connection, ABI loading, tx signing). Benchmark-specific
helpers (make_op_record) remain in the benchmark scripts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from clients.python.shared.output import ms


def get_web3(rpc_url: str | None = None):
    """Return a Web3 instance connected to rpc_url, with PoA middleware injected."""
    from web3 import Web3
    from web3.middleware import geth_poa_middleware

    from clients.python.evm.config import RPC_URL

    url = rpc_url or RPC_URL
    w3 = Web3(Web3.HTTPProvider(url))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    return w3


def load_abi(artifact_path: Path) -> list:
    """Load ABI array from a Hardhat artifact JSON file."""
    with open(artifact_path) as f:
        return json.load(f)["abi"]


def load_artifact(artifact_path: Path) -> dict:
    """Load the full Hardhat artifact JSON (abi + bytecode)."""
    with open(artifact_path) as f:
        return json.load(f)


def derive_account(index: int, mnemonic: str, w3=None):
    """Derive an HD wallet account at a given BIP-44 index."""
    from eth_account import Account
    Account.enable_unaudited_hdwallet_features()
    return Account.from_mnemonic(mnemonic, account_path=f"m/44'/60'/0'/0/{index}")


def get_account(private_key: str | None = None, mnemonic: str | None = None, index: int = 0):
    """
    Return an Account from an explicit private key or HD derivation.
    Tries PRIVATE_KEY env first, then mnemonic derivation.
    """
    from eth_account import Account
    from clients.python.evm.config import PRIVATE_KEY, MNEMONIC

    pk = private_key or PRIVATE_KEY
    if pk:
        return Account.from_key(pk)

    m = mnemonic or MNEMONIC
    Account.enable_unaudited_hdwallet_features()
    return Account.from_mnemonic(m, account_path=f"m/44'/60'/0'/0/{index}")


def send_tx(w3, tx: dict, signer) -> tuple[Any, int]:
    """Sign, send, and wait for receipt. Returns (receipt, latency_ms)."""
    t0 = ms()
    signed = w3.eth.account.sign_transaction(tx, signer.key)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return receipt, ms() - t0


def build_and_send(w3, fn, sender, gas: int = 300_000) -> tuple[Any, int]:
    """Build a transaction from a contract function call, sign, send, wait. Returns (receipt, latency_ms)."""
    tx = fn.build_transaction({
        "from": sender.address,
        "nonce": w3.eth.get_transaction_count(sender.address),
        "gas": gas,
        "gasPrice": w3.eth.gas_price,
    })
    return send_tx(w3, tx, sender)
