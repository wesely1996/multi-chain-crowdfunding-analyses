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

### Deploy (external network)

Add a network entry to `hardhat.config.ts` and set `PRIVATE_KEY` + RPC URL as environment variables, then:

```bash
npx hardhat run scripts/deploy.ts --network <network-name>
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
1 passing (267ms)
```

> A `websocket error` line printed before the test results is harmless — the test client
> connected momentarily before the validator WebSocket was ready. It does not affect results.

> **If port 8899 is already in use** (leftover validator from a previous run):
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

| Purpose | Public Key |
|---------|------------|
| Solana localnet wallet (veseli) | `J6qwPsQw3fkP6t4axc7tijndhSq1NqNpWACRBME4f3xn` |

> Keypair file: `/home/veseli/.config/solana/id.json` (WSL only — never commit this file).
> Store the seed phrase in a password manager, not in this repo.

## Version Matrix (tested baseline)

| Tool | Version |
|------|---------|
| Node.js | 20.x LTS |
| TypeScript | 5.4.x |
| Hardhat | 2.22.x |
| @openzeppelin/contracts | 5.1.x |
| Solidity | 0.8.20 |
| Rust | stable (1.84+) |
| Solana CLI | 3.0.15 (stable) |
| Anchor CLI | 0.32.1 |
| anchor-lang | 0.32.1 |
| anchor-spl | 0.32.1 |
