# Environment Setup

## EVM (Windows — native)

All EVM work runs natively on Windows via Node.js.

### Install and compile

```bash
cd contracts/evm
npm install
npx hardhat compile
```

Expected output:

```
Compiled 7 Solidity files successfully (evm target: paris)
```

### Run tests

```bash
npx hardhat test
# or run a single test file:
npx hardhat test test/CrowdfundingCampaign.test.ts
```

Tests use an in-process Hardhat network — no external node required.

### Deploy (local Hardhat network)

```bash
npx hardhat run scripts/deploy.ts
```

Deploys `MockERC20`, `CrowdfundingFactory`, and one sample campaign.
Prints a deployment summary table including all contract addresses.

### Deploy (external network — Sepolia)

#### 1. Create a MetaMask wallet

> Create a **dedicated test wallet** — never use your main/personal wallet for deployment.

1. Install the MetaMask browser extension from [metamask.io](https://metamask.io)
2. Click **Create a new wallet** and set a password
3. **Save the 12-word Secret Recovery Phrase** in a password manager — this is the only way to recover the wallet
4. Click the account circle (top-right) → **Add account or hardware wallet** → **Add a new Ethereum account**
   - Name it something like `Thesis Deployer` to keep it separate
5. Switch MetaMask to the **Sepolia** test network:
   - Click the network dropdown (top-left, shows "Ethereum Mainnet" by default)
   - Enable **Show test networks** if Sepolia is not listed
   - Select **Sepolia**
6. Get free Sepolia ETH from a faucet:
   - [Google Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) — no mainnet ETH required; paste your deployer address, select Sepolia, and request
   - [Alchemy Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia) — requires ≥ 0.001 ETH on Ethereum mainnet to claim

#### 2. Get a Sepolia RPC URL (Alchemy)

1. Go to [alchemy.com](https://alchemy.com) and click **Sign up**
2. Complete email verification and fill in the onboarding form:
   - **What are you building?** → select **Infra & Tooling**
   - **What chains are you building on?** → select **Ethereum** and **Solana**
3. From the dashboard click **+ Create new app**
   - Name: anything (e.g. `thesis-sepolia`)
   - Chain: **Ethereum**
   - Services to enable: **Node API**, **Websockets**, **Transaction Receipts API**, **Debug API**, **Trace API**, **Block Timestamp API**
   - Click **Create app**
4. Set network: **Ethereum Sepolia**
5. Open the newly created app → click **API Key** (top-right of the app card)
6. Copy the **HTTPS** endpoint — it looks like:
   ```
   https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
   ```

#### 3. Export your deployer private key (MetaMask)

1. Open MetaMask and switch to the `Thesis Deployer` account
2. Click the three-dot menu (⋮) next to the account name → **Account details**
3. Click **Show private key** → enter your MetaMask password → copy the key

> The private key starts with `0x` followed by 64 hex characters.
> Never share it or commit it to version control.

#### 4. Configure environment variables

```bash
cd contracts/evm
cp .env.example .env
# edit .env and paste your values:
#   PRIVATE_KEY=0xYOUR_PRIVATE_KEY
#   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```

> `.env` is gitignored — it will never be committed.

#### 5. Deploy

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

### Gas benchmark

```bash
npx hardhat run scripts/benchmark.ts
```

Runs a full 50-contributor sequential scenario on the in-process Hardhat network:

1. Deploys `MockERC20` + `CrowdfundingFactory` + one campaign (hardCap = 500 USDC, milestones [30%, 30%, 40%])
2. Mints and contributes 10 USDC from each of 50 signers (records `gasUsed` per tx)
3. Advances block time past the deadline (`evm_increaseTime`)
4. Calls `finalize()` (records gas)
5. Calls `withdrawMilestone()` × 3 (records gas each)
6. Prints avg / min / max gas table

The Hardhat network is pre-configured with 60 accounts (1 deployer + 59 contributors) in `hardhat.config.ts`.

Record benchmark output in `docs/measurements.md` for the thesis gas comparison table.

## Solana (WSL required on Windows)

The Solana/Anchor toolchain does **not** support native Windows.
Use WSL 2 (Ubuntu 22.04 recommended).

### Install WSL on Windows

Open **PowerShell as Administrator** (right-click the Start button → **Terminal (Admin)**) and run:

```powershell
wsl --install
```

This installs WSL 2 and Ubuntu 22.04 LTS in one step. Reboot when prompted.

On first launch Ubuntu asks you to create a Unix username and password — these are independent of your Windows credentials.

> If `wsl --install` reports that WSL is already installed but no distro is present, install Ubuntu explicitly:
>
> ```powershell
> wsl --install -d Ubuntu-22.04
> ```
>
> To verify WSL 2 is active after reboot:
>
> ```powershell
> wsl --list --verbose
> # NAME            STATE    VERSION
> # Ubuntu-22.04    Running  2       ← VERSION must be 2
> ```
>
> If it shows VERSION 1, upgrade with: `wsl --set-version Ubuntu-22.04 2`

### Open WSL

Three equivalent ways to open a WSL terminal:

| Method               | Steps                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Windows Terminal** | Open Windows Terminal → click the **˅** dropdown next to the `+` tab → select **Ubuntu-22.04**                |
| **Start menu**       | Search for **Ubuntu** → click the Ubuntu 22.04 app                                                            |
| **Run dialog**       | Press `Win + R` → type `wsl` → press Enter                                                                    |
| **PowerShell**       | Open PowerShell and run `wsl` (opens the default distro) or `wsl -d Ubuntu-22.04` to target a specific distro |

All subsequent Solana/Anchor commands in this guide must be run inside the WSL terminal.

> **Accessing Windows files from WSL:** your Windows drives are mounted under `/mnt/`.
> The repo is typically at `/mnt/c/Users/<your-name>/...`.
> Clone or work with the repo from inside WSL's home directory (`~/`) for best filesystem performance.

### One-time WSL setup

```bash
# 0. Prerequisites (C linker + SSL headers required to compile Rust crates)
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev

# 1. Install Rust (non-interactive)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 2. Install Solana CLI
# Note: release.solana.com has SSL issues in WSL; use the Anza mirror instead
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

# 3. Install Anchor CLI via AVM (Anchor Version Manager)
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.32.1
avm use 0.32.1

# 4. Install Node.js via nvm
# nvm is a shell function — source it immediately after install
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
# Add node binary to PATH directly so it is available to subprocesses (e.g. anchor test)
echo "export PATH=\"\$HOME/.nvm/versions/node/\$(node --version)/bin:\$PATH\"" >> ~/.bashrc

# 5. Generate a local Solana keypair (if you don't have one)
solana-keygen new --no-bip39-passphrase
```

### Build and test

```bash
cd contracts/solana
npm install
anchor build          # compiles the Rust program to SBF bytecode
anchor test           # spins up localnet validator + runs TS tests
```

Expected output for a clean run:

```
crowdfunding
  1. initialize_campaign with valid params creates campaign account
  2. contribute increases vault balance and mints receipt tokens
  3. contribute after deadline fails with DeadlinePassed
  4. contribute exceeding hardCap fails with HardCapExceeded
  5. finalize sets successful = true when total_raised >= softCap
  6. finalize sets successful = false when total_raised < softCap
  7. withdraw_milestone transfers tokens to creator and advances milestone
  8. refund returns payment tokens and burns receipt tokens
  9. refund on a successful campaign fails with NotFailed

9 passing (~15s)
```

> A `websocket error` line printed before the test results is harmless — the test client
> connected momentarily before the validator WebSocket was ready. It does not affect results.
>
> Tests 3, 5, and 6 each initialize a campaign with a 2-second deadline and call
> `await sleep(3000)` to let it expire before finalizing. The total suite takes ~15 seconds.

### Benchmark (N=50 sequential contributions)

The benchmark is a standalone script that must run against a live localnet validator
with the program already deployed. It does **not** use `anchor test`'s embedded validator.

```bash
# Terminal 1 — start a persistent localnet validator
cd ~
solana-test-validator --reset

# Terminal 2 — build, deploy, then run the benchmark
cd contracts/solana
anchor build
anchor deploy
npm run benchmark
```

Verified output (localnet, 2026-03-07):

```
========================================================================
Solana Crowdfunding Benchmark
Network : http://127.0.0.1:8899
N       : 50 sequential contributions
========================================================================
Setting up payment mint and contributors... done
Campaign : 8XwC4C7et1Eupz696zPErXeqbcPGRdjppUmBXbD61Q7L
Pre-creating receipt ATAs... done

Running 50 sequential contribute() calls...
  10 / 50
  20 / 50
  30 / 50
  40 / 50
  50 / 50

Setting up finalize / withdraw benchmark campaign (5-second deadline)...

========================================================================
Results
========================================================================
  contribute() [N=50]       fee avg/min/max (lamports):  10000 / 10000 / 10000   time avg/min/max (ms):   409 /  315 /  497
  finalize()                fee avg/min/max (lamports):   5000 /  5000 /  5000   time avg/min/max (ms):   306 /  306 /  306
  withdrawMilestone[0]      fee avg/min/max (lamports):  10000 / 10000 / 10000   time avg/min/max (ms):   479 /  479 /  479
  withdrawMilestone[1]      fee avg/min/max (lamports):  10000 / 10000 / 10000   time avg/min/max (ms):   340 /  340 /  340
  withdrawMilestone[2]      fee avg/min/max (lamports):  10000 / 10000 / 10000   time avg/min/max (ms):   451 /  451 /  451

  Throughput : 50 contributions in 20738 ms → 2.41 TPS

Fee note: Solana base fee = 5 000 lamports / signature (flat).
  0.000010000 SOL avg per contribute().
  (No gas-price equivalent; priority fees not set in this benchmark.)
========================================================================
```

> **Fee structure:** 5 000 lamports per signature. Transactions with two signers
> (contributor + fee-payer wallet, or creator + fee-payer wallet) cost 10 000 lamports.
> `finalize()` uses only the fee-payer as signer → 5 000 lamports.
> Fees are completely flat — no cold/warm storage spread, no analogue to EVM gas pricing.
>
> **TPS:** 2.41 sequential on localnet. Bounded by slot confirmation time (~400 ms/slot),
> not by compute — parallel submissions would be significantly higher.
>
> Record results in `docs/measurements.md` section M-V4 for the thesis comparison table.

> **If port 8899 is already in use** (leftover validator from a previous run):
>
> ```bash
> pkill -f solana-test-validator
> ```

> **Note for thesis reproducibility:** pin all versions in this file and in
> `Cargo.toml` / `Anchor.toml`. The versions above are the tested baseline.
>
> **Known issue — blake3 / edition 2024:** `anchor-lang 0.32.1` transitively pulls in
> `blake3 >=1.8.0` which requires Rust edition 2024 (stabilized in 1.85.0). Solana platform
> tools v1.51 bundle Rust 1.84. Workaround: pin `blake3 = "=1.7.0"` as a direct dependency
> in `programs/crowdfunding/Cargo.toml`. Already applied in this repo.
>
> **Known issue — yarn not found:** `Anchor.toml` test script uses `npx ts-mocha` (not `yarn`).
> Do not change it to `yarn run` unless yarn is explicitly installed.

## Local Development Keys

| Purpose                         | Public Key                                     |
| ------------------------------- | ---------------------------------------------- |
| Solana localnet wallet (veseli) | `J6qwPsQw3fkP6t4axc7tijndhSq1NqNpWACRBME4f3xn` |

> Keypair file: `/home/veseli/.config/solana/id.json` (WSL only — never commit this file).
> Store the seed phrase in a password manager, not in this repo.

## Integration Clients

Two integration clients interact with both EVM and Solana contracts. They execute the
full lifecycle (create, contribute, finalize, withdraw, refund, status) and emit
structured JSON output with txHash, gasUsed/fee, and timing data.

### TypeScript + viem (`clients/ts-evm/`)

#### Install

```bash
cd clients/ts-evm
npm install
```

#### Environment

```bash
cp .env.example .env
# Edit .env — populate contract addresses from deploy.ts output
```

Required EVM variables: `RPC_URL`, `PRIVATE_KEY`, `FACTORY_ADDRESS`, `CAMPAIGN_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`.
Required Solana variables: `SOLANA_RPC_URL`, `SOLANA_KEYPAIR_PATH`, `SOLANA_PROGRAM_ID`, `SOLANA_PAYMENT_MINT`, `SOLANA_CAMPAIGN_ADDRESS`, `SOLANA_CAMPAIGN_ID`.

#### EVM commands

All scripts use `tsx` for ESM execution. Run from `clients/ts-evm/`:

```bash
npm run create-campaign                          # defaults: softCap=100e6, hardCap=500e6, 30 days, [30,30,40]
npm run create-campaign -- --soft-cap 50000000 --hard-cap 200000000 --deadline-days 7

npm run contribute                               # default: 10 USDC (10000000 raw)
npm run contribute -- --amount 25000000

npm run finalize
npm run withdraw
npm run refund

npm run status
npm run status -- --contributor 0xABC...
```

#### Solana commands

```bash
npm run sol:create-campaign
npm run sol:create-campaign -- --soft-cap 100000000 --hard-cap 500000000 --deadline-seconds 1800

npm run sol:contribute
npm run sol:contribute -- --amount 10000000 --campaign <ADDRESS>

npm run sol:finalize
npm run sol:withdraw
npm run sol:refund

npm run sol:status
npm run sol:status -- --campaign <ADDRESS> --contributor <PUBKEY>
```

#### JSON output format

Every command emits a single JSON object to stdout:

```json
{
  "chain": "evm",
  "operation": "contribute",
  "txHash": "0x...",
  "blockNumber": 5,
  "gasUsed": 103257,
  "status": "success",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "elapsedMs": 145,
  "data": { "amount": "10000000" }
}
```

For Solana: `chain` = `"solana"`, `blockNumber` → slot, `gasUsed` → fee (lamports).

---

### .NET + Nethereum / Solnet (`clients/dotnet/`)

#### Prerequisites

- .NET 8 SDK (`dotnet --version` should return `8.x`)

#### Build

```bash
cd clients/dotnet
dotnet build
```

#### Environment

```bash
cp .env.example .env
# Edit .env — populate contract addresses from deploy.ts / anchor deploy output
```

Uses `dotenv.net` to load `.env`. Same variable names as the TS client for EVM;
Solana variables: `SOLANA_RPC_URL`, `SOLANA_KEYPAIR_PATH`, `SOLANA_PROGRAM_ID`,
`SOLANA_PAYMENT_MINT`, `SOLANA_CAMPAIGN_ADDRESS`, `SOLANA_CAMPAIGN_ID`.

#### EVM commands

```bash
dotnet run -- create-campaign
dotnet run -- create-campaign --soft-cap 50000000 --hard-cap 200000000 --deadline-days 7

dotnet run -- contribute
dotnet run -- contribute --amount 25000000

dotnet run -- finalize
dotnet run -- withdraw
dotnet run -- refund

dotnet run -- status
dotnet run -- status --contributor 0xABC...
```

#### Solana commands

```bash
dotnet run -- sol:create-campaign
dotnet run -- sol:create-campaign --soft-cap 100000000 --hard-cap 500000000 --deadline-seconds 1800

dotnet run -- sol:contribute
dotnet run -- sol:contribute --amount 10000000 --campaign <ADDRESS>

dotnet run -- sol:finalize --campaign <ADDRESS>
dotnet run -- sol:withdraw --campaign <ADDRESS>
dotnet run -- sol:refund --campaign <ADDRESS>

dotnet run -- sol:status
dotnet run -- sol:status --campaign <ADDRESS> --contributor <PUBKEY>
```

#### JSON output

Same D10 JSON schema as the TypeScript client. All output goes to stdout.

---

## Testing the Clients

### EVM — full lifecycle (both clients)

Prerequisites: Hardhat node running + contracts deployed.

```bash
# Terminal 1 — start Hardhat node
cd contracts/evm
npx hardhat node

# Terminal 2 — deploy contracts (note the addresses printed)
cd contracts/evm
npx hardhat run scripts/deploy.ts --network localhost
```

Copy the deployed addresses (`MockERC20`, `CrowdfundingFactory`, `CrowdfundingCampaign`)
into the `.env` files for both `clients/ts-evm/` and `clients/dotnet/`.

Then run the full lifecycle in order:

```bash
# ── TypeScript client ──
cd clients/ts-evm
npm run create-campaign
npm run contribute -- --amount 10000000
# (repeat contribute or advance time via Hardhat RPC to pass deadline)
npm run finalize
npm run withdraw         # if campaign succeeded (totalRaised >= softCap)
npm run refund           # if campaign failed (totalRaised < softCap)
npm run status

# ── .NET client (same node, same contracts) ──
cd clients/dotnet
dotnet run -- status     # verify it reads the same state
dotnet run -- contribute --amount 10000000
dotnet run -- status
```

To test the **refund path**, create a campaign with a high softCap, contribute less
than the softCap, advance time past the deadline, finalize, then refund:

```bash
# Advance Hardhat time by 31 days (from any client directory)
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[2678400],"id":1}'
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
```

### Solana — full lifecycle (both clients)

Prerequisites: WSL with Solana/Anchor toolchain installed (see above).

```bash
# Terminal 1 (WSL) — start local validator
cd ~
solana-test-validator --reset

# Terminal 2 (WSL) — deploy program + create SPL mint
cd /mnt/c/Users/<you>/Desktop/SCHOOL/Master\ rad/multi-chain-crowdfunding-analyses/contracts/solana
anchor build
anchor deploy
```

After deploying, you need an SPL token mint for payments. Create one with:

```bash
spl-token create-token --decimals 6
# Note the mint address → set as SOLANA_PAYMENT_MINT in .env
```

Update `.env` files in both `clients/ts-evm/` and `clients/dotnet/` with:
- `SOLANA_PROGRAM_ID` — from `anchor deploy` output
- `SOLANA_PAYMENT_MINT` — from `spl-token create-token` output
- `SOLANA_KEYPAIR_PATH` — path to your Solana keypair JSON file

Then run the lifecycle:

```bash
# ── TypeScript client ──
cd clients/ts-evm
npm run sol:create-campaign
# Copy the campaignAddress from output → set SOLANA_CAMPAIGN_ADDRESS in .env or pass --campaign

npm run sol:contribute -- --amount 10000000

# Wait for deadline to pass (default 1800s = 30 min; use --deadline-seconds 10 for quick testing)
npm run sol:finalize
npm run sol:withdraw      # success path
npm run sol:refund        # fail path
npm run sol:status

# ── .NET client ──
cd clients/dotnet
dotnet run -- sol:status --campaign <ADDRESS>
dotnet run -- sol:contribute --amount 10000000 --campaign <ADDRESS>
```

> **Quick test tip:** Use `--deadline-seconds 10` when creating a campaign so you
> only wait 10 seconds before finalize becomes callable.

### Cross-client verification

For thesis data integrity, run the same operation from both clients against the same
node and compare the JSON output:

```bash
# EVM — gasUsed must be identical for the same operation
cd clients/ts-evm && npm run status 2>/dev/null | jq .data.totalRaised
cd clients/dotnet && dotnet run -- status 2>/dev/null | jq .data.totalRaised
# Both should return the same value

# Solana — fee/slot should match for equivalent operations
```

Pipe any command output through `jq .` to validate JSON format.

---

## Version Matrix (tested baseline)

| Tool                    | Version         | Scope                                    |
| ----------------------- | --------------- | ---------------------------------------- |
| Node.js                 | 20.x LTS        | All TypeScript tooling                   |
| TypeScript              | 5.4.x           | EVM + Solana clients                     |
| Hardhat                 | 2.22.x          | EVM compilation, testing, local node     |
| @openzeppelin/contracts | 5.1.x           | ERC-20 base implementation               |
| Solidity                | 0.8.20          | EVM contract compiler                    |
| Rust                    | stable (1.84+)  | Solana program compilation               |
| Solana CLI              | 3.0.15 (stable) | Program deployment, account inspection   |
| Anchor CLI              | 0.32.1          | Build, test, deploy (contracts/solana/)  |
| anchor-lang             | 0.32.1          | Solana program framework                 |
| anchor-spl              | 0.32.1          | SPL Token CPI helpers                    |
| @coral-xyz/anchor (TS)  | 0.30.1          | TS client Anchor SDK (clients/ts-evm/)   |
| @solana/spl-token (TS)  | 0.3.11          | SPL token helpers                        |
| @solana/web3.js         | 1.95.4          | Solana RPC and transaction building      |
| viem                    | 2.21.x          | EVM client RPC and contract interaction  |
| tsx                     | 4.19.x          | TypeScript ESM execution                 |
| Nethereum.Web3          | 4.25.0          | .NET EVM client                          |
| dotenv.net              | 3.2.1           | .NET env var loading                     |
| Solnet.Rpc/Wallet       | 6.1.0           | .NET Solana client                       |
| .NET SDK                | 8.0             | .NET build toolchain                     |
