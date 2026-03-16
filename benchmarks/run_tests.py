"""
run_tests.py — Full lifecycle benchmark for EVM and Solana crowdfunding.

Canonical lifecycle exercised
------------------------------
  SUCCESS path:  create → contribute × N → finalize → withdrawMilestone × 3
  REFUND  path:  create → contribute × N_SMALL → finalize → refund × N_SMALL

Each timed operation records:
  - cost    : gas_used (EVM) or fee in lamports (Solana)
  - latency : wall-clock ms from submission to confirmed receipt

Output
------
Writes result JSON conforming to schema_version "2" to
  benchmarks/results/{VARIANT}_{CLIENT}_{ENV}_lifecycle.json

Env vars
--------
  VARIANT       Contract variant: V1 (default) | V4 | V2 | V3 | V5
  CLIENT        Client label: python (default)
  BENCHMARK_ENV Environment label override (auto-detected from RPC URL if unset)

Run
---
    # Start Hardhat node first:
    cd contracts/evm && npx hardhat node
    # Then from repo root:
    python benchmarks/run_tests.py --platform evm
    VARIANT=V1 CLIENT=python python benchmarks/run_tests.py --platform evm
    python benchmarks/run_tests.py --platform solana
    python benchmarks/run_tests.py          # runs both

Limitations (explicit)
-----------------------
- Hardhat automines instantly; EVM latency reflects execution time only,
  not real network propagation or mempool wait.
- solana-test-validator is single-threaded; Solana TPS does not represent
  production throughput.
- Hardhat must be configured with accounts.count >= 60.
"""

from __future__ import annotations

import argparse
import json
import time
import pathlib
import sys
from typing import Any

import config
from evm_utils import ms as _ms

# ---------------------------------------------------------------------------
# Schema version tag embedded in every result file
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "2"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_results_dir() -> None:
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def _write_json(path: pathlib.Path, data: dict) -> None:
    _ensure_results_dir()
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2)
    print(f"[output] {path}")


def _load_json(path: pathlib.Path) -> dict:
    with open(path) as fh:
        return json.load(fh)

# ---------------------------------------------------------------------------
# EVM benchmark
# ---------------------------------------------------------------------------

def run_evm(variant: str = config.VARIANT, client: str = config.CLIENT) -> dict:
    """
    Deploy contracts, run the full lifecycle, and return a result dict
    conforming to schema_version "2".

    WHY web3.py + eth_account + HDWallet: anchorpy is Solana-only; web3.py
    is the canonical Python EVM library, and HDWallet lets us derive the same
    deterministic accounts Hardhat uses without a running node dependency.
    """
    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        from eth_account import Account
    except ImportError as exc:
        sys.exit(f"[evm] Missing dependency: {exc}. Run: pip install -r benchmarks/requirements.txt")

    print("\n" + "=" * 72)
    print("EVM Benchmark (Hardhat localnet)")
    print("=" * 72)

    w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
    # Hardhat localnet returns PoA-style extra data; this middleware silences the warning
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)

    if not w3.is_connected():
        sys.exit(f"[evm] Cannot connect to {config.EVM_RPC_URL}. Start: cd contracts/evm && npx hardhat node")

    # WHY: Hardhat's deterministic accounts use the standard test mnemonic with
    # the BIP-44 path m/44'/60'/0'/0/i. We derive them identically here so the
    # Python harness shares accounts with the TS benchmark without a separate
    # funding step.
    Account.enable_unaudited_hdwallet_features()
    deployer_acc   = Account.from_mnemonic(config.EVM_MNEMONIC, account_path=f"m/44'/60'/0'/0/0")
    contributor_accs = [
        Account.from_mnemonic(config.EVM_MNEMONIC, account_path=f"m/44'/60'/0'/0/{i}")
        for i in range(1, config.N_CONTRIBUTIONS + 1)
    ]

    def _load_abi(artifact: pathlib.Path) -> list:
        with open(artifact) as fh:
            return json.load(fh)["abi"]

    def _send(tx: dict, signer) -> tuple[Any, int]:
        """Sign, send, wait for receipt. Returns (receipt, latency_ms)."""
        tx.setdefault("gas", 3_000_000)
        tx.setdefault("gasPrice", w3.eth.gas_price)
        tx["nonce"] = w3.eth.get_transaction_count(signer.address)
        signed = signer.sign_transaction(tx)
        t0 = _ms()
        tx_hash_bytes = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes)
        latency = _ms() - t0
        return receipt, latency

    def _op(name: str, receipt: Any, latency: int, scenario: str) -> dict:
        """Build a schema-v2 operation record from an EVM receipt."""
        return {
            "name": name,
            "scenario": scenario,
            "gas_used": receipt["gasUsed"],
            "cost": str(receipt["gasUsed"]),
            "latency_ms": latency,
            "process_elapsed_ms": None,
            "tx_hash": receipt["transactionHash"].hex(),
        }

    factory_artifact, campaign_artifact_path, mock_erc20_artifact = config.EVM_VARIANT_ARTIFACTS[variant]

    # ── Deploy MockERC20 ────────────────────────────────────────────────────
    print("[evm] Deploying MockERC20...")
    usdc_abi = _load_abi(mock_erc20_artifact)
    with open(mock_erc20_artifact) as fh:
        usdc_bytecode = json.load(fh)["bytecode"]

    usdc_contract = w3.eth.contract(abi=usdc_abi, bytecode=usdc_bytecode)
    deploy_tx = usdc_contract.constructor("Mock USDC", "USDC").build_transaction({
        "from": deployer_acc.address,
        "nonce": w3.eth.get_transaction_count(deployer_acc.address),
        "gas": 3_000_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed_deploy = deployer_acc.sign_transaction(deploy_tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed_deploy.rawTransaction))
    usdc_addr = receipt["contractAddress"]
    usdc = w3.eth.contract(address=usdc_addr, abi=usdc_abi)
    print(f"[evm] MockERC20: {usdc_addr}")

    # ── Deploy Factory ──────────────────────────────────────────────────────
    print("[evm] Deploying CrowdfundingFactory...")
    factory_abi = _load_abi(factory_artifact)
    with open(factory_artifact) as fh:
        factory_bytecode = json.load(fh)["bytecode"]

    factory_contract = w3.eth.contract(abi=factory_abi, bytecode=factory_bytecode)
    deploy_tx = factory_contract.constructor().build_transaction({
        "from": deployer_acc.address,
        "nonce": w3.eth.get_transaction_count(deployer_acc.address),
        "gas": 8_000_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed_deploy = deployer_acc.sign_transaction(deploy_tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed_deploy.rawTransaction))
    factory_addr = receipt["contractAddress"]
    factory = w3.eth.contract(address=factory_addr, abi=factory_abi)
    print(f"[evm] Factory: {factory_addr}")

    campaign_abi = _load_abi(campaign_artifact_path)

    def _create_campaign(soft_cap: int) -> str:
        """Deploy a campaign via factory; return campaign address."""
        # Use node's block timestamp (not wall clock) — Hardhat time drifts after evm_increaseTime
        block_ts = w3.eth.get_block("latest")["timestamp"]
        deadline = block_ts + config.DEADLINE_DAYS * 86400
        if variant == "V3":
            call = factory.functions.createCampaign(
                usdc_addr,
                soft_cap,
                config.HARD_CAP,
                deadline,
                config.MILESTONES,
                [config.CONTRIB_AMOUNT] * 3,
                ["A", "B", "C"],
                "",
            )
        else:
            call = factory.functions.createCampaign(
                usdc_addr,
                soft_cap,
                config.HARD_CAP,
                deadline,
                config.MILESTONES,
                "Bench Token",
                "BT",
            )
        tx = call.build_transaction({
            "from": deployer_acc.address,
            "nonce": w3.eth.get_transaction_count(deployer_acc.address),
            "gas": 5_000_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = deployer_acc.sign_transaction(tx)
        rcpt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))
        # Parse CampaignCreated event to extract address
        event_name = config.EVM_CAMPAIGN_CREATED_EVENT[variant]
        logs = factory.events[event_name]().process_receipt(rcpt)
        return logs[0]["args"]["campaign"]

    # ========================================================================
    # SUCCESS PATH: softCap = SOFT_CAP (reachable at N=10, well under N=50)
    # ========================================================================
    print("\n[evm] --- SUCCESS PATH ---")
    campaign_addr = _create_campaign(config.SOFT_CAP)
    print(f"[evm] Campaign (success): {campaign_addr}")
    campaign = w3.eth.contract(address=campaign_addr, abi=campaign_abi)

    # Mint + approve for all contributors (setup — not timed)
    print(f"[evm] Minting and approving for {config.N_CONTRIBUTIONS} contributors...")
    for acc in contributor_accs:
        mint_tx = usdc.functions.mint(acc.address, config.CONTRIB_AMOUNT).build_transaction({
            "from": deployer_acc.address,
            "nonce": w3.eth.get_transaction_count(deployer_acc.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        })
        deployer_acc_signed = deployer_acc.sign_transaction(mint_tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(deployer_acc_signed.rawTransaction))

        approve_tx = usdc.functions.approve(campaign_addr, config.CONTRIB_AMOUNT).build_transaction({
            "from": acc.address,
            "nonce": w3.eth.get_transaction_count(acc.address),
            "gas": 100_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed_approve = acc.sign_transaction(approve_tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed_approve.rawTransaction))

    # ── contribute × N (TIMED) ──────────────────────────────────────────────
    print(f"[evm] Running {config.N_CONTRIBUTIONS} timed contribute() calls...")
    contribute_ops: list[dict] = []
    throughput_start = _ms()

    for i, acc in enumerate(contributor_accs):
        call = campaign.functions.contribute(0) if variant == "V3" else campaign.functions.contribute(config.CONTRIB_AMOUNT)
        tx = call.build_transaction({
            "from": acc.address,
            "nonce": w3.eth.get_transaction_count(acc.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        rcpt, latency = _send(tx, acc)
        contribute_ops.append(_op("contribute", rcpt, latency, "success"))
        if (i + 1) % 10 == 0:
            print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")

    throughput_total_ms = _ms() - throughput_start

    # ── Advance time past deadline (Hardhat-specific) ───────────────────────
    w3.provider.make_request("evm_increaseTime", [config.DEADLINE_DAYS * 86400 + 1])  # type: ignore[union-attr]
    w3.provider.make_request("evm_mine", [])  # type: ignore[union-attr]

    # ── finalize (TIMED) ─────────────────────────────────────────────────────
    print("[evm] finalize()...")
    call = campaign.functions.finalize()
    tx = call.build_transaction({
        "from": deployer_acc.address,
        "nonce": w3.eth.get_transaction_count(deployer_acc.address),
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })
    rcpt, latency = _send(tx, deployer_acc)
    finalize_op = _op("finalize", rcpt, latency, "success")

    # ── withdrawMilestone × 3 (TIMED) ────────────────────────────────────────
    withdraw_ops: list[dict] = []
    for m in range(len(config.MILESTONES)):
        print(f"[evm] withdrawMilestone() #{m}...")
        call = campaign.functions.withdrawMilestone()
        tx = call.build_transaction({
            "from": deployer_acc.address,
            "nonce": w3.eth.get_transaction_count(deployer_acc.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        })
        rcpt, latency = _send(tx, deployer_acc)
        withdraw_ops.append(_op(f"withdrawMilestone_{m}", rcpt, latency, "success"))

    # ========================================================================
    # REFUND PATH: softCap = SOFT_CAP_REFUND (> total raised → campaign fails)
    # ========================================================================
    print("\n[evm] --- REFUND PATH ---")
    # WHY separate campaign: we can't reuse a finalized campaign; a new
    # one with an unreachable softCap guarantees the failed state.
    n_refund = min(5, config.N_CONTRIBUTIONS)
    campaign_ref_addr = _create_campaign(config.SOFT_CAP_REFUND)
    print(f"[evm] Campaign (refund): {campaign_ref_addr}")
    campaign_ref = w3.eth.contract(address=campaign_ref_addr, abi=campaign_abi)

    # Mint + approve for refund contributors (setup)
    for acc in contributor_accs[:n_refund]:
        mint_tx = usdc.functions.mint(acc.address, config.CONTRIB_AMOUNT).build_transaction({
            "from": deployer_acc.address,
            "nonce": w3.eth.get_transaction_count(deployer_acc.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        })
        deployer_acc_signed = deployer_acc.sign_transaction(mint_tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(deployer_acc_signed.rawTransaction))

        approve_tx = usdc.functions.approve(campaign_ref_addr, config.CONTRIB_AMOUNT).build_transaction({
            "from": acc.address,
            "nonce": w3.eth.get_transaction_count(acc.address),
            "gas": 100_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed_approve = acc.sign_transaction(approve_tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed_approve.rawTransaction))

    # contribute (not timed for refund path — TPS measured in success path)
    for acc in contributor_accs[:n_refund]:
        call = campaign_ref.functions.contribute(0) if variant == "V3" else campaign_ref.functions.contribute(config.CONTRIB_AMOUNT)
        tx = call.build_transaction({
            "from": acc.address,
            "nonce": w3.eth.get_transaction_count(acc.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = acc.sign_transaction(tx)
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))

    # Advance time and finalize the refund campaign
    w3.provider.make_request("evm_increaseTime", [config.DEADLINE_DAYS * 86400 + 1])  # type: ignore[union-attr]
    w3.provider.make_request("evm_mine", [])  # type: ignore[union-attr]

    fin_tx = campaign_ref.functions.finalize().build_transaction({
        "from": deployer_acc.address,
        "nonce": w3.eth.get_transaction_count(deployer_acc.address),
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })
    deployer_acc_signed = deployer_acc.sign_transaction(fin_tx)
    w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(deployer_acc_signed.rawTransaction))

    # ── refund × n_refund (TIMED) ─────────────────────────────────────────────
    refund_ops: list[dict] = []
    for acc in contributor_accs[:n_refund]:
        print(f"[evm] refund() for {acc.address[:10]}...")
        call = campaign_ref.functions.refund(0) if variant == "V3" else campaign_ref.functions.refund()
        tx = call.build_transaction({
            "from": acc.address,
            "nonce": w3.eth.get_transaction_count(acc.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        })
        rcpt, latency = _send(tx, acc)
        refund_ops.append(_op("refund", rcpt, latency, "refund"))

    # ── Assemble result (schema v2) ───────────────────────────────────────────
    env_label = config.BENCHMARK_ENV or config._infer_env(variant)
    result = {
        "schema_version": SCHEMA_VERSION,
        "variant": variant,
        "variant_label": config.VARIANT_LABELS.get(variant, variant),
        "client": client,
        "client_label": config.CLIENT_LABELS.get(client, client),
        "environment": env_label,
        "platform": "EVM",
        "chain_id": w3.eth.chain_id,
        "timestamp_utc": int(time.time()),
        "limitations": [
            "Hardhat automines instantly; latency reflects local execution time only, not network propagation.",
            "Gas figures are localnet-only; fiat cost requires gas price from a live network.",
        ],
        "operations": contribute_ops + [finalize_op] + withdraw_ops + refund_ops,
        "throughput": {
            "num_contributions": config.N_CONTRIBUTIONS,
            "total_time_ms": throughput_total_ms,
            "tps": round(config.N_CONTRIBUTIONS / (throughput_total_ms / 1000), 4),
        },
    }

    out_path = config.results_path(variant, client, "lifecycle")
    _write_json(out_path, result)
    # Also write legacy path for backward compat with collect_metrics.py --evm flag
    _write_json(config.EVM_RAW_RESULTS, result)
    print(f"\n[evm] Done. TPS = {result['throughput']['tps']}")
    return result



# ---------------------------------------------------------------------------
# Solana benchmark
# ---------------------------------------------------------------------------

def run_solana(variant: str = config.VARIANT, client: str = config.CLIENT) -> dict:
    """
    Initialize program client, run the full lifecycle, return result dict
    conforming to schema_version "2".

    WHY anchorpy: it is the only Python library that supports Anchor IDL-based
    client generation, giving structural parity with the TS client used in the
    TS benchmark (contracts/solana/scripts/benchmark.ts).

    NOTE: this benchmark intentionally loads a Python-validated IDL artifact
    rather than assuming every Anchor-generated IDL will parse cleanly in anchorpy.
    """
    try:
        from anchorpy import Program, Provider, Wallet, Idl, Context
        from solana.rpc.async_api import AsyncClient
        from solana.rpc.commitment import Confirmed
        from solana.rpc.types import TxOpts
        from solders.keypair import Keypair  # type: ignore
        from solders.pubkey import Pubkey    # type: ignore
        from spl.token.async_client import AsyncToken
        from spl.token.constants import TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        from spl.token.instructions import (
            create_associated_token_account,
            get_associated_token_address,
        )
        import asyncio
        import struct
    except ImportError as exc:
        sys.exit(f"[solana] Missing dependency: {exc}. Run: pip install -r benchmarks/requirements.txt")

    import asyncio

    TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

    py_idl_path, program_id_str = config.SOLANA_VARIANT_ARTIFACTS[variant]

    def _load_python_idl() -> "Idl":
        raw_idl_path = config.SOLANA_RAW_IDL_PATH

        if not py_idl_path.exists():
            sys.exit(
                "[solana] Missing Python-compatible IDL.\n"
                f"Expected: {py_idl_path}\n"  # type: ignore[union-attr]
                f"Raw Anchor IDL: {raw_idl_path}\n"
                "Create a Python-validated IDL artifact before running the benchmark.\n"
                "Suggested workflow:\n"
                "  1) cd contracts/solana && anchor build\n"
                "  2) copy or convert target/idl/crowdfunding.json -> target/idl/crowdfunding.python.json\n"
                "  3) rerun python benchmarks/run_tests.py --platform solana"
            )

        idl_raw = _load_json(py_idl_path)
        try:
            return Idl.from_json(json.dumps(idl_raw))
        except Exception as exc:
            sys.exit(
                "[solana] Python IDL parse error.\n"
                f"File: {py_idl_path}\n"
                f"Error: {exc}\n"
                f"Raw Anchor IDL remains at: {raw_idl_path}\n"
                "This usually means the Python benchmark is pointed at an IDL schema\n"
                "that does not match the pinned anchorpy client stack.\n"
                "Regenerate or replace crowdfunding.python.json with a validated artifact."
            )

    def _make_program(client, payer):
        wallet = Wallet(payer)
        provider = Provider(client, wallet)
        idl = _load_python_idl()
        program_id = Pubkey.from_string(program_id_str)
        return Program(idl, program_id, provider), program_id

    async def _run() -> dict:
        print("\n" + "=" * 72)
        print("Solana Benchmark (localnet)")
        print("=" * 72)

        # Load payer wallet
        with open(config.SOLANA_WALLET_PATH) as fh:
            key_bytes = json.load(fh)
        payer = Keypair.from_bytes(bytes(key_bytes))

        client = AsyncClient(config.SOLANA_RPC_URL, commitment=Confirmed)
        program, program_id = _make_program(client, payer)

        def _ms_now() -> int:
            return int(time.time() * 1000)

        async def _timed_rpc(fn) -> tuple[str, int]:
            """Await an async RPC call; return (signature, latency_ms)."""
            t0 = _ms_now()
            sig = await fn
            latency = _ms_now() - t0
            return sig, latency

        async def _get_fee(sig: str) -> int:
            resp = await client.get_transaction(sig, max_supported_transaction_version=0)
            if resp.value and resp.value.transaction.meta:
                return resp.value.transaction.meta.fee
            return 0

        # ── Helper: find PDA ─────────────────────────────────────────────────
        def _find_pda(seeds: list[bytes]) -> Pubkey:
            pda, _ = Pubkey.find_program_address(seeds, program_id)
            return pda

        # TxOpts for fire-and-forget sends; we confirm manually via _send_and_confirm
        # to avoid the solana.py __post_send_with_confirm last_valid_block_height timeout
        no_confirm_opts = TxOpts(skip_confirmation=True, skip_preflight=True)

        async def _send_and_confirm(sig) -> None:
            """Poll get_signature_statuses until confirmed; avoids last_valid_block_height issues."""
            for _ in range(120):  # up to 60 s
                resp = await client.get_signature_statuses([sig])
                st = resp.value[0]
                if st and st.confirmation_status is not None:
                    return
                await asyncio.sleep(0.5)
            raise RuntimeError(f"Transaction not confirmed after 60 s: {sig}")

        # ── Phase 1: create payment mint (setup, not timed) ─────────────────
        print("[solana] Creating payment mint and funding contributors...")
        from spl.token.instructions import initialize_mint, mint_to, MintToParams
        from solders.system_program import create_account, CreateAccountParams
        from solders.sysvar import RENT

        # We use a fresh mint keypair each run to avoid state collision
        mint_kp = Keypair()
        # Airdrop payer if needed (localnet)
        await client.request_airdrop(payer.pubkey(), 100_000_000_000)
        await asyncio.sleep(2)

        # Create mint account via system program + initialize
        from spl.token.async_client import AsyncToken as SPLAsyncToken
        spl_token = SPLAsyncToken(client, mint_kp.pubkey(), token_prog, payer)
        # WHY: create_mint is a convenience wrapper that creates the account,
        # initializes it, and sets the mint authority to payer.
        payment_mint = await SPLAsyncToken.create_mint(
            client, payer, payer.pubkey(), 6, token_prog
        )
        payment_mint_pubkey = payment_mint.pubkey

        # Generate contributor keypairs; airdrop SOL for fees
        creator_kp = Keypair()
        contributors = [Keypair() for _ in range(config.N_CONTRIBUTIONS)]
        await client.request_airdrop(creator_kp.pubkey(), 5_000_000_000)
        # Airdrop in batches of 10 with confirmation pauses to avoid blockhash expiry
        for batch_start in range(0, len(contributors), 10):
            batch = contributors[batch_start:batch_start + 10]
            for c in batch:
                await client.request_airdrop(c.pubkey(), 2_000_000_000)
            await asyncio.sleep(2)
        await asyncio.sleep(2)

        # Pre-create contributor payment ATAs and mint tokens
        # WHY: setup outside timed loop so it does not skew TPS measurement
        # skip_confirmation=True for setup mints to avoid blockhash expiry under
        # sequential load; a single sleep at the end lets all txs confirm before
        # the timed benchmark phase begins.
        print("[solana] Pre-creating ATAs and minting tokens...")
        fire_opts = TxOpts(skip_confirmation=True, skip_preflight=True)
        payment_ata_addrs: list[Pubkey] = []
        for i, c in enumerate(contributors):
            ata = await payment_mint.create_account(c.pubkey())
            await payment_mint.mint_to(ata, payer, config.CONTRIB_AMOUNT, opts=fire_opts)
            payment_ata_addrs.append(ata)
            if (i + 1) % 10 == 0:
                print(f"  ATAs: {i + 1} / {config.N_CONTRIBUTIONS}")
                await asyncio.sleep(2)
        # Wait for all setup mints to confirm before timed phase starts
        await asyncio.sleep(5)

        # ── Phase 2: initialize_campaign (SUCCESS) ───────────────────────────
        print("[solana] initialize_campaign (success)...")
        import time as _time

        campaign_id_val = int(_time.time() * 1000) & 0xFFFFFFFF
        campaign_id_bytes = campaign_id_val.to_bytes(8, "little")

        campaign_pda = _find_pda([b"campaign", bytes(creator_kp.pubkey()), campaign_id_bytes])
        vault_pda    = _find_pda([b"vault",    bytes(campaign_pda)])
        receipt_mint_pda = _find_pda([b"receipt_mint", bytes(campaign_pda)])

        deadline_ts = int(_time.time()) + config.DEADLINE_DAYS * 86400

        from solders.system_program import ID as SYSTEM_PROGRAM_ID

        # Build accounts dict for initialize_campaign
        init_accounts = {
            "creator": creator_kp.pubkey(),
            "campaign": campaign_pda,
            "payment_mint": payment_mint_pubkey,
            "vault": vault_pda,
            "receipt_mint": receipt_mint_pda,
            "token_program": token_prog,
            "system_program": SYSTEM_PROGRAM_ID,
            "rent": RENT,
        }

        sig = await program.rpc["initialize_campaign"](
            campaign_id_val,
            config.SOFT_CAP,
            config.HARD_CAP,
            deadline_ts,
            bytes(config.MILESTONES),
            ctx=Context(accounts=init_accounts, signers=[creator_kp], options=no_confirm_opts),
        )
        await _send_and_confirm(sig)
        print(f"[solana] Campaign (success): {campaign_pda}")

        # Pre-create receipt ATAs for all contributors using ATA program so the
        # address matches what the program derives via associated_token_address().
        print("[solana] Pre-creating receipt ATAs...")
        receipt_ata_addrs: list[Pubkey] = []
        ata_fire_opts = TxOpts(skip_confirmation=True, skip_preflight=True)
        for i, c in enumerate(contributors):
            ata_addr = get_associated_token_address(c.pubkey(), receipt_mint_pda)
            ix = create_associated_token_account(payer.pubkey(), c.pubkey(), receipt_mint_pda)
            from solders.transaction import Transaction as SoldersTransaction
            from solders.message import Message
            bh_resp = await client.get_latest_blockhash()
            bh = bh_resp.value.blockhash
            msg = Message.new_with_blockhash([ix], payer.pubkey(), bh)
            tx = SoldersTransaction([payer], msg, bh)
            await client.send_raw_transaction(bytes(tx), opts=ata_fire_opts)
            receipt_ata_addrs.append(ata_addr)
            if (i + 1) % 10 == 0:
                await asyncio.sleep(2)
        # Wait for receipt ATA txs to fully settle before the timed loop
        await asyncio.sleep(10)

        # ── Phase 3: contribute × N (TIMED) ─────────────────────────────────
        print(f"[solana] Running {config.N_CONTRIBUTIONS} timed contribute() calls...")
        contribute_ops: list[dict] = []
        throughput_start = _ms_now()

        for i, c in enumerate(contributors):
            contrib_record_pda = _find_pda([b"contributor", bytes(campaign_pda), bytes(c.pubkey())])
            contrib_accounts = {
                "contributor": c.pubkey(),
                "campaign": campaign_pda,
                "contributor_record": contrib_record_pda,
                "contributor_payment_ata": payment_ata_addrs[i],
                "vault": vault_pda,
                "contributor_receipt_ata": receipt_ata_addrs[i],
                "receipt_mint": receipt_mint_pda,
                "payment_mint": payment_mint_pubkey,
                "token_program": token_prog,
                "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM_ID,
                "rent": RENT,
            }
            t0 = _ms_now()
            sig = await program.rpc["contribute"](
                config.CONTRIB_AMOUNT,
                ctx=Context(accounts=contrib_accounts, signers=[c], options=no_confirm_opts),
            )
            await _send_and_confirm(sig)
            latency = _ms_now() - t0
            fee = await _get_fee(sig)
            contribute_ops.append({
                "name": "contribute",
                "scenario": "success",
                "compute_units": None,   # CU recording not enabled in this run — see methodology note
                "cost": str(fee),
                "latency_ms": latency,
                "process_elapsed_ms": None,
                "tx_hash": str(sig),
            })
            if (i + 1) % 10 == 0:
                print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")

        throughput_total_ms = _ms_now() - throughput_start

        # ── Phase 4: finalize (separate fast campaign) ────────────────────────
        # WHY separate campaign: the contribution campaign has a 30-day deadline;
        # we cannot advance Solana localnet time via RPC. A new campaign with a
        # 5-second deadline avoids waiting.
        print("[solana] Setting up fast-deadline campaign for finalize/withdraw...")
        fc_id = (int(_time.time() * 1000) & 0xFFFFFFFF) + 1
        fc_id_bytes = fc_id.to_bytes(8, "little")
        fc_pda       = _find_pda([b"campaign", bytes(creator_kp.pubkey()), fc_id_bytes])
        fc_vault_pda = _find_pda([b"vault",    bytes(fc_pda)])
        fc_receipt_pda = _find_pda([b"receipt_mint", bytes(fc_pda)])
        fc_deadline  = int(_time.time()) + 5   # 5 seconds

        fc_init_accounts = {
            "creator": creator_kp.pubkey(),
            "campaign": fc_pda,
            "payment_mint": payment_mint_pubkey,
            "vault": fc_vault_pda,
            "receipt_mint": fc_receipt_pda,
            "token_program": token_prog,
            "system_program": SYSTEM_PROGRAM_ID,
            "rent": RENT,
        }
        sig = await program.rpc["initialize_campaign"](
            fc_id, config.SOFT_CAP, config.HARD_CAP, fc_deadline,
            bytes(config.MILESTONES),
            ctx=Context(accounts=fc_init_accounts, signers=[creator_kp], options=no_confirm_opts),
        )
        await _send_and_confirm(sig)

        # One contribution so softCap is met
        fc_c = contributors[0]
        await payment_mint.mint_to(payment_ata_addrs[0], payer, config.CONTRIB_AMOUNT,
                                   opts=TxOpts(skip_confirmation=True, skip_preflight=True))
        await asyncio.sleep(3)
        # Use proper ATA address (derived by ATA program) so the program constraint passes
        fc_receipt_ata = get_associated_token_address(fc_c.pubkey(), fc_receipt_pda)
        fc_contrib_record = _find_pda([b"contributor", bytes(fc_pda), bytes(fc_c.pubkey())])

        fc_contrib_accounts = {
            "contributor": fc_c.pubkey(),
            "campaign": fc_pda,
            "contributor_record": fc_contrib_record,
            "contributor_payment_ata": payment_ata_addrs[0],
            "vault": fc_vault_pda,
            "contributor_receipt_ata": fc_receipt_ata,
            "receipt_mint": fc_receipt_pda,
            "payment_mint": payment_mint_pubkey,
            "token_program": token_prog,
            "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
            "system_program": SYSTEM_PROGRAM_ID,
            "rent": RENT,
        }
        sig = await program.rpc["contribute"](
            config.CONTRIB_AMOUNT,
            ctx=Context(accounts=fc_contrib_accounts, signers=[fc_c], options=no_confirm_opts),
        )
        await _send_and_confirm(sig)

        # Wait for deadline
        await asyncio.sleep(6)

        # ── finalize (TIMED) ───────────────────────────────────────────────────
        print("[solana] finalize()...")
        finalize_accounts = {
            "caller": payer.pubkey(),
            "campaign": fc_pda,
        }
        t0 = _ms_now()
        sig = await program.rpc["finalize"](
            ctx=Context(accounts=finalize_accounts, options=no_confirm_opts)
        )
        await _send_and_confirm(sig)
        latency = _ms_now() - t0
        fin_fee = await _get_fee(sig)
        finalize_op = {
            "name": "finalize",
            "scenario": "success",
            "compute_units": None,
            "cost": str(fin_fee),
            "latency_ms": latency,
            "process_elapsed_ms": None,
            "tx_hash": str(sig),
        }

        # ── withdrawMilestone × 3 (TIMED) ─────────────────────────────────────
        creator_payment_ata = await payment_mint.create_account(creator_kp.pubkey())
        withdraw_ops: list[dict] = []

        for m in range(len(config.MILESTONES)):
            print(f"[solana] withdraw_milestone() #{m}...")
            wd_accounts = {
                "creator": creator_kp.pubkey(),
                "campaign": fc_pda,
                "vault": fc_vault_pda,
                "creator_payment_ata": creator_payment_ata,
                "payment_mint": payment_mint_pubkey,
                "token_program": token_prog,
            }
            t0 = _ms_now()
            sig = await program.rpc["withdraw_milestone"](
                ctx=Context(accounts=wd_accounts, signers=[creator_kp], options=no_confirm_opts)
            )
            await _send_and_confirm(sig)
            latency = _ms_now() - t0
            fee = await _get_fee(sig)
            withdraw_ops.append({
                "name": f"withdraw_milestone_{m}",
                "scenario": "success",
                "compute_units": None,
                "cost": str(fee),
                "latency_ms": latency,
                "process_elapsed_ms": None,
                "tx_hash": str(sig),
            })

        # ========================================================================
        # REFUND PATH (separate failed campaign)
        # ========================================================================
        print("\n[solana] --- REFUND PATH ---")
        n_refund = min(5, config.N_CONTRIBUTIONS)
        ref_id   = (int(_time.time() * 1000) & 0xFFFFFFFF) + 2
        ref_id_bytes = ref_id.to_bytes(8, "little")
        ref_pda      = _find_pda([b"campaign", bytes(creator_kp.pubkey()), ref_id_bytes])
        ref_vault_pda = _find_pda([b"vault",   bytes(ref_pda)])
        ref_receipt_pda = _find_pda([b"receipt_mint", bytes(ref_pda)])
        ref_deadline = int(_time.time()) + 5

        ref_init_accounts = {
            "creator": creator_kp.pubkey(),
            "campaign": ref_pda,
            "payment_mint": payment_mint_pubkey,
            "vault": ref_vault_pda,
            "receipt_mint": ref_receipt_pda,
            "token_program": token_prog,
            "system_program": SYSTEM_PROGRAM_ID,
            "rent": RENT,
        }
        # WHY: softCap well above total raised → finalize resolves to Failed
        sig = await program.rpc["initialize_campaign"](
            ref_id, config.SOFT_CAP_REFUND, config.HARD_CAP, ref_deadline,
            bytes(config.MILESTONES),
            ctx=Context(accounts=ref_init_accounts, signers=[creator_kp], options=no_confirm_opts),
        )
        await _send_and_confirm(sig)

        for c in contributors[:n_refund]:
            await payment_mint.mint_to(
                get_associated_token_address(c.pubkey(), payment_mint_pubkey),
                payer, config.CONTRIB_AMOUNT,
                opts=TxOpts(skip_confirmation=True, skip_preflight=True),
            )
        await asyncio.sleep(5)  # let mints confirm before contributing
        for c in contributors[:n_refund]:
            ref_receipt_ata = get_associated_token_address(c.pubkey(), ref_receipt_pda)
            ref_contrib_record = _find_pda([b"contributor", bytes(ref_pda), bytes(c.pubkey())])
            ref_contrib_accounts = {
                "contributor": c.pubkey(),
                "campaign": ref_pda,
                "contributor_record": ref_contrib_record,
                "contributor_payment_ata": get_associated_token_address(c.pubkey(), payment_mint_pubkey),
                "vault": ref_vault_pda,
                "contributor_receipt_ata": ref_receipt_ata,
                "receipt_mint": ref_receipt_pda,
                "payment_mint": payment_mint_pubkey,
                "token_program": token_prog,
                "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM_ID,
                "rent": RENT,
            }
            sig = await program.rpc["contribute"](
                config.CONTRIB_AMOUNT,
                ctx=Context(accounts=ref_contrib_accounts, signers=[c], options=no_confirm_opts),
            )
            await _send_and_confirm(sig)

        await asyncio.sleep(6)  # wait for ref_deadline

        sig = await program.rpc["finalize"](
            ctx=Context(accounts={"caller": payer.pubkey(), "campaign": ref_pda}, options=no_confirm_opts)
        )
        await _send_and_confirm(sig)

        # ── refund × n_refund (TIMED) ──────────────────────────────────────────
        refund_ops: list[dict] = []
        for c in contributors[:n_refund]:
            print(f"[solana] refund() for {str(c.pubkey())[:10]}...")
            ref_contrib_record = _find_pda([b"contributor", bytes(ref_pda), bytes(c.pubkey())])
            c_payment_ata = get_associated_token_address(c.pubkey(), payment_mint_pubkey)
            c_receipt_ata = get_associated_token_address(c.pubkey(), ref_receipt_pda)
            refund_accounts = {
                "contributor": c.pubkey(),
                "campaign": ref_pda,
                "contributor_record": ref_contrib_record,
                "contributor_payment_ata": c_payment_ata,
                "vault": ref_vault_pda,
                "contributor_receipt_ata": c_receipt_ata,
                "receipt_mint": ref_receipt_pda,
                "payment_mint": payment_mint_pubkey,
                "token_program": token_prog,
                "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM_ID,
            }
            t0 = _ms_now()
            sig = await program.rpc["refund"](
                ctx=Context(accounts=refund_accounts, signers=[c], options=no_confirm_opts)
            )
            await _send_and_confirm(sig)
            latency = _ms_now() - t0
            fee = await _get_fee(sig)
            refund_ops.append({
                "name": "refund",
                "scenario": "refund",
                "compute_units": None,
                "cost": str(fee),
                "latency_ms": latency,
                "process_elapsed_ms": None,
                "tx_hash": str(sig),
            })

        await client.close()

        env_label = config.BENCHMARK_ENV or config._infer_env(variant)
        result = {
            "schema_version": SCHEMA_VERSION,
            "variant": variant,
            "variant_label": config.VARIANT_LABELS.get(variant, variant),
            "client": config.CLIENT,
            "client_label": config.CLIENT_LABELS.get(config.CLIENT, config.CLIENT),
            "environment": env_label,
            "platform": "Solana",
            "chain_id": None,
            "timestamp_utc": int(time.time()),
            "limitations": [
                "solana-test-validator is single-threaded; TPS does not represent production conditions.",
                "Compute Units not recorded (requires ComputeBudgetProgram instrumentation — planned for devnet run).",
                "Fees are flat (5000 lam/signature); no gas-price analogue exists.",
            ],
            "operations": contribute_ops + [finalize_op] + withdraw_ops + refund_ops,
            "throughput": {
                "num_contributions": config.N_CONTRIBUTIONS,
                "total_time_ms": throughput_total_ms,
                "tps": round(config.N_CONTRIBUTIONS / (throughput_total_ms / 1000), 4),
            },
        }

        out_path = config.results_path(variant, config.CLIENT, "lifecycle")
        _write_json(out_path, result)
        # Also write legacy path for backward compat
        _write_json(config.SOLANA_RAW_RESULTS, result)
        print(f"\n[solana] Done. TPS = {result['throughput']['tps']}")
        return result

    import asyncio
    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Full-lifecycle benchmark for EVM and Solana crowdfunding contracts.",
    )
    parser.add_argument(
        "--platform",
        choices=["evm", "solana", "both"],
        default="both",
        help="Which platform to benchmark (default: both)",
    )
    parser.add_argument(
        "--variant",
        default=config.VARIANT,
        help="Contract variant: V1 (ERC-20), V4 (SPL Token), V2, V3, V5 (default: $VARIANT or V1)",
    )
    parser.add_argument(
        "--client",
        default=config.CLIENT,
        help="Client label for tagging results (default: $CLIENT or python)",
    )
    args = parser.parse_args()

    # Auto-infer platform from variant when --platform is not explicitly given
    variant_upper = args.variant.upper()
    if args.platform == "both":
        platform = "evm" if variant_upper in ("V1", "V2", "V3") else "solana"
    else:
        platform = args.platform

    if platform in ("evm", "both"):
        run_evm(variant=args.variant, client=args.client)
    if platform in ("solana", "both"):
        run_solana(variant=args.variant, client=args.client)


if __name__ == "__main__":
    main()
