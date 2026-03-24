"""
evm/contribute.py -- Contribute to a crowdfunding campaign.

V1/V2: approve + contribute(amount)
V3:    approve + contribute(tierId)

Usage:
    python -m clients.python evm:contribute --amount 10       # 10 USDC
    python -m clients.python evm:contribute --variant V3 --tier-id 0
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from clients.python.evm import config as evm_config
from clients.python.evm.client import get_web3, load_abi, load_artifact, get_account, build_and_send
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


def contribute(variant: str, amount: int | None = None, tier_id: int | None = None) -> TxOutput:
    """Approve and contribute. Returns TxOutput."""
    w3 = get_web3()
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to {evm_config.RPC_URL}")

    account = get_account()

    campaign_addr = evm_config.CAMPAIGN_ADDRESS
    if not campaign_addr:
        raise EnvironmentError("CAMPAIGN_ADDRESS env var is not set.")

    usdc_addr = evm_config.PAYMENT_TOKEN_ADDRESS
    if not usdc_addr:
        raise EnvironmentError("PAYMENT_TOKEN_ADDRESS env var is not set.")

    _, campaign_artifact_path, mock_erc20_artifact_path = evm_config.EVM_VARIANT_ARTIFACTS[variant]
    campaign_abi = load_abi(campaign_artifact_path)
    usdc_abi = load_abi(mock_erc20_artifact_path)

    campaign = w3.eth.contract(address=campaign_addr, abi=campaign_abi)
    usdc = w3.eth.contract(address=usdc_addr, abi=usdc_abi)

    # Determine contribution amount
    if variant == "V3":
        # V3: tier-based, amount is read from contract tier thresholds
        # approve a generous amount; the contract determines the exact amount per tier
        contrib_amount = evm_config.CONTRIB_AMOUNT
        tid = tier_id if tier_id is not None else 0
    else:
        contrib_amount = amount if amount is not None else evm_config.CONTRIB_AMOUNT
        tid = None

    # Approve
    approve_fn = usdc.functions.approve(campaign_addr, contrib_amount)
    approve_receipt, approve_latency = build_and_send(w3, approve_fn, account, gas=100_000)

    # Contribute
    t_start = time.time()
    if variant == "V3":
        contribute_fn = campaign.functions.contribute(tid)
    else:
        contribute_fn = campaign.functions.contribute(contrib_amount)

    receipt, latency = build_and_send(w3, contribute_fn, account, gas=300_000)

    return TxOutput(
        chain="evm",
        operation="contribute",
        tx_hash=receipt["transactionHash"].hex(),
        block_number=receipt["blockNumber"],
        gas_used=receipt["gasUsed"],
        status="success" if receipt["status"] == 1 else "reverted",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={
            "contributeGasUsed": receipt["gasUsed"],
            "contributeTxHash": receipt["transactionHash"].hex(),
            "approveGasUsed": approve_receipt["gasUsed"],
            "variant": variant,
        },
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Contribute to a campaign.")
    parser.add_argument("--variant", default=evm_config.VARIANT)
    parser.add_argument("--amount", type=float, default=10.0,
                        help="Contribution amount in USDC (ignored for V3)")
    parser.add_argument("--tier-id", type=int, default=None,
                        help="Tier ID for V3 ERC-1155 variant")
    parsed = parser.parse_args(args)

    try:
        output = contribute(
            variant=parsed.variant,
            amount=int(round(parsed.amount * 10 ** evm_config.DECIMALS)),
            tier_id=parsed.tier_id,
        )
        print_result(output)
    except Exception as exc:
        print_error("contribute", exc, chain="evm")


if __name__ == "__main__":
    main()
