"""
evm/deploy.py -- Deploy EVM contracts (MockERC20, Factory, Campaign).

Migrated from benchmarks/deploy_evm.py. Preserves ALL existing logic.
The benchmarks/deploy_evm.py file is now a thin shim that imports from here.

Usage (standalone):
    python -m clients.python evm:deploy --variant V1
    python -m clients.python evm:deploy --variant V1 --env hardhat-localnet
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

from clients.python.evm import config as evm_config
from clients.python.shared.output import TxOutput, print_result, print_error, _now_iso, ms


def deploy(variant: str, env_name: str) -> dict:
    """Deploy contracts and return address dict."""
    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        from eth_account import Account
    except ImportError as exc:
        sys.exit(f"[deploy_evm] Missing dependency: {exc}. Run: pip install -r clients/python/requirements.txt")

    if variant not in evm_config.EVM_VARIANT_ARTIFACTS:
        sys.exit(
            f"[deploy_evm] Unknown variant '{variant}'. "
            f"Available: {list(evm_config.EVM_VARIANT_ARTIFACTS)}"
        )

    factory_artifact, campaign_artifact, mock_erc20_artifact = evm_config.EVM_VARIANT_ARTIFACTS[variant]

    # Check artifacts exist
    for p in (factory_artifact, campaign_artifact, mock_erc20_artifact):
        if not p.exists():
            sys.exit(
                f"[deploy_evm] Artifact not found: {p}\n"
                "Run: cd contracts/evm && npx hardhat compile"
            )

    rpc_url = evm_config.RPC_URL
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)

    if not w3.is_connected():
        sys.exit(
            f"[deploy_evm] Cannot connect to {rpc_url}.\n"
            "Start: cd contracts/evm && npx hardhat node"
        )

    # Use explicit private key if set (for testnet), otherwise derive from mnemonic
    raw_pk = evm_config.PRIVATE_KEY
    if raw_pk:
        deployer = Account.from_key(raw_pk)
    else:
        Account.enable_unaudited_hdwallet_features()
        deployer = Account.from_mnemonic(evm_config.MNEMONIC, account_path="m/44'/60'/0'/0/0")

    def _load_artifact(path: pathlib.Path) -> dict:
        with open(path) as fh:
            return json.load(fh)

    def _deploy_contract(abi: list, bytecode: str, *args, gas: int = 3_000_000) -> str:
        contract = w3.eth.contract(abi=abi, bytecode=bytecode)
        tx = contract.constructor(*args).build_transaction({
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": gas,
            "gasPrice": w3.eth.gas_price,
        })
        signed = deployer.sign_transaction(tx)
        receipt = w3.eth.wait_for_transaction_receipt(
            w3.eth.send_raw_transaction(signed.rawTransaction)
        )
        return receipt["contractAddress"]

    print(f"[deploy_evm] Deploying variant={variant} on {env_name} ({rpc_url})",
          file=sys.stderr)

    # -- MockERC20 --
    print("[deploy_evm] Deploying MockERC20...", file=sys.stderr)
    usdc_art = _load_artifact(mock_erc20_artifact)
    usdc_addr = _deploy_contract(usdc_art["abi"], usdc_art["bytecode"], "Mock USDC", "USDC")
    print(f"[deploy_evm] MockERC20: {usdc_addr}", file=sys.stderr)

    # -- CrowdfundingFactory --
    print("[deploy_evm] Deploying CrowdfundingFactory...", file=sys.stderr)
    factory_art = _load_artifact(factory_artifact)
    factory_addr = _deploy_contract(factory_art["abi"], factory_art["bytecode"], gas=8_000_000)
    print(f"[deploy_evm] Factory: {factory_addr}", file=sys.stderr)

    # -- Create campaign --
    print("[deploy_evm] Creating campaign...", file=sys.stderr)
    factory = w3.eth.contract(address=factory_addr, abi=factory_art["abi"])
    block_ts = w3.eth.get_block("latest")["timestamp"]
    deadline = block_ts + evm_config.DEADLINE_DAYS * 86400

    if variant == "V3":
        create_fn = factory.functions.createCampaign(
            usdc_addr,
            evm_config.SOFT_CAP,
            evm_config.HARD_CAP,
            deadline,
            evm_config.MILESTONES,
            [evm_config.CONTRIB_AMOUNT] * 3,
            ["A", "B", "C"],
            "",
        )
    else:
        create_fn = factory.functions.createCampaign(
            usdc_addr,
            evm_config.SOFT_CAP,
            evm_config.HARD_CAP,
            deadline,
            evm_config.MILESTONES,
            "Bench Token",
            "BT",
        )
    tx = create_fn.build_transaction({
        "from": deployer.address,
        "nonce": w3.eth.get_transaction_count(deployer.address),
        "gas": 5_000_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed = deployer.sign_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_raw_transaction(signed.rawTransaction)
    )
    event_name = evm_config.EVM_CAMPAIGN_CREATED_EVENT[variant]
    logs = factory.events[event_name]().process_receipt(receipt)
    campaign_addr = logs[0]["args"]["campaign"]
    print(f"[deploy_evm] Campaign: {campaign_addr}", file=sys.stderr)

    return {
        "variant": variant,
        "environment": env_name,
        "rpc_url": rpc_url,
        "chain_id": w3.eth.chain_id,
        "deployer": deployer.address,
        "mockERC20": usdc_addr,
        "factory": factory_addr,
        "campaign": campaign_addr,
    }


def _infer_env(variant: str) -> str:
    """Infer environment label from RPC URL."""
    rpc = evm_config.RPC_URL
    if "infura" in rpc or "alchemy" in rpc or "sepolia" in rpc or "11155111" in rpc:
        return "sepolia"
    return "hardhat-localnet"


def main(args=None) -> None:
    parser = argparse.ArgumentParser(
        description="Deploy EVM contracts and print addresses as JSON to stdout."
    )
    parser.add_argument(
        "--variant",
        default=evm_config.VARIANT,
        help="Contract variant: V1 (default), V2, V3",
    )
    parser.add_argument(
        "--env",
        default=os.getenv("BENCHMARK_ENV", "") or None,
        help="Environment label for the JSON output (e.g. hardhat-localnet, sepolia)",
    )
    parsed = parser.parse_args(args)

    env_name = parsed.env or _infer_env(parsed.variant)

    try:
        result = deploy(parsed.variant, env_name)
        # stdout = JSON (consumed by shell scripts / run_client_benchmark.py)
        print(json.dumps(result, indent=2))
    except Exception as exc:
        print_error("deploy", exc, chain="evm")


if __name__ == "__main__":
    main()
