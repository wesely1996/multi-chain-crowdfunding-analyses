"""
run_throughput_client.py — Isolated throughput benchmark via subprocess-driven clients.

Measures only the contribution phase: pre-creates all setup outside the timed
window, then runs N sequential contribute() subprocesses and measures total
wall-clock time (including subprocess startup per call — this is an intentional
overhead measurement distinguishing it from the Python harness where startup
cost is amortized across the session).

Usage
-----
    # EVM — ts-evm client
    python benchmarks/run_throughput_client.py \\
        --platform evm --client ts --variant V1 --env hardhat-localnet \\
        --deploy-json /tmp/evm_deploy.json

    # EVM — dotnet client
    python benchmarks/run_throughput_client.py \\
        --platform evm --client dotnet --variant V1 --env hardhat-localnet \\
        --deploy-json /tmp/evm_deploy.json

Output
------
  benchmarks/results/{VARIANT}_{CLIENT}_{ENV}_throughput.json

Notes
-----
- process_elapsed_ms per subprocess includes tsx/dotnet runtime startup.
- Compare to Python harness throughput which has no per-call startup cost.
- This measures realistic client throughput for applications that spawn
  one subprocess per transaction (e.g. CLI-driven scripts).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import statistics
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
# Also add repo root so `clients.python` resolves
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import config
from run_client_benchmark import (
    _run_ts,
    _run_dotnet,
    _run_python,
    _evm_setup_mint_tokens,
    _derive_evm_contributor_key,
)

SCHEMA_VERSION = "2"


# ---------------------------------------------------------------------------
# EVM throughput
# ---------------------------------------------------------------------------

def throughput_evm_client(client: str, variant: str, env_name: str, deploy_json: dict) -> dict:
    """Run N contribute() subprocesses sequentially and measure total time."""
    ts_dir = str(config.REPO_ROOT / "clients" / "ts")
    dotnet_dir = str(config.REPO_ROOT / "clients" / "dotnet")
    use_ts = client in ("ts", "ts-evm")
    use_python = client == "python"

    def _client_run(operation: str, extra_args: list[str], env: dict) -> tuple[dict, int]:
        if use_python:
            return _run_python(operation, extra_args, env, solana=False)
        elif use_ts:
            return _run_ts(operation, extra_args, env, ts_dir, solana=False)
        else:
            return _run_dotnet(operation, extra_args, env, dotnet_dir, solana=False)

    base_env = {
        **os.environ,
        "RPC_URL": config.EVM_RPC_URL,
        f"FACTORY_ADDRESS_{variant}": deploy_json["factory"],
        f"CAMPAIGN_ADDRESS_{variant}": deploy_json["campaign"],
        "PAYMENT_TOKEN_ADDRESS": deploy_json["mockERC20"],
        "CHAIN_ID": str(deploy_json.get("chain_id", 31337)),
    }

    # Setup: mint tokens (not timed)
    _evm_setup_mint_tokens(deploy_json)

    amount_str = str(config.CONTRIB_AMOUNT // (10 ** config.DECIMALS))
    print(f"\n[{client}] >>> TIMED: {config.N_CONTRIBUTIONS} sequential contribute() <<<")

    per_tx_records: list[dict] = []
    t_start = int(time.time() * 1000)

    for i in range(1, config.N_CONTRIBUTIONS + 1):
        contrib_key = _derive_evm_contributor_key(i)
        env = {**base_env, "PRIVATE_KEY": contrib_key}
        output, proc_ms = _client_run("contribute", ["--amount", amount_str], env)

        gas_used = (
            output.get("data", {}).get("contributeGasUsed")
            or output.get("gasUsed")
        )
        per_tx_records.append({
            "gas_used": gas_used,
            "cost": str(gas_used) if gas_used is not None else None,
            "latency_ms": output.get("elapsedMs"),
            "process_elapsed_ms": proc_ms,
        })
        if i % 10 == 0:
            print(f"  {i} / {config.N_CONTRIBUTIONS}")

    t_end = int(time.time() * 1000)
    total_ms = t_end - t_start
    tps = round(config.N_CONTRIBUTIONS / (total_ms / 1000), 4)

    costs = [r["gas_used"] for r in per_tx_records if r["gas_used"] is not None]
    latencies = [r["latency_ms"] for r in per_tx_records if r["latency_ms"] is not None]
    proc_times = [r["process_elapsed_ms"] for r in per_tx_records]

    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        chain_id = w3.eth.chain_id
    except Exception:
        chain_id = deploy_json.get("chain_id")

    client_label = "python" if use_python else ("ts" if use_ts else "dotnet")
    result = {
        "schema_version": SCHEMA_VERSION,
        "variant": variant,
        "variant_label": config.VARIANT_LABELS.get(variant, variant),
        "client": client_label,
        "client_label": config.CLIENT_LABELS.get(client_label, client_label),
        "environment": env_name,
        "platform": "EVM",
        "chain_id": chain_id,
        "timestamp_utc": int(time.time()),
        "limitations": [
            "Hardhat automines instantly; latency = local execution time only.",
            "process_elapsed_ms includes subprocess startup overhead (tsx/dotnet runtime init).",
            "ts-evm contribute.ts bundles approve+contribute gas; cost = contributeGasUsed only.",
        ],
        "operations": [
            {
                "name": "contribute",
                "scenario": "throughput",
                "gas_used": r["gas_used"],
                "cost": r["cost"],
                "latency_ms": r["latency_ms"],
                "process_elapsed_ms": r["process_elapsed_ms"],
                "tx_hash": None,
            }
            for r in per_tx_records
        ],
        "throughput": {
            "num_contributions": config.N_CONTRIBUTIONS,
            "total_time_ms": total_ms,
            "tps": tps,
            "per_tx_gas": {
                "avg": round(statistics.mean(costs), 2) if costs else None,
                "min": min(costs) if costs else None,
                "max": max(costs) if costs else None,
                "stdev": round(statistics.stdev(costs), 2) if len(costs) > 1 else 0.0,
            },
            "per_tx_latency_ms": {
                "avg": round(statistics.mean(latencies), 2) if latencies else None,
                "min": min(latencies) if latencies else None,
                "max": max(latencies) if latencies else None,
            },
            "per_tx_process_elapsed_ms": {
                "avg": round(statistics.mean(proc_times), 2) if proc_times else None,
                "min": min(proc_times) if proc_times else None,
                "max": max(proc_times) if proc_times else None,
            },
        },
    }

    print(f"\n[{client}] Throughput: {config.N_CONTRIBUTIONS} tx in {total_ms} ms → {tps} TPS")
    return result


# ---------------------------------------------------------------------------
# Solana throughput
# ---------------------------------------------------------------------------

def throughput_solana_client(client: str, variant: str, env_name: str) -> dict:
    """Run N Solana contribute() subprocesses sequentially and measure total time."""
    try:
        from anchorpy import Program, Provider, Wallet, Idl, Context
        from solana.rpc.async_api import AsyncClient
        from solana.rpc.commitment import Confirmed
        from solana.rpc.types import TxOpts
        from solders.keypair import Keypair
        from solders.pubkey import Pubkey
        from spl.token.async_client import AsyncToken as SPLAsyncToken
        from spl.token.constants import TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        from solders.sysvar import RENT
        from solders.system_program import ID as SYSTEM_PROGRAM_ID
        import asyncio
        import tempfile
    except ImportError as exc:
        sys.exit(f"[solana] Missing dependency: {exc}")

    import asyncio
    import tempfile

    ts_dir = str(config.REPO_ROOT / "clients" / "ts")
    dotnet_dir = str(config.REPO_ROOT / "clients" / "dotnet")
    use_ts = client in ("ts", "ts-solana")
    use_python = client == "python"

    def _client_run_sync(operation: str, extra_args: list[str], env: dict) -> tuple[dict, int]:
        if use_python:
            return _run_python(operation, extra_args, env, solana=True)
        elif use_ts:
            return _run_ts(operation, extra_args, env, ts_dir, solana=True)
        else:
            return _run_dotnet(operation, extra_args, env, dotnet_dir, solana=True)

    async def _run() -> dict:
        with open(config.SOLANA_WALLET_PATH) as fh:
            payer = Keypair.from_bytes(bytes(json.load(fh)))
        client_rpc = AsyncClient(config.SOLANA_RPC_URL, commitment=Confirmed)
        program_id = Pubkey.from_string(config.SOLANA_PROGRAM_ID)
        wallet_obj = Wallet(payer)
        from anchorpy import Provider as AnchorProvider
        provider = AnchorProvider(client_rpc, wallet_obj)
        with open(config.SOLANA_PY_IDL_PATH) as fh:
            idl = Idl.from_json(fh.read())
        program = Program(idl, program_id, provider)

        def _pda(seeds: list[bytes]) -> Pubkey:
            p, _ = Pubkey.find_program_address(seeds, program_id)
            return p

        # Setup
        print("[solana_setup] Airdrop + create mint + fund contributors...")
        await client_rpc.request_airdrop(payer.pubkey(), 100_000_000_000)
        await asyncio.sleep(2)

        payment_mint = await SPLAsyncToken.create_mint(
            client_rpc, payer, payer.pubkey(), 6, TOKEN_PROGRAM_ID
        )
        creator_kp = Keypair()
        contributors = [Keypair() for _ in range(config.N_CONTRIBUTIONS)]
        await client_rpc.request_airdrop(creator_kp.pubkey(), 10_000_000_000)
        for batch_start in range(0, len(contributors), 10):
            for c in contributors[batch_start:batch_start + 10]:
                await client_rpc.request_airdrop(c.pubkey(), 2_000_000_000)
            await asyncio.sleep(2)
        await asyncio.sleep(2)

        payment_atas: list[Pubkey] = []
        skip_opts = TxOpts(skip_confirmation=False, skip_preflight=True)
        for i, c in enumerate(contributors):
            ata = await payment_mint.create_account(c.pubkey())
            await payment_mint.mint_to(ata, payer, config.CONTRIB_AMOUNT, opts=skip_opts)
            payment_atas.append(ata)
            if (i + 1) % 10 == 0:
                await asyncio.sleep(1)
        await asyncio.sleep(1)

        import time as _t
        campaign_id_val = int(_t.time() * 1000) & 0xFFFFFFFF
        campaign_pda = _pda([b"campaign", bytes(creator_kp.pubkey()), campaign_id_val.to_bytes(8, "little")])
        vault_pda = _pda([b"vault", bytes(campaign_pda)])
        receipt_pda = _pda([b"receipt_mint", bytes(campaign_pda)])

        sig = await program.rpc["initialize_campaign"](
            campaign_id_val, config.SOFT_CAP, config.HARD_CAP,
            int(_t.time()) + config.DEADLINE_DAYS * 86400,
            bytes(config.MILESTONES),
            ctx=Context(
                accounts={
                    "creator": creator_kp.pubkey(), "campaign": campaign_pda,
                    "payment_mint": payment_mint.pubkey, "vault": vault_pda,
                    "receipt_mint": receipt_pda, "token_program": TOKEN_PROGRAM_ID,
                    "system_program": SYSTEM_PROGRAM_ID, "rent": RENT,
                },
                signers=[creator_kp],
            ),
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)

        receipt_spl = SPLAsyncToken(client_rpc, receipt_pda, TOKEN_PROGRAM_ID, payer)
        for c in contributors:
            await receipt_spl.create_account(c.pubkey())
        await asyncio.sleep(1)

        # Write keypairs to temp files
        contrib_kp_files: list[str] = []
        for c in contributors:
            tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
            json.dump(list(bytes(c)), tmp)
            tmp.close()
            contrib_kp_files.append(tmp.name)

        base_env = {
            **os.environ,
            "SOLANA_RPC_URL": config.SOLANA_RPC_URL,
            f"SOLANA_PROGRAM_ID_{variant}": config.SOLANA_PROGRAM_ID,
            "SOLANA_PAYMENT_MINT": str(payment_mint.pubkey),
            "SOLANA_CAMPAIGN_ADDRESS": str(campaign_pda),
            "SOLANA_CAMPAIGN_ID": str(campaign_id_val),
        }

        amount_str = str(config.CONTRIB_AMOUNT // (10 ** config.DECIMALS))
        print(f"\n[{client}] >>> TIMED: {config.N_CONTRIBUTIONS} sequential contribute() <<<")

        per_tx_records: list[dict] = []
        t_start = int(_t.time() * 1000)

        for i, c in enumerate(contributors):
            env = {**base_env, "SOLANA_KEYPAIR_PATH": contrib_kp_files[i]}
            output, proc_ms = _client_run_sync("contribute", ["--amount", amount_str], env)
            per_tx_records.append({
                "fee": output.get("gasUsed"),
                "latency_ms": output.get("elapsedMs"),
                "process_elapsed_ms": proc_ms,
            })
            if (i + 1) % 10 == 0:
                print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")

        t_end = int(_t.time() * 1000)
        await client_rpc.close()

        for f in contrib_kp_files:
            try:
                os.unlink(f)
            except Exception:
                pass

        total_ms = t_end - t_start
        tps = round(config.N_CONTRIBUTIONS / (total_ms / 1000), 4)
        fees = [r["fee"] for r in per_tx_records if r["fee"] is not None]
        latencies = [r["latency_ms"] for r in per_tx_records if r["latency_ms"] is not None]
        proc_times = [r["process_elapsed_ms"] for r in per_tx_records]

        client_label = "python" if use_python else ("ts" if use_ts else "dotnet")
        return {
            "schema_version": SCHEMA_VERSION,
            "variant": variant,
            "variant_label": config.VARIANT_LABELS.get(variant, variant),
            "client": client_label,
            "client_label": config.CLIENT_LABELS.get(client_label, client_label),
            "environment": env_name,
            "platform": "Solana",
            "chain_id": None,
            "timestamp_utc": int(_t.time()),
            "limitations": [
                "solana-test-validator is single-threaded; TPS does not represent production.",
                "process_elapsed_ms includes subprocess startup overhead.",
                "Fees are flat (5000 lam/signature).",
            ],
            "operations": [
                {
                    "name": "contribute",
                    "scenario": "throughput",
                    "compute_units": None,
                    "cost": str(r["fee"]) if r["fee"] is not None else None,
                    "latency_ms": r["latency_ms"],
                    "process_elapsed_ms": r["process_elapsed_ms"],
                    "tx_hash": None,
                }
                for r in per_tx_records
            ],
            "throughput": {
                "num_contributions": config.N_CONTRIBUTIONS,
                "total_time_ms": total_ms,
                "tps": tps,
                "per_tx_fee_lamports": {
                    "avg": round(statistics.mean(fees), 2) if fees else None,
                    "min": min(fees) if fees else None,
                    "max": max(fees) if fees else None,
                },
                "per_tx_latency_ms": {
                    "avg": round(statistics.mean(latencies), 2) if latencies else None,
                    "min": min(latencies) if latencies else None,
                    "max": max(latencies) if latencies else None,
                },
                "per_tx_process_elapsed_ms": {
                    "avg": round(statistics.mean(proc_times), 2) if proc_times else None,
                    "min": min(proc_times) if proc_times else None,
                    "max": max(proc_times) if proc_times else None,
                },
            },
        }

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Isolated throughput benchmark via subprocess-driven TS or .NET clients."
    )
    parser.add_argument("--platform", choices=["evm", "solana"], required=True)
    parser.add_argument("--client", choices=["ts", "dotnet", "python"], required=True)
    parser.add_argument("--variant", default=config.VARIANT)
    parser.add_argument("--env", default=None)
    parser.add_argument("--deploy-json", default=None,
                        help="Path to deploy_evm.py output JSON (required for --platform evm)")
    args = parser.parse_args()

    variant = args.variant
    env_name = args.env or config.BENCHMARK_ENV or config._infer_env(variant)

    if args.platform == "evm":
        if args.deploy_json:
            with open(args.deploy_json) as fh:
                deploy_json = json.load(fh)
        else:
            print(f"[info] --deploy-json not provided; auto-deploying variant={variant} env={env_name}...",
                  file=sys.stderr)
            from clients.python.evm.deploy import deploy as _evm_deploy
            deploy_json = _evm_deploy(variant, env_name)
        result = throughput_evm_client(args.client, variant, env_name, deploy_json)
    else:
        result = throughput_solana_client(args.client, variant, env_name)

    out_path = config.results_path(variant, result["client"], "throughput", env_name)
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"[output] {out_path}")


if __name__ == "__main__":
    main()
