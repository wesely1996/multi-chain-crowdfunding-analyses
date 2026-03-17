"""
evm/finalize.py -- Finalize a crowdfunding campaign.

Usage:
    python -m clients.python evm:finalize
"""

from __future__ import annotations

import argparse
import sys
import time

from clients.python.evm import config as evm_config
from clients.python.evm.client import get_web3, load_abi, get_account, build_and_send
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso


def finalize(variant: str) -> TxOutput:
    """Call finalize() on the campaign contract."""
    w3 = get_web3()
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to {evm_config.RPC_URL}")

    account = get_account()

    campaign_addr = evm_config.CAMPAIGN_ADDRESS
    if not campaign_addr:
        raise EnvironmentError("CAMPAIGN_ADDRESS env var is not set.")

    _, campaign_artifact_path, _ = evm_config.EVM_VARIANT_ARTIFACTS[variant]
    campaign_abi = load_abi(campaign_artifact_path)
    campaign = w3.eth.contract(address=campaign_addr, abi=campaign_abi)

    receipt, latency = build_and_send(w3, campaign.functions.finalize(), account, gas=200_000)

    return TxOutput(
        chain="evm",
        operation="finalize",
        tx_hash=receipt["transactionHash"].hex(),
        block_number=receipt["blockNumber"],
        gas_used=receipt["gasUsed"],
        status="success" if receipt["status"] == 1 else "reverted",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Finalize a campaign.")
    parser.add_argument("--variant", default=evm_config.VARIANT)
    parsed = parser.parse_args(args)

    try:
        output = finalize(parsed.variant)
        print_result(output)
    except Exception as exc:
        print_error("finalize", exc, chain="evm")


if __name__ == "__main__":
    main()
