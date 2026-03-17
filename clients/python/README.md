# Python Client

Python client for multi-chain crowdfunding smart contracts. Mirrors `clients/ts/` (TypeScript + viem / Anchor TS) and `clients/dotnet/` (C# + Nethereum / Solnet) for cross-client benchmark parity.

## Stack

- **EVM**: web3.py 6.x + eth-account (HD wallet derivation)
- **Solana**: anchorpy 0.21.0 + solders 0.21.0 + solana-py 0.34.3

## Prerequisites

Python 3.11+ with a virtual environment:

```bash
cd clients/python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

> **Windows note**: lru-dict 1.2.x has no prebuilt wheel. See the install procedure at the top of `requirements.txt` for the recommended workaround.

## CLI Usage

Run from the **repository root**:

```bash
python -m clients.python <operation> [args]
python -m clients.python evm:<operation> [args]
python -m clients.python sol:<operation> [args]
```

### Operations

| Operation | EVM | Solana | Description |
|-----------|-----|--------|-------------|
| `deploy` | Yes | -- | Deploy MockERC20 + Factory + Campaign |
| `create_campaign` | Yes | Yes | Create a new campaign |
| `contribute` | Yes | Yes | Contribute to a campaign |
| `finalize` | Yes | Yes | Finalize a campaign |
| `withdraw` | Yes | Yes | Withdraw a milestone |
| `refund` | Yes | Yes | Refund from a failed campaign |
| `status` | Yes | Yes | Read campaign state (no tx) |
| `idl_convert` | -- | Yes | Convert Anchor 0.32 IDL to anchorpy format |

### Examples

```bash
# EVM
python -m clients.python evm:deploy --variant V1
python -m clients.python evm:contribute --amount 10000000
python -m clients.python evm:finalize
python -m clients.python evm:withdraw
python -m clients.python evm:refund
python -m clients.python evm:status

# Solana
python -m clients.python sol:create_campaign --deadline-seconds 60
python -m clients.python sol:contribute --amount 10000000
python -m clients.python sol:finalize
python -m clients.python sol:withdraw
python -m clients.python sol:refund
python -m clients.python sol:status

# IDL conversion
python -m clients.python sol:idl_convert --src path/to/idl.json --dst path/to/out.json
```

## Environment Variables

### EVM

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` / `EVM_RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `PRIVATE_KEY` / `EVM_PRIVATE_KEY` | (none) | Explicit private key (for testnet) |
| `EVM_MNEMONIC` | Hardhat test mnemonic | HD wallet mnemonic |
| `FACTORY_ADDRESS` | (none) | Deployed factory contract address |
| `CAMPAIGN_ADDRESS` | (none) | Target campaign address |
| `PAYMENT_TOKEN_ADDRESS` | (none) | MockERC20 / USDC address |
| `VARIANT` | `V1` | Contract variant: V1, V2, V3 |

### Solana

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_URL` | `http://127.0.0.1:8899` | Solana RPC endpoint |
| `SOLANA_KEYPAIR_PATH` / `ANCHOR_WALLET` | `~/.config/solana/id.json` | Payer keypair file |
| `SOLANA_PROGRAM_ID` | V4 program ID | Anchor program ID |
| `SOLANA_CAMPAIGN_ADDRESS` | (none) | Campaign PDA address |
| `SOLANA_PAYMENT_MINT` | (none) | SPL token mint address |
| `SOLANA_CAMPAIGN_ID` | (none) | Campaign ID (u64) |
| `VARIANT` / `SOLANA_VARIANT` | `V4` | Contract variant: V4, V5 |

## Variant Branching

- **V1** (ERC-20): `approve()` + `contribute(amount)`
- **V2** (ERC-4626): `approve()` + `contribute(amount)` -- campaign is its own share token
- **V3** (ERC-1155): `approve()` + `contribute(tierId)` -- pass `--tier-id 0`
- **V4** (SPL Token): standard SPL token program
- **V5** (Token-2022): identical logic, Token-2022 program ID

## Library Usage

The benchmark harness (`benchmarks/run_tests.py`, `benchmarks/throughput_test.py`) imports directly from this package:

```python
from clients.python.evm.client import send_tx, load_abi, derive_account
from clients.python.solana.client import get_client, load_keypair, find_pda
from clients.python.shared.output import ms
```

## Output Format

All operations print JSON to stdout matching the `TxOutput` schema (identical to the TypeScript and .NET clients):

```json
{
  "chain": "evm",
  "operation": "contribute",
  "txHash": "0x...",
  "blockNumber": 42,
  "gasUsed": 103257,
  "status": "success",
  "timestamp": "2026-03-16T12:00:00.000Z",
  "elapsedMs": 45,
  "data": {}
}
```
