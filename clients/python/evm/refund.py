"""
evm/refund.py -- Refund a contributor from a failed campaign.

Usage:
    python -m clients.python evm:refund
    python -m clients.python evm:refund --variant V3 --tier-id 0
"""

from __future__ import annotations

import argparse
import sys
import time

from clients.python.evm import config as evm_config
from clients.python.evm.client import get_web3, load_abi, get_account, build_and_send
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso


def refund(variant: str, tier_id: int | None = None) -> TxOutput:
    """Call refund() on the campaign contract."""
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

    if variant == "V3":
        tid = tier_id if tier_id is not None else 0
        refund_fn = campaign.functions.refund(tid)
    else:
        refund_fn = campaign.functions.refund()

    receipt, latency = build_and_send(w3, refund_fn, account, gas=200_000)

    return TxOutput(
        chain="evm",
        operation="refund",
        tx_hash=receipt["transactionHash"].hex(),
        block_number=receipt["blockNumber"],
        gas_used=receipt["gasUsed"],
        status="success" if receipt["status"] == 1 else "reverted",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Refund a contributor.")
    parser.add_argument("--variant", default=evm_config.VARIANT)
    parser.add_argument("--tier-id", type=int, default=None,
                        help="Tier ID for V3 ERC-1155 variant")
    parsed = parser.parse_args(args)

    try:
        output = refund(parsed.variant, tier_id=parsed.tier_id)
        print_result(output)
    except Exception as exc:
        print_error("refund", exc, chain="evm")


if __name__ == "__main__":
    main()
