"""
run_client_benchmark.py — Full lifecycle benchmark via subprocess-driven TS or .NET clients.

Drives npm run <op> (ts-evm/ts-solana) or dotnet run -- <op> (dotnet) as subprocesses,
parses their TxOutput JSON stdout, and assembles a canonical schema_version "2" result file.

Usage
-----
    # EVM — ts-evm client, V1, hardhat-localnet
    python benchmarks/run_client_benchmark.py \
        --platform evm --client ts --variant V1 --env hardhat-localnet

    # EVM — dotnet client, V1, hardhat-localnet
    python benchmarks/run_client_benchmark.py \
        --platform evm --client dotnet --variant V1 --env hardhat-localnet

    # Solana — ts-solana client, V4, solana-localnet
    python benchmarks/run_client_benchmark.py \
        --platform solana --client ts --variant V4 --env solana-localnet

    # Sepolia (requires EVM_PRIVATE_KEY and EVM_RPC_URL set)
    EVM_RPC_URL=https://sepolia.infura.io/v3/KEY \
    python benchmarks/run_client_benchmark.py \
        --platform evm --client ts --variant V1 --env sepolia

Output
------
  benchmarks/results/{VARIANT}_{CLIENT}_{ENV}_lifecycle_{TIMESTAMP}.json
where TIMESTAMP is a Unix epoch integer (seconds).  Multiple runs accumulate
as separate timestamped files; use benchmarks/collect_metrics.py to compare.

Cross-client consistency note
------------------------------
  ts-evm contribute.ts bundles approve + contribute gas in its top-level gasUsed.
  This script reads data.contributeGasUsed for the actual contribute gas so
  all clients report the same on-chain value for cross-client comparison.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

# Allow running from repo root
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
# Also add repo root so `clients.python` resolves
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import config

SCHEMA_VERSION = "2"


def _evm_account_from_index(index: int, seed: bytes | None = None):
    """Derive Hardhat HD account at BIP-44 index. Pass pre-computed seed to avoid
    repeated PBKDF2 calls when deriving multiple accounts."""
    from eth_account import Account as _Acct
    from eth_account.hdaccount import key_from_seed, seed_from_mnemonic as _sfm
    _Acct.enable_unaudited_hdwallet_features()
    if seed is None:
        seed = _sfm(config.EVM_MNEMONIC, "")
    return _Acct.from_key(key_from_seed(seed, f"m/44'/60'/0'/0/{index}")), seed


def _evm_seed():
    from eth_account.hdaccount import seed_from_mnemonic as _sfm
    return _sfm(config.EVM_MNEMONIC, "")

# ---------------------------------------------------------------------------
# Subprocess runner helpers
# ---------------------------------------------------------------------------

def _run_subprocess(cmd: list[str], env: dict, cwd: str, timeout: int = 120) -> tuple[dict, int]:
    """
    Run a subprocess, capture stdout, parse JSON, return (parsed_output, process_elapsed_ms).
    Exits with an error message if the subprocess fails or stdout is not valid JSON.
    """
    # On Windows, executables like npm/npx/dotnet are .cmd shims and require shell=True.
    use_shell = sys.platform == "win32"
    t0 = time.perf_counter_ns()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            cwd=cwd,
            timeout=timeout,
            shell=use_shell,
        )
    except subprocess.TimeoutExpired:
        sys.exit(f"[client] Timeout after {timeout}s running: {' '.join(cmd)}")

    process_elapsed_ms = (time.perf_counter_ns() - t0) // 1_000_000

    if result.returncode != 0:
        # Try to parse error JSON from stderr
        try:
            err = json.loads(result.stderr)
        except Exception:
            err = {"error": result.stderr.strip() or result.stdout.strip()}
        sys.exit(
            f"[client] Command failed (exit {result.returncode}): {' '.join(cmd)}\n"
            f"  stderr: {err}"
        )

    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        sys.exit(
            f"[client] Failed to parse JSON stdout from: {' '.join(cmd)}\n"
            f"  stdout: {result.stdout[:500]!r}\n"
            f"  error: {exc}"
        )

    parsed["process_elapsed_ms"] = process_elapsed_ms
    return parsed, process_elapsed_ms


def _run_ts(operation: str, extra_args: list[str], env: dict, ts_dir: str, solana: bool = False) -> tuple[dict, int]:
    """Run a ts-evm npm script and return (TxOutput, process_elapsed_ms)."""
    npm_script = f"sol:{operation}" if solana else operation
    cmd = ["npm", "run", "--silent", npm_script, "--", *extra_args]
    return _run_subprocess(cmd, env, ts_dir)


def _run_dotnet(operation: str, extra_args: list[str], env: dict, dotnet_dir: str, solana: bool = False) -> tuple[dict, int]:
    """Run a dotnet client command and return (TxOutput, process_elapsed_ms)."""
    cmd_name = f"sol:{operation}" if solana else operation
    cmd = ["dotnet", "run", "--", cmd_name, *extra_args]
    return _run_subprocess(cmd, env, dotnet_dir)


def _run_python(operation: str, extra_args: list[str], env: dict, solana: bool = False) -> tuple[dict, int]:
    """Run a Python client command and return (TxOutput, process_elapsed_ms)."""
    cmd_op = f"sol:{operation}" if solana else f"evm:{operation}"
    cmd = [sys.executable, "-m", "clients.python", cmd_op, *extra_args]
    return _run_subprocess(cmd, env, str(config.REPO_ROOT))


# ---------------------------------------------------------------------------
# EVM benchmarks
# ---------------------------------------------------------------------------

def _evm_setup_mint_tokens(deploy_json: dict) -> None:
    """
    Use web3.py to mint tokens to all contributor accounts (setup — not timed).
    This is required because the TS/dotnet clients don't perform minting themselves.
    """
    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        from eth_account import Account
    except ImportError as exc:
        sys.exit(f"[evm_setup] Missing dependency: {exc}")

    w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)

    raw_pk = os.getenv("EVM_PRIVATE_KEY", "")
    _hd_seed = None
    if raw_pk:
        deployer = Account.from_key(raw_pk)
    else:
        deployer, _hd_seed = _evm_account_from_index(0)

    variant = deploy_json["variant"]
    _, _, mock_erc20_artifact = config.EVM_VARIANT_ARTIFACTS[variant]
    with open(mock_erc20_artifact) as fh:
        usdc_abi = json.load(fh)["abi"]

    usdc = w3.eth.contract(address=deploy_json["mockERC20"], abi=usdc_abi)

    def _send(tx: dict, signer) -> None:
        tx.setdefault("gas", 200_000)
        tx["nonce"] = w3.eth.get_transaction_count(signer.address)
        signed = signer.sign_transaction(tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))

    n_total = config.N_CONTRIBUTIONS + 5  # success contributors + refund contributors
    print(f"[evm_setup] Minting tokens to {n_total} contributor accounts...")
    _setup_seed = _evm_seed()
    for i in range(1, n_total + 1):
        acc, _ = _evm_account_from_index(i, _setup_seed)
        _send(usdc.functions.mint(acc.address, config.CONTRIB_AMOUNT * 2).build_transaction({
            "from": deployer.address,
        }), deployer)
        if i % 10 == 0:
            print(f"  {i} / {n_total}")

    print("[evm_setup] Token minting complete.")


def _derive_evm_contributor_key(index: int) -> str:
    """Derive Hardhat account private key at index (1-based)."""
    acc, _ = _evm_account_from_index(index)
    return acc.key.hex()


def run_evm_lifecycle(client: str, variant: str, env_name: str, deploy_json: dict) -> dict:
    """Run full EVM lifecycle via ts or dotnet client subprocesses."""

    # Determine client directory and runner
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

    # Base env for the client (inherits current process env so dotnet/npm can find tools)
    base_env = {**os.environ}
    base_env.update({
        "RPC_URL": config.EVM_RPC_URL,
        f"FACTORY_ADDRESS_{variant}": deploy_json["factory"],
        f"CAMPAIGN_ADDRESS_{variant}": deploy_json["campaign"],
        "PAYMENT_TOKEN_ADDRESS": deploy_json["mockERC20"],
        "CHAIN_ID": str(deploy_json.get("chain_id", 31337)),
        "VARIANT": variant,
    })

    deployer_key = os.getenv("EVM_PRIVATE_KEY") or _derive_evm_contributor_key(0)
    operations: list[dict] = []

    # ── Setup: mint tokens to contributors ────────────────────────────────────
    _evm_setup_mint_tokens(deploy_json)

    # ── SUCCESS PATH: 50 × contribute ─────────────────────────────────────────
    print(f"\n[{client}] --- SUCCESS PATH ---")
    print(f"[{client}] Running {config.N_CONTRIBUTIONS} timed contribute() calls...")
    amount_str = str(config.CONTRIB_AMOUNT // (10 ** config.DECIMALS))  # in token units

    for i in range(1, config.N_CONTRIBUTIONS + 1):
        contrib_key = _derive_evm_contributor_key(i)
        env = {**base_env, "PRIVATE_KEY": contrib_key}

        if variant == "V3":
            contrib_extra_args = ["--tier-id", "0"]
        else:
            contrib_extra_args = ["--amount", amount_str]
        output, proc_ms = _client_run(
            "contribute",
            contrib_extra_args,
            env,
        )

        # ts-evm bundles approve gas; use data.contributeGasUsed for parity
        gas_used = (
            output.get("data", {}).get("contributeGasUsed")
            or output.get("gasUsed")
        )
        operations.append({
            "name": "contribute",
            "scenario": "success",
            "gas_used": gas_used,
            "cost": str(gas_used) if gas_used is not None else None,
            "latency_ms": output.get("elapsedMs"),
            "process_elapsed_ms": proc_ms,
            "tx_hash": output.get("data", {}).get("contributeTxHash") or output.get("txHash"),
        })
        if i % 10 == 0:
            print(f"  {i} / {config.N_CONTRIBUTIONS}")

    # ── Advance time past deadline (hardhat only) ────────────────────────────
    if "localnet" in env_name or "hardhat" in env_name:
        try:
            from web3 import Web3
            from web3.middleware import geth_poa_middleware
            w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            w3.provider.make_request("evm_increaseTime", [config.DEADLINE_DAYS * 86400 + 1])
            w3.provider.make_request("evm_mine", [])
        except Exception as exc:
            print(f"[warn] evm_increaseTime failed: {exc}", file=sys.stderr)

    # ── finalize ──────────────────────────────────────────────────────────────
    print(f"[{client}] finalize()...")
    env = {**base_env, "PRIVATE_KEY": deployer_key}
    output, proc_ms = _client_run("finalize", [], env)
    operations.append({
        "name": "finalize",
        "scenario": "success",
        "gas_used": output.get("gasUsed"),
        "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
        "latency_ms": output.get("elapsedMs"),
        "process_elapsed_ms": proc_ms,
        "tx_hash": output.get("txHash"),
    })

    # ── withdrawMilestone × 3 ────────────────────────────────────────────────
    for m in range(len(config.MILESTONES)):
        print(f"[{client}] withdraw() #{m}...")
        output, proc_ms = _client_run("withdraw", [], env)
        operations.append({
            "name": f"withdrawMilestone_{m}",
            "scenario": "success",
            "gas_used": output.get("gasUsed"),
            "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
            "latency_ms": output.get("elapsedMs"),
            "process_elapsed_ms": proc_ms,
            "tx_hash": output.get("txHash"),
        })

    # ── REFUND PATH ───────────────────────────────────────────────────────────
    # Deploy a new campaign with unreachable softCap for refund testing
    print(f"\n[{client}] --- REFUND PATH ---")
    print(f"[{client}] Deploying refund campaign...")

    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        from eth_account import Account
        w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)

        deployer, _refund_seed = _evm_account_from_index(0)
        _, _, mock_erc20_artifact = config.EVM_VARIANT_ARTIFACTS[variant]
        factory_artifact, _, _ = config.EVM_VARIANT_ARTIFACTS[variant]

        with open(factory_artifact) as fh:
            factory_abi = json.load(fh)["abi"]
        factory = w3.eth.contract(address=deploy_json["factory"], abi=factory_abi)
        block_ts = w3.eth.get_block("latest")["timestamp"]
        deadline = block_ts + config.DEADLINE_DAYS * 86400

        def _send_deployer(call) -> dict:
            tx = call.build_transaction({
                "from": deployer.address,
                "nonce": w3.eth.get_transaction_count(deployer.address),
                "gas": 5_000_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = deployer.sign_transaction(tx)
            return w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))

        if variant == "V3":
            refund_create_fn = factory.functions.createCampaign(
                deploy_json["mockERC20"],
                config.SOFT_CAP_REFUND,
                config.HARD_CAP,
                deadline,
                config.MILESTONES,
                [config.CONTRIB_AMOUNT] * 3,
                ["A", "B", "C"],
                "",
            )
        else:
            refund_create_fn = factory.functions.createCampaign(
                deploy_json["mockERC20"],
                config.SOFT_CAP_REFUND,
                config.HARD_CAP,
                deadline,
                config.MILESTONES,
                "Bench Refund",
                "BRF",
            )
        rcpt = _send_deployer(refund_create_fn)
        event_name = config.EVM_CAMPAIGN_CREATED_EVENT[variant]
        logs = factory.events[event_name]().process_receipt(rcpt)
        refund_campaign_addr = logs[0]["args"]["campaign"]
        print(f"[{client}] Refund campaign: {refund_campaign_addr}")

        # Update CAMPAIGN_ADDRESS for refund ops
        base_env[f"CAMPAIGN_ADDRESS_{variant}"] = refund_campaign_addr

        # Advance time past deadline for refund campaign (need to deploy fresh)
        n_refund = 5

        # Contribute 5× (setup, not timed for client benchmark)
        with open(mock_erc20_artifact) as fh:
            usdc_abi = json.load(fh)["abi"]
        usdc = w3.eth.contract(address=deploy_json["mockERC20"], abi=usdc_abi)

        _, campaign_artifact, _ = config.EVM_VARIANT_ARTIFACTS[variant]
        # campaign artifact loaded for abi
        with open(campaign_artifact) as fh:
            campaign_abi_data = json.load(fh)["abi"]
        campaign_ref = w3.eth.contract(address=refund_campaign_addr, abi=campaign_abi_data)

        for i in range(1, n_refund + 1):
            acc, _ = _evm_account_from_index(i, _refund_seed)
            # Approve
            approve_tx = usdc.functions.approve(refund_campaign_addr, config.CONTRIB_AMOUNT).build_transaction({
                "from": acc.address,
                "nonce": w3.eth.get_transaction_count(acc.address),
                "gas": 100_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acc.sign_transaction(approve_tx)
            w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))
            # Contribute
            contrib_fn = campaign_ref.functions.contribute(0) if variant == "V3" else campaign_ref.functions.contribute(config.CONTRIB_AMOUNT)
            contrib_tx = contrib_fn.build_transaction({
                "from": acc.address,
                "nonce": w3.eth.get_transaction_count(acc.address),
                "gas": 300_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acc.sign_transaction(contrib_tx)
            w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))

        # Advance time and finalize
        w3.provider.make_request("evm_increaseTime", [config.DEADLINE_DAYS * 86400 + 1])
        w3.provider.make_request("evm_mine", [])
        _send_deployer(campaign_ref.functions.finalize())

        # ── refund × 5 (TIMED via client) ─────────────────────────────────────
        for i in range(1, n_refund + 1):
            print(f"[{client}] refund() for contributor #{i}...")
            contrib_key = _derive_evm_contributor_key(i)
            env = {**base_env, "PRIVATE_KEY": contrib_key}
            refund_extra_args = ["--tier-id", "0"] if variant == "V3" else []
            output, proc_ms = _client_run("refund", refund_extra_args, env)
            operations.append({
                "name": "refund",
                "scenario": "refund",
                "gas_used": output.get("gasUsed"),
                "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
                "latency_ms": output.get("elapsedMs"),
                "process_elapsed_ms": proc_ms,
                "tx_hash": output.get("txHash"),
            })

    except Exception as exc:
        print(f"[warn] Refund path failed: {exc}", file=sys.stderr)

    # ── Throughput from success path contribute ops ───────────────────────────
    contrib_latencies = [
        op["latency_ms"] for op in operations
        if op["name"] == "contribute" and op["scenario"] == "success"
        and op["latency_ms"] is not None
    ]
    total_ms = sum(contrib_latencies) if contrib_latencies else 0
    tps = round(len(contrib_latencies) / (total_ms / 1000), 4) if total_ms > 0 else 0.0

    # Determine chain_id
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
            "Hardhat automines instantly; latency reflects local execution time only, not network propagation.",
            "process_elapsed_ms includes subprocess startup overhead (tsx/dotnet/python runtime init).",
            f"ts-evm contribute.ts bundles approve+contribute gas; cost = contributeGasUsed only.",
        ] if "localnet" in env_name else [
            "Sepolia: 12-second average block time; latency includes real network propagation.",
            "process_elapsed_ms includes subprocess startup overhead.",
        ],
        "operations": operations,
        "throughput": {
            "num_contributions": len(contrib_latencies),
            "total_time_ms": total_ms,
            "tps": tps,
        },
    }

    return result


# ---------------------------------------------------------------------------
# Solana benchmarks
# ---------------------------------------------------------------------------

def run_solana_lifecycle(client: str, variant: str, env_name: str) -> dict:
    """
    Run full Solana lifecycle via ts or dotnet client subprocesses.

    Prerequisites:
    - solana-test-validator running and program deployed
    - SOLANA_PAYMENT_MINT env var set (from a prior Python harness run)
    - Keypair at SOLANA_WALLET_PATH (default: ~/.config/solana/id.json)
    """
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
    except ImportError as exc:
        sys.exit(f"[solana] Missing dependency: {exc}. Run: pip install -r benchmarks/requirements.txt")

    import asyncio

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
        TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
        token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

        py_idl_path, program_id_str = config.SOLANA_VARIANT_ARTIFACTS[variant]

        with open(config.SOLANA_WALLET_PATH) as fh:
            payer = Keypair.from_bytes(bytes(json.load(fh)))
        client_rpc = AsyncClient(config.SOLANA_RPC_URL, commitment=Confirmed)

        with open(py_idl_path) as fh:
            idl = Idl.from_json(fh.read())
        program_id = Pubkey.from_string(program_id_str)
        wallet = Wallet(payer)
        from anchorpy import Provider as AnchorProvider
        provider = AnchorProvider(client_rpc, wallet)
        program = Program(idl, program_id, provider)

        def _pda(seeds: list[bytes]) -> Pubkey:
            p, _ = Pubkey.find_program_address(seeds, program_id)
            return p

        # ── Setup: airdrop, create mint, fund contributors ─────────────────
        print("[solana_setup] Airdrop + create mint + fund contributors...")
        await client_rpc.request_airdrop(payer.pubkey(), 100_000_000_000)
        await asyncio.sleep(2)

        payment_mint = await SPLAsyncToken.create_mint(
            client_rpc, payer, payer.pubkey(), 6, token_prog
        )
        payment_mint_pubkey = payment_mint.pubkey

        creator_kp = Keypair()
        contributors = [Keypair() for _ in range(config.N_CONTRIBUTIONS)]
        await client_rpc.request_airdrop(creator_kp.pubkey(), 10_000_000_000)
        for batch_start in range(0, len(contributors), 10):
            for c in contributors[batch_start:batch_start + 10]:
                await client_rpc.request_airdrop(c.pubkey(), 2_000_000_000)
            await asyncio.sleep(2)
        await asyncio.sleep(2)

        # Create ATAs and mint tokens
        print("[solana_setup] Pre-creating payment ATAs...")
        payment_atas: list[Pubkey] = []
        skip_opts = TxOpts(skip_confirmation=False, skip_preflight=True)
        for i, c in enumerate(contributors):
            ata = await payment_mint.create_account(c.pubkey())
            await payment_mint.mint_to(ata, payer, config.CONTRIB_AMOUNT, opts=skip_opts)
            payment_atas.append(ata)
            if (i + 1) % 10 == 0:
                await asyncio.sleep(1)
        await asyncio.sleep(1)

        # Create campaign
        import time as _time
        campaign_id_val = int(_time.time() * 1000) & 0xFFFFFFFF
        campaign_id_bytes = campaign_id_val.to_bytes(8, "little")
        campaign_pda = _pda([b"campaign", bytes(creator_kp.pubkey()), campaign_id_bytes])
        vault_pda = _pda([b"vault", bytes(campaign_pda)])
        receipt_mint_pda = _pda([b"receipt_mint", bytes(campaign_pda)])
        deadline_ts = int(_time.time()) + config.DEADLINE_DAYS * 86400

        sig = await program.rpc["initialize_campaign"](
            campaign_id_val, config.SOFT_CAP, config.HARD_CAP, deadline_ts,
            bytes(config.MILESTONES),
            ctx=Context(
                accounts={
                    "creator": creator_kp.pubkey(), "campaign": campaign_pda,
                    "payment_mint": payment_mint_pubkey, "vault": vault_pda,
                    "receipt_mint": receipt_mint_pda, "token_program": token_prog,
                    "system_program": SYSTEM_PROGRAM_ID, "rent": RENT,
                },
                signers=[creator_kp],
            ),
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)
        campaign_addr = str(campaign_pda)
        print(f"[solana_setup] Campaign: {campaign_addr}")

        # Pre-create receipt ATAs
        receipt_spl = SPLAsyncToken(client_rpc, receipt_mint_pda, token_prog, payer)
        for c in contributors:
            await receipt_spl.create_account(c.pubkey())
        await asyncio.sleep(1)

        # Write contributor keypairs to temp files for client use
        contrib_keypair_files: list[str] = []
        for c in contributors:
            tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
            json.dump(list(bytes(c)), tmp)
            tmp.close()
            contrib_keypair_files.append(tmp.name)

        # Write creator keypair
        creator_tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        json.dump(list(bytes(creator_kp)), creator_tmp)
        creator_tmp.close()

        # Base env for Solana client
        base_env = {
            **os.environ,
            "SOLANA_RPC_URL": config.SOLANA_RPC_URL,
            f"SOLANA_PROGRAM_ID_{variant}": program_id_str,
            "SOLANA_PAYMENT_MINT": str(payment_mint_pubkey),
            "SOLANA_CAMPAIGN_ADDRESS": campaign_addr,
            "SOLANA_CAMPAIGN_ID": str(campaign_id_val),
            "SOLANA_KEYPAIR_PATH": config.SOLANA_WALLET_PATH,
            "VARIANT": variant,
        }

        operations: list[dict] = []

        # ── SUCCESS PATH: contribute × N ──────────────────────────────────────
        print(f"[{client}] --- SUCCESS PATH ---")
        print(f"[{client}] Running {config.N_CONTRIBUTIONS} timed contribute() calls...")
        amount_str = str(config.CONTRIB_AMOUNT // (10 ** config.DECIMALS))

        for i, c in enumerate(contributors):
            env = {**base_env, "SOLANA_KEYPAIR_PATH": contrib_keypair_files[i]}
            output, proc_ms = _client_run_sync("contribute", ["--amount", amount_str], env)
            operations.append({
                "name": "contribute",
                "scenario": "success",
                "compute_units": output.get("gasUsed"),
                "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
                "latency_ms": output.get("elapsedMs"),
                "process_elapsed_ms": proc_ms,
                "tx_hash": output.get("txHash"),
            })
            if (i + 1) % 10 == 0:
                print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")

        # ── Setup fast-deadline campaign for finalize/withdraw ────────────────
        print(f"[{client}] Setting up fast-deadline campaign for finalize/withdraw...")
        import time as _time2
        fc_id = (int(_time2.time() * 1000) & 0xFFFFFFFF) + 1
        fc_id_bytes = fc_id.to_bytes(8, "little")
        fc_pda = _pda([b"campaign", bytes(creator_kp.pubkey()), fc_id_bytes])
        fc_vault = _pda([b"vault", bytes(fc_pda)])
        fc_receipt = _pda([b"receipt_mint", bytes(fc_pda)])
        fc_deadline = int(_time2.time()) + 5

        sig = await program.rpc["initialize_campaign"](
            fc_id, config.SOFT_CAP, config.HARD_CAP, fc_deadline,
            bytes(config.MILESTONES),
            ctx=Context(
                accounts={
                    "creator": creator_kp.pubkey(), "campaign": fc_pda,
                    "payment_mint": payment_mint_pubkey, "vault": fc_vault,
                    "receipt_mint": fc_receipt, "token_program": token_prog,
                    "system_program": SYSTEM_PROGRAM_ID, "rent": RENT,
                },
                signers=[creator_kp],
            ),
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)

        # One contribution to meet softCap
        fc_c = contributors[0]
        await payment_mint.mint_to(payment_atas[0], payer, config.CONTRIB_AMOUNT, opts=skip_opts)
        fc_receipt_spl = SPLAsyncToken(client_rpc, fc_receipt, token_prog, payer)
        fc_receipt_ata = await fc_receipt_spl.create_account(fc_c.pubkey())
        fc_contrib_record = _pda([b"contributor", bytes(fc_pda), bytes(fc_c.pubkey())])
        sig = await program.rpc["contribute"](
            config.CONTRIB_AMOUNT,
            ctx=Context(
                accounts={
                    "contributor": fc_c.pubkey(), "campaign": fc_pda,
                    "contributor_record": fc_contrib_record,
                    "contributor_payment_ata": payment_atas[0],
                    "vault": fc_vault,
                    "contributor_receipt_ata": fc_receipt_ata,
                    "receipt_mint": fc_receipt,
                    "payment_mint": payment_mint_pubkey,
                    "token_program": token_prog,
                    "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                    "system_program": SYSTEM_PROGRAM_ID,
                    "rent": RENT,
                },
                signers=[fc_c],
            ),
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)
        await asyncio.sleep(6)  # wait for deadline

        # ── finalize ──────────────────────────────────────────────────────────
        print(f"[{client}] finalize()...")
        fc_env = {
            **base_env,
            "SOLANA_CAMPAIGN_ADDRESS": str(fc_pda),
            "SOLANA_KEYPAIR_PATH": config.SOLANA_WALLET_PATH,
        }
        output, proc_ms = _client_run_sync("finalize", [], fc_env)
        operations.append({
            "name": "finalize",
            "scenario": "success",
            "compute_units": output.get("gasUsed"),
            "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
            "latency_ms": output.get("elapsedMs"),
            "process_elapsed_ms": proc_ms,
            "tx_hash": output.get("txHash"),
        })

        # ── withdraw × 3 ──────────────────────────────────────────────────────
        creator_env = {**fc_env, "SOLANA_KEYPAIR_PATH": creator_tmp.name}
        for m in range(len(config.MILESTONES)):
            print(f"[{client}] withdraw() #{m}...")
            output, proc_ms = _client_run_sync("withdraw", [], creator_env)
            operations.append({
                "name": f"withdraw_milestone_{m}",
                "scenario": "success",
                "compute_units": output.get("gasUsed"),
                "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
                "latency_ms": output.get("elapsedMs"),
                "process_elapsed_ms": proc_ms,
                "tx_hash": output.get("txHash"),
            })

        # ── REFUND PATH ───────────────────────────────────────────────────────
        # (simplified: reuse Python harness for refund campaign setup, then client for refund)
        print(f"\n[{client}] --- REFUND PATH (Python setup + client refund) ---")
        n_refund = 5
        ref_id = (int(_time2.time() * 1000) & 0xFFFFFFFF) + 2
        ref_id_bytes = ref_id.to_bytes(8, "little")
        ref_pda = _pda([b"campaign", bytes(creator_kp.pubkey()), ref_id_bytes])
        ref_vault = _pda([b"vault", bytes(ref_pda)])
        ref_receipt = _pda([b"receipt_mint", bytes(ref_pda)])
        ref_deadline = int(_time2.time()) + 5

        sig = await program.rpc["initialize_campaign"](
            ref_id, config.SOFT_CAP_REFUND, config.HARD_CAP, ref_deadline,
            bytes(config.MILESTONES),
            ctx=Context(
                accounts={
                    "creator": creator_kp.pubkey(), "campaign": ref_pda,
                    "payment_mint": payment_mint_pubkey, "vault": ref_vault,
                    "receipt_mint": ref_receipt, "token_program": token_prog,
                    "system_program": SYSTEM_PROGRAM_ID, "rent": RENT,
                },
                signers=[creator_kp],
            ),
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)

        ref_receipt_spl = SPLAsyncToken(client_rpc, ref_receipt, token_prog, payer)
        from spl.token.instructions import get_associated_token_address
        for i_r, c in enumerate(contributors[:n_refund]):
            await payment_mint.mint_to(payment_atas[i_r], payer, config.CONTRIB_AMOUNT, opts=skip_opts)
            ref_ra = await ref_receipt_spl.create_account(c.pubkey())
            ref_cr = _pda([b"contributor", bytes(ref_pda), bytes(c.pubkey())])
            sig = await program.rpc["contribute"](
                config.CONTRIB_AMOUNT,
                ctx=Context(
                    accounts={
                        "contributor": c.pubkey(), "campaign": ref_pda,
                        "contributor_record": ref_cr,
                        "contributor_payment_ata": payment_atas[i_r],
                        "vault": ref_vault,
                        "contributor_receipt_ata": ref_ra,
                        "receipt_mint": ref_receipt,
                        "payment_mint": payment_mint_pubkey,
                        "token_program": token_prog,
                        "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                        "system_program": SYSTEM_PROGRAM_ID,
                        "rent": RENT,
                    },
                    signers=[c],
                ),
            )
            await client_rpc.confirm_transaction(sig, commitment=Confirmed)

        await asyncio.sleep(6)
        sig = await program.rpc["finalize"](
            ctx=Context(accounts={"caller": payer.pubkey(), "campaign": ref_pda})
        )
        await client_rpc.confirm_transaction(sig, commitment=Confirmed)

        # Refund via client subprocess
        ref_env_base = {
            **base_env,
            "SOLANA_CAMPAIGN_ADDRESS": str(ref_pda),
        }
        for i_r in range(n_refund):
            print(f"[{client}] refund() for contributor #{i_r + 1}...")
            env = {**ref_env_base, "SOLANA_KEYPAIR_PATH": contrib_keypair_files[i_r]}
            output, proc_ms = _client_run_sync("refund", [], env)
            operations.append({
                "name": "refund",
                "scenario": "refund",
                "compute_units": output.get("gasUsed"),
                "cost": str(output.get("gasUsed")) if output.get("gasUsed") is not None else None,
                "latency_ms": output.get("elapsedMs"),
                "process_elapsed_ms": proc_ms,
                "tx_hash": output.get("txHash"),
            })

        await client_rpc.close()

        # Cleanup temp keypair files
        for f in contrib_keypair_files + [creator_tmp.name]:
            try:
                os.unlink(f)
            except Exception:
                pass

        contrib_latencies = [
            op["latency_ms"] for op in operations
            if op["name"] == "contribute" and op.get("latency_ms") is not None
        ]
        total_ms = sum(contrib_latencies)
        tps = round(len(contrib_latencies) / (total_ms / 1000), 4) if total_ms > 0 else 0.0

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
            "timestamp_utc": int(time.time()),
            "limitations": [
                "solana-test-validator is single-threaded; TPS does not represent production conditions.",
                "process_elapsed_ms includes subprocess startup overhead.",
                "Fees are flat (5000 lam/signature); no gas-price analogue exists.",
            ],
            "operations": operations,
            "throughput": {
                "num_contributions": len(contrib_latencies),
                "total_time_ms": total_ms,
                "tps": tps,
            },
        }

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Lifecycle benchmark via subprocess-driven TS or .NET clients."
    )
    parser.add_argument("--platform", choices=["evm", "solana"], required=True)
    parser.add_argument("--client", choices=["ts", "dotnet", "python"], required=True,
                        help="Client library: ts (viem/Anchor TS), dotnet (Nethereum/Solnet), or python (web3.py/anchorpy)")
    parser.add_argument("--variant", default=config.VARIANT,
                        help="Contract variant (default: $VARIANT or V1)")
    parser.add_argument("--env", default=None,
                        help="Environment label (auto-detected from RPC URL if omitted)")
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
        result = run_evm_lifecycle(args.client, variant, env_name, deploy_json)
    else:
        result = run_solana_lifecycle(args.client, variant, env_name)

    out_path = config.results_path(variant, result["client"], "lifecycle", env_name, result.get("timestamp_utc"))
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"[output] {out_path}")


if __name__ == "__main__":
    main()
