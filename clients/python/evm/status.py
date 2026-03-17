"""
evm/status.py -- Read campaign state (no transaction).

Usage:
    python -m clients.python evm:status
"""

from __future__ import annotations

import argparse
import json
import sys

from clients.python.evm import config as evm_config
from clients.python.evm.client import get_web3, load_abi, get_account
from clients.python.shared.output import _now_iso, print_error


def status(variant: str) -> dict:
    """Read and return campaign state as a dict."""
    w3 = get_web3()
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to {evm_config.RPC_URL}")

    campaign_addr = evm_config.CAMPAIGN_ADDRESS
    if not campaign_addr:
        raise EnvironmentError("CAMPAIGN_ADDRESS env var is not set.")

    _, campaign_artifact_path, _ = evm_config.EVM_VARIANT_ARTIFACTS[variant]
    campaign_abi = load_abi(campaign_artifact_path)
    campaign = w3.eth.contract(address=campaign_addr, abi=campaign_abi)

    # Read common state variables (present in all variants)
    try:
        total_raised = campaign.functions.totalRaised().call()
    except Exception:
        total_raised = None

    try:
        finalized = campaign.functions.finalized().call()
    except Exception:
        finalized = None

    try:
        soft_cap = campaign.functions.softCap().call()
    except Exception:
        soft_cap = None

    try:
        hard_cap = campaign.functions.hardCap().call()
    except Exception:
        hard_cap = None

    try:
        deadline = campaign.functions.deadline().call()
    except Exception:
        deadline = None

    try:
        current_milestone = campaign.functions.currentMilestone().call()
    except Exception:
        current_milestone = None

    return {
        "chain": "evm",
        "operation": "status",
        "variant": variant,
        "campaign": campaign_addr,
        "totalRaised": total_raised,
        "finalized": finalized,
        "softCap": soft_cap,
        "hardCap": hard_cap,
        "deadline": deadline,
        "currentMilestone": current_milestone,
        "timestamp": _now_iso(),
    }


def main(args=None) -> None:
    parser = argparse.ArgumentParser(description="Read campaign state.")
    parser.add_argument("--variant", default=evm_config.VARIANT)
    parsed = parser.parse_args(args)

    try:
        result = status(parsed.variant)
        print(json.dumps(result))
    except Exception as exc:
        print_error("status", exc, chain="evm")


if __name__ == "__main__":
    main()
