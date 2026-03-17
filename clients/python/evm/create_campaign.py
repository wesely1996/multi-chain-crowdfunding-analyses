"""
evm/create_campaign.py -- Create a new crowdfunding campaign via the Factory.

Usage:
    python -m clients.python evm:create_campaign --variant V1
    python -m clients.python evm:create_campaign --variant V3 --soft-cap 100000000 --hard-cap 500000000
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from clients.python.evm import config as evm_config
from clients.python.evm.client import get_web3, load_artifact, get_account, build_and_send
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


def create_campaign(
    variant: str,
    soft_cap: int,
    hard_cap: int,
    deadline_days: int,
    milestones: list[int],
) -> TxOutput:
    """Create a campaign and return TxOutput."""
    w3 = get_web3()
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to {evm_config.RPC_URL}")

    deployer = get_account()

    factory_artifact_path, _, mock_erc20_artifact_path = evm_config.EVM_VARIANT_ARTIFACTS[variant]
    if not factory_artifact_path.exists():
        raise FileNotFoundError(f"Factory artifact not found: {factory_artifact_path}")

    factory_art = load_artifact(factory_artifact_path)
    factory_addr = evm_config.FACTORY_ADDRESS
    if not factory_addr:
        raise EnvironmentError("FACTORY_ADDRESS env var is not set. Deploy first.")

    factory = w3.eth.contract(address=factory_addr, abi=factory_art["abi"])
    usdc_addr = evm_config.PAYMENT_TOKEN_ADDRESS
    if not usdc_addr:
        raise EnvironmentError("PAYMENT_TOKEN_ADDRESS env var is not set.")

    block_ts = w3.eth.get_block("latest")["timestamp"]
    deadline = block_ts + deadline_days * 86400

    if variant == "V3":
        create_fn = factory.functions.createCampaign(
            usdc_addr, soft_cap, hard_cap, deadline, milestones,
            [evm_config.CONTRIB_AMOUNT] * 3, ["A", "B", "C"], "",
        )
    else:
        create_fn = factory.functions.createCampaign(
            usdc_addr, soft_cap, hard_cap, deadline, milestones,
            "Bench Token", "BT",
        )

    t_start = time.time()
    receipt, latency = build_and_send(w3, create_fn, deployer, gas=5_000_000)

    event_name = evm_config.EVM_CAMPAIGN_CREATED_EVENT[variant]
    logs = factory.events[event_name]().process_receipt(receipt)
    campaign_addr = logs[0]["args"]["campaign"]

    return TxOutput(
        chain="evm",
        operation="create_campaign",
        tx_hash=receipt["transactionHash"].hex(),
        block_number=receipt["blockNumber"],
        gas_used=receipt["gasUsed"],
        status="success" if receipt["status"] == 1 else "reverted",
        timestamp=_now_iso(),
        elapsed_ms=latency,
        data={"campaign": campaign_addr, "variant": variant},
    )


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Create a crowdfunding campaign.")
    parser.add_argument("--variant", default=evm_config.VARIANT)
    parser.add_argument("--soft-cap", type=int, default=evm_config.SOFT_CAP)
    parser.add_argument("--hard-cap", type=int, default=evm_config.HARD_CAP)
    parser.add_argument("--deadline-days", type=int, default=evm_config.DEADLINE_DAYS)
    parsed = parser.parse_args(args)

    try:
        output = create_campaign(
            variant=parsed.variant,
            soft_cap=parsed.soft_cap,
            hard_cap=parsed.hard_cap,
            deadline_days=parsed.deadline_days,
            milestones=evm_config.MILESTONES,
        )
        print_result(output)
    except Exception as exc:
        print_error("create_campaign", exc, chain="evm")


if __name__ == "__main__":
    main()
