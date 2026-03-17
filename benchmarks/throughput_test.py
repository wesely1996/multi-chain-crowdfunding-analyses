"""
throughput_test.py — Isolated throughput measurement: 50 sequential contributions.

This script focuses ONLY on the throughput metric:
  - Pre-creates all required accounts / approvals outside the timed window
  - Starts a wall-clock timer
  - Submits N contributions sequentially, waiting for confirmation before each next
  - Stops the timer after the last confirmation
  - Reports total time (ms) and TPS

Rationale for isolation
-----------------------
run_tests.py collects per-operation latency across the full lifecycle; this
script gives a clean, single-purpose throughput number that matches the
measurement reported in docs/measurements.md (M-V1-1 / M-V4-1).

Output
------
Writes a JSON record to
  benchmarks/results/{VARIANT}_{CLIENT}_{ENV}_throughput.json

Env vars
--------
  VARIANT       Contract variant: V1 (default) | V4 | V2 | V3 | V5
  CLIENT        Client label: python (default)
  BENCHMARK_ENV Environment label override (auto-detected from RPC URL if unset)

Limitations
-----------
- Hardhat automines instantly; EVM latency reflects execution time only,
  not real network propagation.
- solana-test-validator is single-threaded; TPS does not represent
  production conditions.
- Sequential methodology is chosen for reproducibility and cross-chain
  comparability — not for measuring peak throughput.

Run
---
    python benchmarks/throughput_test.py --platform evm
    VARIANT=V1 CLIENT=python python benchmarks/throughput_test.py --platform evm
    python benchmarks/throughput_test.py --platform solana
"""

from __future__ import annotations

import argparse
import json
import time
import pathlib
import sys

import config

# Ensure repo root is on sys.path for clients.python imports
_repo_root = str(pathlib.Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from clients.python.shared.output import ms as _ms  # noqa: E402

SCHEMA_VERSION = "2"


def _write_result(path: pathlib.Path, record: dict) -> None:
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(record, fh, indent=2)
    print(f"[output] {path}")


# ---------------------------------------------------------------------------
# EVM throughput
# ---------------------------------------------------------------------------

def throughput_evm(variant: str = config.VARIANT, client: str = config.CLIENT) -> dict:
    try:
        from web3 import Web3
        from web3.middleware import geth_poa_middleware
        from eth_account import Account
    except ImportError as exc:
        sys.exit(f"[evm] Missing dependency: {exc}")

    print("\n" + "=" * 72)
    print(f"EVM Throughput — {config.N_CONTRIBUTIONS} sequential contributions")
    print(f"Limitation: Hardhat automines instantly; latency = execution time only.")
    print("=" * 72)

    w3 = Web3(Web3.HTTPProvider(config.EVM_RPC_URL))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    if not w3.is_connected():
        sys.exit(f"[evm] Cannot connect to {config.EVM_RPC_URL}")

    Account.enable_unaudited_hdwallet_features()
    from eth_account.hdaccount import key_from_seed, seed_from_mnemonic as _seed_from_mnemonic
    _seed = _seed_from_mnemonic(config.EVM_MNEMONIC, "")
    deployer    = Account.from_key(key_from_seed(_seed, "m/44'/60'/0'/0/0"))
    contributors = [
        Account.from_key(key_from_seed(_seed, f"m/44'/60'/0'/0/{i}"))
        for i in range(1, config.N_CONTRIBUTIONS + 1)
    ]

    def _load_abi(p: pathlib.Path) -> list:
        with open(p) as fh:
            return json.load(fh)["abi"]

    def _build_and_send(fn, sender, gas=300_000):
        tx = fn.build_transaction({
            "from": sender.address,
            "nonce": w3.eth.get_transaction_count(sender.address),
            "gas": gas,
            "gasPrice": w3.eth.gas_price,
        })
        signed = sender.sign_transaction(tx)
        return w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.rawTransaction))

    factory_artifact, campaign_artifact_path, mock_erc20_artifact = config.EVM_VARIANT_ARTIFACTS[variant]

    # ── Deploy (setup, not timed) ────────────────────────────────────────────
    print("[evm] Deploying contracts (setup)...")
    with open(mock_erc20_artifact) as fh:
        usdc_art = json.load(fh)
    usdc_contract = w3.eth.contract(abi=usdc_art["abi"], bytecode=usdc_art["bytecode"])
    rcpt = _build_and_send(usdc_contract.constructor("Mock USDC", "USDC"), deployer, gas=3_000_000)
    usdc_addr = rcpt["contractAddress"]
    usdc = w3.eth.contract(address=usdc_addr, abi=usdc_art["abi"])

    with open(factory_artifact) as fh:
        factory_art = json.load(fh)
    factory_contract = w3.eth.contract(abi=factory_art["abi"], bytecode=factory_art["bytecode"])
    rcpt = _build_and_send(factory_contract.constructor(), deployer, gas=8_000_000)
    factory_addr = rcpt["contractAddress"]
    factory = w3.eth.contract(address=factory_addr, abi=factory_art["abi"])

    deadline = int(time.time()) + config.DEADLINE_DAYS * 86400
    if variant == "V3":
        create_call = factory.functions.createCampaign(
            usdc_addr, config.SOFT_CAP, config.HARD_CAP, deadline,
            config.MILESTONES, [config.CONTRIB_AMOUNT] * 3, ["A", "B", "C"], "",
        )
    else:
        create_call = factory.functions.createCampaign(
            usdc_addr, config.SOFT_CAP, config.HARD_CAP, deadline,
            config.MILESTONES, "Bench Token", "BT",
        )
    rcpt = _build_and_send(create_call, deployer, gas=5_000_000)
    event_name = config.EVM_CAMPAIGN_CREATED_EVENT[variant]
    logs = factory.events[event_name]().process_receipt(rcpt)
    campaign_addr = logs[0]["args"]["campaign"]
    campaign_abi = _load_abi(campaign_artifact_path)
    campaign = w3.eth.contract(address=campaign_addr, abi=campaign_abi)
    print(f"[evm] Campaign: {campaign_addr}")

    # ── Mint + approve (setup, not timed) ────────────────────────────────────
    print(f"[evm] Minting + approving for {config.N_CONTRIBUTIONS} contributors (setup)...")
    for acc in contributors:
        _build_and_send(usdc.functions.mint(acc.address, config.CONTRIB_AMOUNT), deployer, gas=200_000)
        _build_and_send(usdc.functions.approve(campaign_addr, config.CONTRIB_AMOUNT), acc, gas=100_000)

    # ── TIMED WINDOW ─────────────────────────────────────────────────────────
    print(f"\n[evm] >>> TIMED: {config.N_CONTRIBUTIONS} sequential contribute() <<<")
    per_tx_gas: list[int] = []
    per_tx_latency: list[int] = []

    t_start = _ms()
    for i, acc in enumerate(contributors):
        t0 = _ms()
        contribute_call = campaign.functions.contribute(0) if variant == "V3" else campaign.functions.contribute(config.CONTRIB_AMOUNT)
        rcpt = _build_and_send(contribute_call, acc, gas=300_000)
        latency = _ms() - t0
        per_tx_gas.append(rcpt["gasUsed"])
        per_tx_latency.append(latency)
        if (i + 1) % 10 == 0:
            print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")
    t_end = _ms()

    total_ms = t_end - t_start
    tps = round(config.N_CONTRIBUTIONS / (total_ms / 1000), 4)

    import statistics
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
            "Hardhat automines instantly; latency = local execution time only, not network propagation.",
        ],
        "operations": [
            {
                "name": "contribute",
                "scenario": "throughput",
                "gas_used": g,
                "cost": str(g),
                "latency_ms": l,
                "process_elapsed_ms": None,
                "tx_hash": None,
            }
            for g, l in zip(per_tx_gas, per_tx_latency)
        ],
        "throughput": {
            "num_contributions": config.N_CONTRIBUTIONS,
            "total_time_ms": total_ms,
            "tps": tps,
            "per_tx_gas": {
                "avg": round(statistics.mean(per_tx_gas), 2),
                "min": min(per_tx_gas),
                "max": max(per_tx_gas),
                "stdev": round(statistics.stdev(per_tx_gas), 2),
            },
            "per_tx_latency_ms": {
                "avg": round(statistics.mean(per_tx_latency), 2),
                "min": min(per_tx_latency),
                "max": max(per_tx_latency),
                "stdev": round(statistics.stdev(per_tx_latency), 2),
            },
        },
    }

    print(f"\n[evm] Throughput: {config.N_CONTRIBUTIONS} tx in {total_ms} ms → {tps} TPS")
    print(f"[evm] Gas avg={result['throughput']['per_tx_gas']['avg']} "
          f"min={result['throughput']['per_tx_gas']['min']} "
          f"max={result['throughput']['per_tx_gas']['max']}")

    out_path = config.results_path(variant, client, "throughput")
    _write_result(out_path, result)
    return result


# ---------------------------------------------------------------------------
# Solana throughput
# ---------------------------------------------------------------------------

def throughput_solana(variant: str = config.VARIANT, client: str = config.CLIENT) -> dict:
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
        sys.exit(f"[solana] Missing dependency: {exc}")

    import asyncio

    async def _run() -> dict:
        print("\n" + "=" * 72)
        print(f"Solana Throughput — {config.N_CONTRIBUTIONS} sequential contributions")
        print(f"Limitation: localnet single-threaded; TPS not representative of production.")
        print("=" * 72)

        TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
        token_prog = TOKEN_2022_PROGRAM_ID if variant == "V5" else TOKEN_PROGRAM_ID

        py_idl_path, program_id_str = config.SOLANA_VARIANT_ARTIFACTS[variant]

        with open(config.SOLANA_WALLET_PATH) as fh:
            payer = Keypair.from_bytes(bytes(json.load(fh)))
        client = AsyncClient(config.SOLANA_RPC_URL, commitment=Confirmed)
        wallet = Wallet(payer)
        provider = Provider(client, wallet)

        with open(py_idl_path) as fh:
            idl = Idl.from_json(fh.read())

        program_id = Pubkey.from_string(program_id_str)
        program = Program(idl, program_id, provider)

        def _pda(seeds: list[bytes]) -> Pubkey:
            p, _ = Pubkey.find_program_address(seeds, program_id)
            return p

        # ── Setup (not timed) ─────────────────────────────────────────────────
        print("[solana] Airdrop + create mint + fund contributors (setup)...")
        await client.request_airdrop(payer.pubkey(), 100_000_000_000)
        await asyncio.sleep(2)

        payment_mint = await SPLAsyncToken.create_mint(
            client, payer, payer.pubkey(), 6, token_prog
        )
        creator_kp   = Keypair()
        contributors = [Keypair() for _ in range(config.N_CONTRIBUTIONS)]
        await client.request_airdrop(creator_kp.pubkey(), 5_000_000_000)
        for c in contributors:
            await client.request_airdrop(c.pubkey(), 2_000_000_000)
        await asyncio.sleep(3)

        campaign_id_val  = int(time.time() * 1000) & 0xFFFFFFFF
        campaign_id_bytes = campaign_id_val.to_bytes(8, "little")
        campaign_pda     = _pda([b"campaign", bytes(creator_kp.pubkey()), campaign_id_bytes])
        vault_pda        = _pda([b"vault",    bytes(campaign_pda)])
        receipt_mint_pda = _pda([b"receipt_mint", bytes(campaign_pda)])
        deadline_ts      = int(time.time()) + config.DEADLINE_DAYS * 86400

        sig = await program.rpc["initialize_campaign"](
            campaign_id_val, config.SOFT_CAP, config.HARD_CAP, deadline_ts,
            bytes(config.MILESTONES),
            ctx=Context(
                accounts={
                    "creator": creator_kp.pubkey(), "campaign": campaign_pda,
                    "payment_mint": payment_mint.pubkey, "vault": vault_pda,
                    "receipt_mint": receipt_mint_pda, "token_program": token_prog,
                    "system_program": SYSTEM_PROGRAM_ID, "rent": RENT,
                },
                signers=[creator_kp],
            ),
        )
        await client.confirm_transaction(sig, commitment=Confirmed)
        print(f"[solana] Campaign: {campaign_pda}")

        # Pre-create payment ATAs + mint tokens (setup, not timed)
        print(f"[solana] Pre-creating ATAs + minting ({config.N_CONTRIBUTIONS} contributors)...")
        payment_atas: list[Pubkey] = []
        for c in contributors:
            ata = await payment_mint.create_account(c.pubkey())
            await payment_mint.mint_to(ata, payer, config.CONTRIB_AMOUNT,
                                       opts=TxOpts(skip_confirmation=False))
            payment_atas.append(ata)

        # Pre-create receipt ATAs (setup, not timed)
        receipt_spl = SPLAsyncToken(client, receipt_mint_pda, token_prog, payer)
        receipt_atas: list[Pubkey] = []
        for c in contributors:
            ata = await receipt_spl.create_account(c.pubkey())
            receipt_atas.append(ata)
        await asyncio.sleep(1)

        # ── TIMED WINDOW ──────────────────────────────────────────────────────
        print(f"\n[solana] >>> TIMED: {config.N_CONTRIBUTIONS} sequential contribute() <<<")
        per_tx_fee: list[int] = []
        per_tx_latency: list[int] = []

        t_start = _ms()
        for i, c in enumerate(contributors):
            cr_pda = _pda([b"contributor", bytes(campaign_pda), bytes(c.pubkey())])
            t0 = _ms()
            sig = await program.rpc["contribute"](
                config.CONTRIB_AMOUNT,
                ctx=Context(
                    accounts={
                        "contributor": c.pubkey(), "campaign": campaign_pda,
                        "contributor_record": cr_pda,
                        "contributor_payment_ata": payment_atas[i],
                        "vault": vault_pda,
                        "contributor_receipt_ata": receipt_atas[i],
                        "receipt_mint": receipt_mint_pda,
                        "payment_mint": payment_mint.pubkey,
                        "token_program": token_prog,
                        "associated_token_program": ASSOCIATED_TOKEN_PROGRAM_ID,
                        "system_program": SYSTEM_PROGRAM_ID,
                        "rent": RENT,
                    },
                    signers=[c],
                ),
            )
            await client.confirm_transaction(sig, commitment=Confirmed)
            latency = _ms() - t0
            # Fetch fee
            resp = await client.get_transaction(sig, max_supported_transaction_version=0)
            fee = resp.value.transaction.meta.fee if (resp.value and resp.value.transaction.meta) else 0
            per_tx_fee.append(fee)
            per_tx_latency.append(latency)
            if (i + 1) % 10 == 0:
                print(f"  {i + 1} / {config.N_CONTRIBUTIONS}")
        t_end = _ms()

        await client.close()

        total_ms = t_end - t_start
        tps = round(config.N_CONTRIBUTIONS / (total_ms / 1000), 4)

        import statistics
        env_label = config.BENCHMARK_ENV or config._infer_env(variant)
        result = {
            "schema_version": SCHEMA_VERSION,
            "variant": variant,
            "variant_label": config.VARIANT_LABELS.get(variant, variant),
            "client": client,
            "client_label": config.CLIENT_LABELS.get(client, client),
            "environment": env_label,
            "platform": "Solana",
            "chain_id": None,
            "timestamp_utc": int(time.time()),
            "limitations": [
                "solana-test-validator single-threaded; TPS not representative of production conditions.",
                "Fees are flat (5000 lam/signature); no gas-price analogue exists.",
            ],
            "operations": [
                {
                    "name": "contribute",
                    "scenario": "throughput",
                    "compute_units": None,
                    "cost": str(fee),
                    "latency_ms": lat,
                    "process_elapsed_ms": None,
                    "tx_hash": None,
                }
                for fee, lat in zip(per_tx_fee, per_tx_latency)
            ],
            "throughput": {
                "num_contributions": config.N_CONTRIBUTIONS,
                "total_time_ms": total_ms,
                "tps": tps,
                "per_tx_fee_lamports": {
                    "avg": round(statistics.mean(per_tx_fee), 2),
                    "min": min(per_tx_fee),
                    "max": max(per_tx_fee),
                },
                "per_tx_latency_ms": {
                    "avg": round(statistics.mean(per_tx_latency), 2),
                    "min": min(per_tx_latency),
                    "max": max(per_tx_latency),
                    "stdev": round(statistics.stdev(per_tx_latency), 2),
                },
            },
        }

        print(f"\n[solana] Throughput: {config.N_CONTRIBUTIONS} tx in {total_ms} ms → {tps} TPS")
        print(f"[solana] Fee avg={result['throughput']['per_tx_fee_lamports']['avg']} lam (flat per-sig)")

        out_path = config.results_path(variant, client, "throughput")
        _write_result(out_path, result)
        return result

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Isolated throughput test: N sequential contributions, measure TPS."
    )
    parser.add_argument("--platform", choices=["evm", "solana", "both"], default="both")
    parser.add_argument(
        "--variant",
        default=config.VARIANT,
        help="Contract variant: V1 (ERC-20), V4 (SPL Token), etc. (default: $VARIANT or V1)",
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
        throughput_evm(variant=args.variant, client=args.client)
    if platform in ("solana", "both"):
        throughput_solana(variant=args.variant, client=args.client)


if __name__ == "__main__":
    main()
