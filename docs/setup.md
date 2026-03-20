# Environment Setup

## Quick Start

Complete walk-through from a clean machine to viewing benchmark results in the dashboard. Follow sections in order; skip sections for platforms you have already set up.

### Prerequisites

| Tool       | Minimum version | Used for                                     |
| ---------- | --------------- | -------------------------------------------- |
| Node.js    | 20.x LTS        | EVM contracts, TypeScript clients, dashboard |
| Python     | 3.11+           | Benchmark harness                            |
| Rust       | 1.84+           | Solana program compilation                   |
| Solana CLI | 3.x stable      | Program deployment                           |
| Anchor CLI | 0.32.1          | Solana build, test, deploy                   |
| .NET SDK   | 8.0             | .NET client (optional)                       |

### Step 1 — EVM contracts

```bash
cd contracts/evm
npm install
npx hardhat compile             # compile V1/V2/V3 (expect: 12 files, cancun target)
npx hardhat test                # 77 tests — no external node needed
```

Start a local node (keep open in a separate terminal):

```bash
npx hardhat node
```

Deploy all three variants:

```bash
npx hardhat run scripts/deploy.ts --network localhost
# Note the printed MockERC20, Factory, and Campaign addresses for .env
```

### Step 2 — Solana programs

> On Windows, run all Solana commands inside WSL 2. See the [Solana](#solana) section for full WSL setup.

```bash
cd contracts/solana
npm install
anchor build        # compiles both crowdfunding (V4) and crowdfunding_token2022 (V5)
anchor test         # 18 passing (~60 s)
```

Start a persistent validator (keep open in a separate terminal):

```bash
solana-test-validator --reset
```

Deploy:

```bash
cd contracts/solana && anchor deploy
```

### Step 3 — Python benchmark harness

```bash
# From repo root — create (or reuse) the shared venv
cd benchmarks
python3 -m venv .venv && source .venv/bin/activate
python -m pip install --upgrade pip

# Install in stages — plain `pip install -r requirements.txt` will fail
# because web3 pins lru-dict<1.3.0 but 1.2.x has no prebuilt Linux/Windows wheel.
python -m pip install --no-deps web3==6.20.3
python -m pip install lru-dict==1.3.0
python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0
python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" \
    "eth-typing>=3.0.0,<5" "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" \
    "eth-hash[pycryptodome]>=0.5.1" "jsonschema>=4.0.0" "protobuf>=4.21.6" \
    aiohttp requests pyunormalize rlp "websockets>=10.0,<16.0" \
    typing-extensions "toolz>=0.11.2,<0.12.0"

# EVM lifecycle (Hardhat node must be running)
VARIANT=V1 CLIENT=python python run_tests.py --platform evm
VARIANT=V2 CLIENT=python python run_tests.py --platform evm
VARIANT=V3 CLIENT=python python run_tests.py --platform evm

# EVM throughput
VARIANT=V1 CLIENT=python python throughput_test.py --platform evm

# Solana lifecycle (solana-test-validator + anchor deploy must be running)
VARIANT=V4 CLIENT=python python run_tests.py --platform solana
VARIANT=V5 CLIENT=python python run_tests.py --platform solana

# Aggregate and compare
python collect_metrics.py
```

As a subprocess-driven client in the benchmark harness:

```bash
python benchmarks/run_client_benchmark.py \
    --platform evm --client python --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json

python benchmarks/run_throughput_client.py \
    --platform evm --client python --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
```

### Step 4 — TypeScript client

```bash
cd clients/ts
npm install
# Edit .env at repo root — paste addresses from Step 1 deploy output and Anchor.toml program IDs
```

#### EVM lifecycle

`--amount` takes **human-readable USDC** (e.g. `10` = 10 USDC); the client multiplies by 10⁶ internally. `--soft-cap` and `--hard-cap` use the same units.

After each `create-campaign`, copy `data.campaignAddress` from the JSON output into `.env` as `CAMPAIGN_ADDRESS_{VARIANT}` before running any other command — otherwise `contribute`/`finalize`/`withdraw` will silently hit the stale address from the previous deployment.

```bash
# 1. Create campaign (soft-cap 10 USDC → one contribution is enough to succeed)
VARIANT=V1 npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
# → copy data.campaignAddress from output → set CAMPAIGN_ADDRESS_V1=<address> in .env

# 2. Contribute (10 USDC = at or above soft-cap → campaign will succeed)
VARIANT=V1 npm run contribute -- --amount 10

# 3. Advance time past deadline (bash/WSL — see PowerShell equivalent below)
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[86401],"id":1}'
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'

# 4. Finalize → should report successful: true
VARIANT=V1 npm run finalize

# 5. Withdraw milestones (run 3× for [30,30,40] schedule)
VARIANT=V1 npm run withdraw
VARIANT=V1 npm run withdraw
VARIANT=V1 npm run withdraw

VARIANT=V1 npm run status
```

> **Refund path:** use a softCap above what you contribute (e.g. `--soft-cap 1000`), then after
> finalize call `npm run refund` instead of `withdraw`.

> **Other variants** — same steps, change `VARIANT`:
>
> ```bash
> VARIANT=V2 npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
> VARIANT=V3 npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
> ```

#### Solana lifecycle

Select V4 (SPL Token) or V5 (Token-2022) by setting `VARIANT`. Run inside the
WSL terminal (same environment as the running validator). Solana has no time-warp RPC — use a short `--deadline-seconds` instead.

```bash
# V4 — SPL Token (classic)
VARIANT=V4 npm run sol:create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-seconds 15
# → copy campaignAddress → set SOLANA_CAMPAIGN_ADDRESS in .env or pass --campaign <ADDRESS>
VARIANT=V4 npm run sol:contribute -- --amount 10
# wait 15 s for deadline to pass
VARIANT=V4 npm run sol:finalize
VARIANT=V4 npm run sol:withdraw
VARIANT=V4 npm run sol:status

# V5 — Token-2022 extensions (identical flow, different program)
VARIANT=V5 npm run sol:create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-seconds 15
VARIANT=V5 npm run sol:contribute -- --amount 10
# wait 15 s
VARIANT=V5 npm run sol:finalize
VARIANT=V5 npm run sol:withdraw
VARIANT=V5 npm run sol:status
```

### Step 5 — .NET client

```bash
cd clients/dotnet
dotnet build
# Edit .env at repo root — addresses from Step 1 deploy output and Anchor.toml program IDs
```

#### EVM lifecycle

```bash
VARIANT=V1 dotnet run -- create-campaign
# → copy data.campaignAddress from output → set CAMPAIGN_ADDRESS_V1=<address> in .env
VARIANT=V1 dotnet run -- contribute --amount 10
VARIANT=V1 dotnet run -- finalize
VARIANT=V1 dotnet run -- withdraw
VARIANT=V1 dotnet run -- status
```

> **Other variants:** change `VARIANT` to `V2` or `V3`.

#### Solana lifecycle (WSL only)

```bash
VARIANT=V4 dotnet run -- sol:create-campaign --deadline-seconds 15
# → copy campaignAddress → pass --campaign <ADDRESS> or set SOLANA_CAMPAIGN_ADDRESS in .env
VARIANT=V4 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
# wait 15 s for deadline to pass
VARIANT=V4 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:status

# V5 — Token-2022 (identical flow)
VARIANT=V5 dotnet run -- sol:create-campaign --deadline-seconds 15
VARIANT=V5 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:status
```

### Step 6 — Python client

The Python client (`clients/python/`) is a proper CLI client that mirrors the TypeScript and .NET clients. It shares the venv created in Step 3.

```bash
# Activate the venv from Step 3 (if not already active)
source benchmarks/.venv/bin/activate

# Load the root .env first (bash/WSL):
set -a; source .env; set +a

# EVM lifecycle — set VARIANT to select V1/V2/V3
VARIANT=V1 python -m clients.python evm:status
VARIANT=V1 python -m clients.python evm:contribute --amount 10000000
VARIANT=V2 python -m clients.python evm:contribute --amount 10000000
VARIANT=V3 python -m clients.python evm:contribute --amount 10000000

# Or override addresses per-command:
FACTORY_ADDRESS_V1=0x... CAMPAIGN_ADDRESS_V1=0x... PAYMENT_TOKEN_ADDRESS=0x... \
PRIVATE_KEY=0x... VARIANT=V1 \
  python -m clients.python evm:contribute --amount 10000000

# Solana lifecycle — set VARIANT to select V4/V5
VARIANT=V4 python -m clients.python sol:contribute --amount 10000000
VARIANT=V4 python -m clients.python sol:status
VARIANT=V5 python -m clients.python sol:contribute --amount 10000000
VARIANT=V5 python -m clients.python sol:status
```

### Step 7 — Dashboard

```bash
cd dashboard
npm install
npm run dev        # open http://localhost:3000
```

Result files from Step 3 appear automatically after a browser refresh. Use the **Run** panel to trigger live benchmarks from the UI.

### Testnet runs (canonical thesis data)

```bash
# EVM — Sepolia
EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY \
BENCHMARK_ENV=sepolia \
VARIANT=V1 CLIENT=python python benchmarks/run_tests.py --platform evm

# Solana — devnet
SOLANA_RPC_URL=https://api.devnet.solana.com \
BENCHMARK_ENV=solana-devnet \
VARIANT=V4 CLIENT=python python benchmarks/run_tests.py --platform solana
```

### Troubleshooting

| Symptom                                                     | Fix                                                                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Compiled 0 files`                                          | Run from `contracts/evm/` where `hardhat.config.ts` lives                                                                                                                          |
| `cannot connect to http://127.0.0.1:8545`                   | Start Hardhat node: `cd contracts/evm && npx hardhat node`                                                                                                                         |
| Port 8899 already in use                                    | `pkill -f solana-test-validator`                                                                                                                                                   |
| `anchor: command not found`                                 | Run `avm use 0.32.1` and check your PATH                                                                                                                                           |
| Dashboard shows no results                                  | Result files must have `"schema_version": "2"`; start `npm run dev` from `dashboard/`                                                                                              |
| V5 IDL not found                                            | Run `anchor build` in `contracts/solana/` first                                                                                                                                    |
| `DeclaredProgramIdMismatch` on deploy                       | Run `anchor keys sync && anchor build && anchor deploy` — keypair IDs drifted from `declare_id!` (common after validator reset or keypair regeneration)                            |
| `OSError: Cannot load native module 'Crypto.Util._cpuid_c'` | pycryptodome was installed from Git Bash (MinGW build). Reinstall from PowerShell: `.\.venv\Scripts\Activate.ps1` then `pip uninstall pycryptodome -y && pip install pycryptodome` |

---

## Windows Quick Start

On Windows, the EVM toolchain (Node.js, Python, dashboard) runs **natively**. Solana requires **WSL 2** — all Solana/Anchor commands must run inside a WSL terminal.

### Prerequisites — Windows native

Install the following using `winget` (Windows Package Manager, built into Windows 11) or the linked installers:

```powershell
winget install OpenJS.NodeJS.LTS          # Node.js 20.x LTS
winget install Python.Python.3.11         # Python 3.11+
winget install Git.Git                    # Git
winget install Microsoft.DotNet.SDK.8     # .NET 8 SDK (optional — .NET client only)
```

WSL 2 + Ubuntu 22.04 is required for Solana — see Step 2 below.

### Step 1 — EVM contracts (PowerShell or cmd)

```powershell
cd contracts\evm
npm install
npx hardhat compile        # expect: Compiled 12 Solidity files successfully
npx hardhat test           # 77 tests — no external node needed (~2s)
```

Start a local node (keep open in a separate terminal):

```powershell
npx hardhat node
```

Deploy all three variants:

```powershell
npx hardhat run scripts/deploy.ts --network localhost
# Note the printed MockERC20, Factory, and Campaign addresses for .env
```

### Step 2 — Solana programs (WSL 2)

**Install WSL 2** — open PowerShell as Administrator and run:

```powershell
wsl --install          # installs WSL 2 + Ubuntu 22.04; reboot when prompted
```

After rebooting, open the **Ubuntu** terminal (search "Ubuntu" in the Start menu or open Windows Terminal → Ubuntu tab). Complete the [one-time WSL setup](#one-time-wsl-setup), then:

```bash
# Inside the WSL terminal — navigate to the repo
# Windows drives are mounted at /mnt/c/...
cd "/mnt/c/Users/<your-name>/Desktop/SCHOOL/Master rad/multi-chain-crowdfunding-analyses/contracts/solana"
npm install
anchor build        # compiles V4 + V5 to SBF bytecode
anchor test         # 18 passing (~5 min)
```

> For best filesystem performance, clone the repo inside WSL's home directory (`~/`) rather than working from `/mnt/c/...`. Anchor build times are significantly faster on the native ext4 filesystem.

Start a persistent localnet validator (WSL terminal 1 — must run from WSL home `~`):

```bash
cd ~
solana-test-validator --reset
```

Deploy (WSL terminal 2):

```bash
cd "/mnt/c/Users/<your-name>/...  /contracts/solana"
anchor deploy
```

> If you see `DeclaredProgramIdMismatch` errors after deploy, the keypair-derived program ID no longer matches `declare_id!` in the source. Fix with:
>
> ```bash
> anchor keys sync   # patches declare_id! + Anchor.toml to match keypair files
> anchor build
> anchor deploy
> ```
>
> This is common after a validator reset or keypair regeneration. After a successful redeploy, update `SOLANA_PROGRAM_ID_V4` / `SOLANA_PROGRAM_ID_V5` in the root `.env`.

### Recreate venv from PowerShell

If you see C extension errors like `No module named 'bitarray._bitarray'`, `OSError: Cannot load native module 'Crypto.Util._cpuid_c'`, or `No module named 'ckzg'`, the venv was corrupted by packages installed from Git Bash (MinGW `.pyd` files that native Windows CPython cannot load). Delete and recreate it entirely from PowerShell:

```powershell
cd benchmarks
Remove-Item -Recurse -Force .venv
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Then re-run the install steps in Step 3 below. **Always run `pip install` from PowerShell, never from Git Bash, on Windows.**

### Step 3 — Python benchmark harness (PowerShell)

```powershell
cd benchmarks
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip

# Install in stages — plain `pip install -r requirements.txt` will fail
# because web3 pins lru-dict<1.3.0 but 1.2.x has no prebuilt Windows wheel.
python -m pip install --no-deps web3==6.20.3
python -m pip install lru-dict==1.3.0
python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0
python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" `
    "eth-typing>=3.0.0,<5" "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" `
    "eth-hash[pycryptodome]>=0.5.1" "jsonschema>=4.0.0" "protobuf>=4.21.6" `
    aiohttp requests pyunormalize rlp "websockets>=10.0,<16.0" `
    typing-extensions "toolz>=0.11.2,<0.12.0" ckzg

# EVM lifecycle (Hardhat node must be running)
$env:VARIANT = "V1"; $env:CLIENT = "python"; python run_tests.py --platform evm
$env:VARIANT = "V2"; $env:CLIENT = "python"; python run_tests.py --platform evm
$env:VARIANT = "V3"; $env:CLIENT = "python"; python run_tests.py --platform evm

# Aggregate results
python collect_metrics.py
```

> **Solana benchmarks must run inside WSL**, not PowerShell. The Python harness imports `anchorpy` and `solders`, which depend on the Solana CLI and Anchor toolchain — both WSL-only on Windows.
>
> The PowerShell venv (`.venv/`) uses Windows `.exe` binaries and **cannot be activated in WSL**. WSL needs its own Linux venv at `.venv-linux/`.
>
> **One-time WSL venv setup** (run once, from WSL):
>
> ```bash
> cd "/mnt/c/Users/<your-name>/Desktop/SCHOOL/Master rad/multi-chain-crowdfunding-analyses"
>
> # Install Python 3.12 if not present
> python3.12 --version 2>/dev/null || sudo apt-get install -y python3.12 python3.12-venv
>
> cd benchmarks
> python3.12 -m venv .venv-linux
> source .venv-linux/bin/activate
> python -m pip install --upgrade pip
> python -m pip install --no-deps web3==6.20.3
> python -m pip install lru-dict==1.3.0
> python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0
> python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" \
>     "eth-typing>=3.0.0,<5" "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" \
>     "eth-hash[pycryptodome]>=0.5.1" "jsonschema>=4.0.0" "protobuf>=4.21.6" \
>     aiohttp requests pyunormalize rlp "websockets>=10.0,<16.0" \
>     typing-extensions "toolz>=0.11.2,<0.12.0"
> ```
>
> **Running Solana benchmarks** (WSL, venv already set up):
>
> ```bash
> cd "/mnt/c/Users/<your-name>/Desktop/SCHOOL/Master rad/multi-chain-crowdfunding-analyses"
> source benchmarks/.venv-linux/bin/activate
>
> # solana-test-validator must be running (WSL terminal 1) and program deployed (Step 2)
> VARIANT=V4 CLIENT=python python benchmarks/run_tests.py --platform solana
> VARIANT=V5 CLIENT=python python benchmarks/run_tests.py --platform solana
> ```
>
> The EVM benchmarks (`--platform evm`) also work from WSL — Hardhat on `127.0.0.1:8545` is forwarded automatically by WSL 2.

### Step 4 — TypeScript client (PowerShell)

```powershell
cd clients\ts
npm install
# Edit .env at repo root — paste addresses from Step 1 deploy output and Anchor.toml program IDs
```

#### EVM lifecycle

**Key points for PowerShell:**

- `--amount` / `--soft-cap` / `--hard-cap` take **human-readable USDC** (e.g. `10` = 10 USDC) — the client multiplies by 10⁶ internally. Do **not** pass raw units.
- After `create-campaign`, copy `data.campaignAddress` from the JSON output into `.env` as `CAMPAIGN_ADDRESS_{VARIANT}` **before** running any other command.
- PowerShell's `curl` is an alias for `Invoke-WebRequest` — use `iwr` for Hardhat RPC calls, not Unix-style `curl -H/-d`.

```powershell
# 1. Create campaign (soft-cap 10 USDC → one contribution is enough to succeed)
$env:VARIANT = "V1"; npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
# → copy data.campaignAddress from JSON output
# → add/update in .env: CAMPAIGN_ADDRESS_V1=<address>

# 2. Contribute
$env:VARIANT = "V1"; npm run contribute -- --amount 10
for ($i = 0; $i -lt 9; $i++) { $env:VARIANT = "V1"; npm run contribute -- --amount 10 }

# 3. Advance time past the 1-day deadline
iwr http://127.0.0.1:8545 -Method POST -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[86401],"id":1}'
iwr http://127.0.0.1:8545 -Method POST -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'

# 4. Finalize → should report successful: true
$env:VARIANT = "V1"; npm run finalize

# 5. Withdraw milestones (run 3× for [30,30,40] schedule)
$env:VARIANT = "V1"; npm run withdraw
$env:VARIANT = "V1"; npm run withdraw
$env:VARIANT = "V1"; npm run withdraw

$env:VARIANT = "V1"; npm run status
```

> **Refund path:** use a softCap above what you contribute (e.g. `--soft-cap 1000`), then after
> finalize call `npm run refund` instead of `withdraw`.

> **Other variants** — same steps, change `VARIANT`:
>
> ```powershell
> $env:VARIANT = "V2"; npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
> $env:VARIANT = "V3"; npm run create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-days 1
> ```

#### Solana lifecycle

Run `sol:*` scripts inside the WSL terminal. Solana has no time-warp RPC — use a short
`--deadline-seconds` so you don't have to wait.

```bash
# V4 — SPL Token (classic)
VARIANT=V4 npm run sol:create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-seconds 15
# → copy campaignAddress → set SOLANA_CAMPAIGN_ADDRESS in .env or pass --campaign <ADDRESS>
VARIANT=V4 npm run sol:contribute -- --amount 10
# wait 15 s for deadline to pass
VARIANT=V4 npm run sol:finalize
VARIANT=V4 npm run sol:withdraw
VARIANT=V4 npm run sol:status

# V5 — Token-2022 extensions (identical flow, different program)
VARIANT=V5 npm run sol:create-campaign -- --soft-cap 10 --hard-cap 500 --deadline-seconds 15
VARIANT=V5 npm run sol:contribute -- --amount 10
# wait 15 s
VARIANT=V5 npm run sol:finalize
VARIANT=V5 npm run sol:withdraw
VARIANT=V5 npm run sol:status
```

### Step 5 — .NET client (PowerShell)

```powershell
cd clients\dotnet
dotnet build
# Edit .env at repo root — addresses from Step 1 deploy output and Anchor.toml program IDs
```

#### EVM lifecycle

```powershell
$env:VARIANT = "V1"; dotnet run -- create-campaign
# → copy data.campaignAddress from output
# → add/update in .env: CAMPAIGN_ADDRESS_V1=<address>
$env:VARIANT = "V1"; dotnet run -- contribute --amount 10
$env:VARIANT = "V1"; dotnet run -- finalize
$env:VARIANT = "V1"; dotnet run -- withdraw
$env:VARIANT = "V1"; dotnet run -- status
```

> **Other variants:** change `$env:VARIANT` to `"V2"` or `"V3"`.

#### Solana lifecycle (WSL only)

```bash
VARIANT=V4 dotnet run -- sol:create-campaign --deadline-seconds 15
VARIANT=V4 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:status

# V5 — Token-2022
VARIANT=V5 dotnet run -- sol:create-campaign --deadline-seconds 15
VARIANT=V5 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:status
```

### Step 6 — Python client (PowerShell)

The Python client shares the venv from Step 3. Run from the repo root.

```powershell
# Activate the venv (if not already active)
.\.venv\Scripts\Activate.ps1

# Load .env variables into the current shell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#].+?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}

# EVM lifecycle — set VARIANT to select V1/V2/V3
$env:VARIANT = "V1"; python -m clients.python evm:status
$env:VARIANT = "V1"; python -m clients.python evm:contribute --amount 10000000
$env:VARIANT = "V2"; python -m clients.python evm:contribute --amount 10000000
$env:VARIANT = "V3"; python -m clients.python evm:contribute --amount 10000000
```

> **Solana:** run `sol:*` commands inside WSL using the Linux venv (`.venv-linux`). See Step 3 for WSL venv setup.
>
> ```bash
> source benchmarks/.venv-linux/bin/activate
> set -a; source .env; set +a
> VARIANT=V4 python -m clients.python sol:contribute --amount 10000000
> VARIANT=V4 python -m clients.python sol:status
> VARIANT=V5 python -m clients.python sol:contribute --amount 10000000
> VARIANT=V5 python -m clients.python sol:status
> ```

### Step 7 — Dashboard (PowerShell)

```powershell
cd dashboard
npm install
npm run dev        # open http://localhost:3000
```

Result files from benchmark runs appear automatically after a browser refresh.

### Windows-specific notes

| Topic                                                                 | Note                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Python binary name**                                                | Windows installers register `python` (not `python3`). Use `python` everywhere.                                                                                                                                                                                                                        |
| **venv activation**                                                   | `.venv\Scripts\activate` — not `source .venv/bin/activate` (that is bash syntax).                                                                                                                                                                                                                     |
| **Environment variables**                                             | PowerShell: `$env:VAR = "value"`. cmd: `set VAR=value`. Both must be set before the command on the same line or as separate statements.                                                                                                                                                               |
| **Path separators**                                                   | Use `\` in PowerShell/cmd. Git Bash and WSL accept `/`. `npm run` scripts work with either.                                                                                                                                                                                                           |
| **Solana is WSL-only**                                                | Solana CLI and Anchor have no native Windows binaries. Every `anchor`, `solana`, and `solana-test-validator` command must run inside a WSL 2 terminal.                                                                                                                                                |
| **Cross-env file access**                                             | Your Windows files are at `/mnt/c/...` inside WSL. WSL files are at `\\wsl$\Ubuntu-22.04\home\<user>\` from Windows Explorer.                                                                                                                                                                         |
| **Port forwarding**                                                   | WSL 2 automatically forwards localhost ports. Hardhat node on `127.0.0.1:8545` and the Solana validator on `127.0.0.1:8899` are reachable from both Windows and WSL.                                                                                                                                  |
| **C extension load failures** (`_cpuid_c`, `_bitarray`, `ckzg`, etc.) | Packages were installed from Git Bash, which builds MinGW `.pyd` files that native Windows CPython cannot load. Fix: delete `.venv` and recreate it entirely from PowerShell — see [Recreate venv from PowerShell](#recreate-venv-from-powershell). Never run `pip install` from Git Bash on Windows. |

---

## EVM

All EVM work runs on Node.js (Linux, macOS, or Windows).

### Install and compile

```bash
cd contracts/evm
npm install
npx hardhat compile
```

Expected output:

```
Compiled 12 Solidity files successfully (evm target: cancun)
```

> The `evmVersion: "cancun"` setting is required because OZ v5 `ERC4626` uses `Memory.sol`
> which relies on the `mcopy` opcode introduced in the Cancun hard fork (EIP-5656).

### Run tests

```bash
npx hardhat test
# or run a single variant's tests:
npx hardhat test test/CrowdfundingCampaign.test.ts      # V1 ERC-20 (21 tests + 3 factory)
npx hardhat test test/CrowdfundingCampaign4626.test.ts  # V2 ERC-4626 (23 tests + 3 factory)
npx hardhat test test/CrowdfundingCampaign1155.test.ts  # V3 ERC-1155 (24 tests + 3 factory)
```

Tests use an in-process Hardhat network — no external node required. Total: **77 tests**.

### Deploy (local Hardhat network)

```bash
npx hardhat run scripts/deploy.ts
```

Deploys `MockERC20`, `CrowdfundingFactory` (V1), `CrowdfundingFactory4626` (V2), and
`CrowdfundingFactory1155` (V3), each with one sample campaign.
Prints three deployment summary tables including all contract and tier-token addresses.

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

Edit the root `.env` and paste your Sepolia values:

```
PRIVATE_KEY=0xYOUR_SEPOLIA_PRIVATE_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
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

Runs the same 50-contributor sequential scenario for all three EVM variants (V1 ERC-20,
V2 ERC-4626, V3 ERC-1155 Bronze tier) on the in-process Hardhat network, then prints a
side-by-side comparison table:

1. Deploy `MockERC20` + factory + campaign for each variant (sequentially)
2. Mint and contribute from each of 50 signers — record `gasUsed` per tx
3. Advance block time past deadline (`evm_increaseTime`)
4. Call `finalize()` — record gas
5. Call `withdrawMilestone()` × 3 — record gas each
6. Print avg / min / max and side-by-side cross-variant comparison table

The Hardhat network is pre-configured with 60 accounts (1 deployer + 59 contributors) in `hardhat.config.ts`.

Record benchmark output in `docs/measurements.md` for the thesis gas comparison table.

## Solana

The Solana/Anchor toolchain runs on Linux and macOS. On Windows, use WSL 2 (Ubuntu 22.04 recommended). On native Ubuntu/Linux, run the commands below directly — no WSL needed.

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

The Solana workspace contains two Anchor programs:

| Program                  | Variant                    | Program ID                                     |
| ------------------------ | -------------------------- | ---------------------------------------------- |
| `crowdfunding`           | V4 — SPL Token (classic)   | `4agCFfWuoR6MPGXeAb6cXQTHcWmxvqD29uanxJd4bkXv` |
| `crowdfunding_token2022` | V5 — Token-2022 extensions | `AtaYCBbNJJwwwckTouZ2G4ZgrzPNT2JtZF1yL7zUxQpC` |

```bash
cd contracts/solana
npm install
anchor build          # compiles both programs to SBF bytecode
anchor test           # spins up localnet validator + runs TS tests for both programs
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

> **V5 (Token-2022) program:** `crowdfunding_token2022` exposes identical instructions and PDA
> seeds to V4. The only internal difference is the use of `anchor_spl::token_2022` CPI calls
> and the `Token2022` program constant. Both programs are built and tested by `anchor build` /
> `anchor test` in a single command.

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

### TypeScript + viem (`clients/ts/`)

#### Install

```bash
cd clients/ts
npm install
```

#### Environment

All variables are read from the root `.env`. Populate it with addresses from `deploy.ts` output and `Anchor.toml` program IDs.

Required EVM variables: `RPC_URL`, `PRIVATE_KEY`, `VARIANT`, `FACTORY_ADDRESS_{VARIANT}`, `CAMPAIGN_ADDRESS_{VARIANT}`, `PAYMENT_TOKEN_ADDRESS`.
Required Solana variables: `SOLANA_RPC_URL`, `SOLANA_KEYPAIR_PATH`, `SOLANA_PROGRAM_ID_V4` / `SOLANA_PROGRAM_ID_V5`, `SOLANA_PAYMENT_MINT`, `SOLANA_CAMPAIGN_ADDRESS`, `SOLANA_CAMPAIGN_ID`.

#### EVM commands

All scripts use `tsx` for ESM execution. Run from `clients/ts/`.
Set `VARIANT` to select the contract version — the client reads `FACTORY_ADDRESS_{VARIANT}`
and `CAMPAIGN_ADDRESS_{VARIANT}` from `.env`.

```bash
# V1 — ERC-20 receipt tokens
VARIANT=V1 npm run create-campaign                          # defaults: softCap=100 USDC, hardCap=500 USDC, 30 days, [30,30,40]
VARIANT=V1 npm run create-campaign -- --soft-cap 50 --hard-cap 200 --deadline-days 7
VARIANT=V1 npm run contribute                               # default: 10 USDC
VARIANT=V1 npm run contribute -- --amount 25
VARIANT=V1 npm run finalize
VARIANT=V1 npm run withdraw
VARIANT=V1 npm run refund
VARIANT=V1 npm run status
VARIANT=V1 npm run status -- --contributor 0xABC...

# V2 — ERC-4626 vault shares
VARIANT=V2 npm run create-campaign
VARIANT=V2 npm run contribute -- --amount 25
VARIANT=V2 npm run finalize && VARIANT=V2 npm run withdraw

# V3 — ERC-1155 tier tokens
VARIANT=V3 npm run create-campaign
VARIANT=V3 npm run contribute -- --amount 25
VARIANT=V3 npm run finalize && VARIANT=V3 npm run withdraw
```

#### Solana commands

Set `VARIANT` to switch between V4 (SPL Token classic) and V5 (Token-2022).
Run inside WSL.

```bash
# V4 — SPL Token (classic)
VARIANT=V4 npm run sol:create-campaign
VARIANT=V4 npm run sol:create-campaign -- --soft-cap 100000000 --hard-cap 500000000 --deadline-seconds 1800
VARIANT=V4 npm run sol:contribute
VARIANT=V4 npm run sol:contribute -- --amount 10 --campaign <ADDRESS>
VARIANT=V4 npm run sol:finalize
VARIANT=V4 npm run sol:withdraw
VARIANT=V4 npm run sol:refund
VARIANT=V4 npm run sol:status
VARIANT=V4 npm run sol:status -- --campaign <ADDRESS> --contributor <PUBKEY>

# V5 — Token-2022 extensions
VARIANT=V5 npm run sol:create-campaign -- --deadline-seconds 1800
VARIANT=V5 npm run sol:contribute -- --amount 10 --campaign <ADDRESS>
VARIANT=V5 npm run sol:finalize
VARIANT=V5 npm run sol:withdraw
VARIANT=V5 npm run sol:refund
VARIANT=V5 npm run sol:status -- --campaign <ADDRESS>
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

All variables are read from the root `.env`. Populate it with addresses from `deploy.ts` / `anchor deploy` output.

Uses `dotenv.net` to load `../../.env` (resolved from `clients/dotnet/`). Same variable names as the TS client for EVM;
Solana variables: `SOLANA_RPC_URL`, `SOLANA_KEYPAIR_PATH`, `SOLANA_PROGRAM_ID_V4` / `SOLANA_PROGRAM_ID_V5`,
`SOLANA_PAYMENT_MINT`, `SOLANA_CAMPAIGN_ADDRESS`, `SOLANA_CAMPAIGN_ID`.

#### EVM commands

Set `VARIANT` to select the contract version. Pass it as an environment variable or
set `VARIANT=V1` in `.env`.

```bash
# V1 — ERC-20 receipt tokens
VARIANT=V1 dotnet run -- create-campaign
VARIANT=V1 dotnet run -- create-campaign --soft-cap 50 --hard-cap 200 --deadline-days 7
VARIANT=V1 dotnet run -- contribute
VARIANT=V1 dotnet run -- contribute --amount 25
VARIANT=V1 dotnet run -- finalize
VARIANT=V1 dotnet run -- withdraw
VARIANT=V1 dotnet run -- refund
VARIANT=V1 dotnet run -- status
VARIANT=V1 dotnet run -- status --contributor 0xABC...

# V2 — ERC-4626 vault shares
VARIANT=V2 dotnet run -- create-campaign
VARIANT=V2 dotnet run -- contribute --amount 25
VARIANT=V2 dotnet run -- finalize && VARIANT=V2 dotnet run -- withdraw

# V3 — ERC-1155 tier tokens
VARIANT=V3 dotnet run -- create-campaign
VARIANT=V3 dotnet run -- contribute --amount 25
VARIANT=V3 dotnet run -- finalize && VARIANT=V3 dotnet run -- withdraw
```

#### Solana commands

Set `VARIANT` to switch between V4 (SPL Token) and V5 (Token-2022). Run inside WSL.

```bash
# V4 — SPL Token (classic)
VARIANT=V4 dotnet run -- sol:create-campaign
VARIANT=V4 dotnet run -- sol:create-campaign --soft-cap 100000000 --hard-cap 500000000 --deadline-seconds 1800
VARIANT=V4 dotnet run -- sol:contribute
VARIANT=V4 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:refund --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:status
VARIANT=V4 dotnet run -- sol:status --campaign <ADDRESS> --contributor <PUBKEY>

# V5 — Token-2022 extensions
VARIANT=V5 dotnet run -- sol:create-campaign --deadline-seconds 1800
VARIANT=V5 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:finalize --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:withdraw --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:refund --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:status --campaign <ADDRESS>
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
into the root `.env` (`PAYMENT_TOKEN_ADDRESS`, `FACTORY_ADDRESS_V1`, `CAMPAIGN_ADDRESS_V1`).

> **After each `create-campaign` run:** the new campaign address is printed in the JSON output
> (`data.campaignAddress`). Copy it into `.env` as `CAMPAIGN_ADDRESS_{VARIANT}` before running
> `contribute`, `finalize`, or `withdraw` — otherwise those scripts will use the stale address
> from the previous deployment.

Then run the full lifecycle in order. Set `VARIANT` to select which deployed contract to use:

```bash
# ── TypeScript client — V1 (ERC-20) ──
cd clients/ts
VARIANT=V1 npm run create-campaign
VARIANT=V1 npm run contribute -- --amount 10
# (repeat contribute or advance time via Hardhat RPC to pass deadline)
VARIANT=V1 npm run finalize
VARIANT=V1 npm run withdraw         # if campaign succeeded (totalRaised >= softCap)
VARIANT=V1 npm run refund           # if campaign failed (totalRaised < softCap)
VARIANT=V1 npm run status

# ── TypeScript client — V2 (ERC-4626) ──
VARIANT=V2 npm run create-campaign
VARIANT=V2 npm run contribute -- --amount 10
VARIANT=V2 npm run finalize && VARIANT=V2 npm run withdraw

# ── TypeScript client — V3 (ERC-1155) ──
VARIANT=V3 npm run create-campaign
VARIANT=V3 npm run contribute -- --amount 10
VARIANT=V3 npm run finalize && VARIANT=V3 npm run withdraw

# ── .NET client (same node, same contracts) ──
cd clients/dotnet
VARIANT=V1 dotnet run -- status     # verify it reads the same state
VARIANT=V1 dotnet run -- contribute --amount 10
VARIANT=V2 dotnet run -- status
```

To test the **refund path**, create a campaign with a high softCap, contribute less
than the softCap, advance time past the deadline, finalize, then refund:

```powershell
# Advance Hardhat time by 31 days (PowerShell — curl is Invoke-WebRequest here, not Unix curl)
iwr http://127.0.0.1:8545 -Method POST -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[2678400],"id":1}'
iwr http://127.0.0.1:8545 -Method POST -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
```

```bash
# Advance Hardhat time by 31 days (bash / WSL / Git Bash)
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

Update the root `.env` with:

- `SOLANA_PROGRAM_ID_V4` — from `anchor deploy` output (crowdfunding program)
- `SOLANA_PAYMENT_MINT` — from `spl-token create-token` output
- `SOLANA_KEYPAIR_PATH` — path to your Solana keypair JSON file

Then run the lifecycle. Set `VARIANT` to select V4 (SPL Token) or V5 (Token-2022):

```bash
# ── TypeScript client — V4 (SPL Token) ──
cd clients/ts
VARIANT=V4 npm run sol:create-campaign -- --deadline-seconds 10
# Copy the campaignAddress from output → set SOLANA_CAMPAIGN_ADDRESS in .env or pass --campaign
VARIANT=V4 npm run sol:contribute -- --amount 10
# Wait for deadline (10 s with --deadline-seconds 10)
VARIANT=V4 npm run sol:finalize
VARIANT=V4 npm run sol:withdraw      # success path
VARIANT=V4 npm run sol:refund        # fail path
VARIANT=V4 npm run sol:status

# ── TypeScript client — V5 (Token-2022) ──
VARIANT=V5 npm run sol:create-campaign -- --deadline-seconds 10
VARIANT=V5 npm run sol:contribute -- --amount 10
VARIANT=V5 npm run sol:finalize
VARIANT=V5 npm run sol:withdraw
VARIANT=V5 npm run sol:status

# ── .NET client ──
cd clients/dotnet
VARIANT=V4 dotnet run -- sol:status --campaign <ADDRESS>
VARIANT=V4 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
VARIANT=V5 dotnet run -- sol:contribute --amount 10 --campaign <ADDRESS>
```

> **Quick test tip:** Use `--deadline-seconds 10` when creating a campaign so you
> only wait 10 seconds before finalize becomes callable.

### Cross-client verification

For thesis data integrity, run the same operation from both clients against the same
node and compare the JSON output:

```bash
# EVM — gasUsed must be identical for the same variant and operation
VARIANT=V1 npm run status 2>/dev/null | jq .data.totalRaised    # from clients/ts
VARIANT=V1 dotnet run -- status 2>/dev/null | jq .data.totalRaised  # from clients/dotnet
# Both should return the same value

# Repeat for other EVM variants
VARIANT=V2 npm run status 2>/dev/null | jq .data.totalRaised
VARIANT=V3 npm run status 2>/dev/null | jq .data.totalRaised

# Solana — fee/slot should match for equivalent variant and operation
VARIANT=V4 npm run sol:status 2>/dev/null | jq .data.totalRaised
VARIANT=V5 npm run sol:status 2>/dev/null | jq .data.totalRaised
```

Pipe any command output through `jq .` to validate JSON format.

---

## Python Benchmarks (`benchmarks/`)

A Python harness that runs the full crowdfunding lifecycle on both EVM and Solana,
records per-operation cost and latency, and prints a cross-chain comparison table.

### Prerequisites

- Python 3.12 (3.11–3.13 also work; 3.14 is untested)
- Hardhat node running for EVM benchmarks
- `solana-test-validator` running + program deployed for Solana benchmarks

### Install (Ubuntu / Linux)

Due to the `lru-dict` version conflict with web3, install in stages (same as Windows):

```bash
cd benchmarks
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

# 1. web3 without deps (avoids lru-dict<1.3.0 constraint)
python -m pip install --no-deps web3==6.20.3

# 2. lru-dict 1.3.0 (has prebuilt wheel; ignore the <1.3.0 warning)
python -m pip install lru-dict==1.3.0

# 3. Solana + formatting
python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0

# 4. web3 runtime deps (including ckzg — EIP-4844 blob tx; hard-imported by web3 6.x)
python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" \
    "eth-typing>=3.0.0,<5" "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" \
    "eth-hash[pycryptodome]>=0.5.1" "jsonschema>=4.0.0" "protobuf>=4.21.6" \
    aiohttp requests pyunormalize rlp "websockets>=10.0,<16.0" \
    typing-extensions "toolz>=0.11.2,<0.12.0" ckzg
```

Verify:

```bash
python -c "from web3 import Web3; print('web3 OK')"
python -c "import anchorpy; print('anchorpy OK')"
python -c "import tabulate; print('tabulate OK')"
```

### Install (Windows — PowerShell)

`web3==6.20.3` depends on `lru-dict<1.3.0` which has no prebuilt Windows wheel.
`lru-dict==1.3.0` has a wheel and is API-identical — we force-install it.
A plain `pip install -r requirements.txt` will fail; use this procedure instead:

```powershell
cd benchmarks
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip

# 1. web3 without deps (avoids lru-dict<1.3.0 constraint)
python -m pip install --no-deps web3==6.20.3

# 2. lru-dict 1.3.0 (has prebuilt wheel; ignore the <1.3.0 warning)
python -m pip install lru-dict==1.3.0

# 3. Solana + formatting
python -m pip install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0

# 4. web3 runtime deps (including ckzg — EIP-4844 blob tx; hard-imported by web3 6.x)
python -m pip install "eth-abi>=4.0.0" "eth-account>=0.8.0,<0.13" ^
    "eth-typing>=3.0.0,<5" "eth-utils>=2.1.0,<5" "hexbytes>=0.1.0,<0.4.0" ^
    "eth-hash[pycryptodome]>=0.5.1" "jsonschema>=4.0.0" "protobuf>=4.21.6" ^
    aiohttp requests pyunormalize rlp "websockets>=10.0,<16.0" ^
    typing-extensions "toolz>=0.11.2,<0.12.0" ckzg
```

Verify:

```powershell
python -c "from web3 import Web3; print('web3 OK')"
python -c "import anchorpy; print('anchorpy OK')"
python -c "import tabulate; print('tabulate OK')"
```

> **Safe-to-ignore pip warnings:**
>
> | Warning                                            | Why it's fine                                             |
> | -------------------------------------------------- | --------------------------------------------------------- |
> | `web3 requires lru-dict<1.3.0, but you have 1.3.0` | API-identical; 1.2.x has no Linux/Windows wheel for 1.2.x |
> | `web3 requires pywin32>=223`                       | Only used for Windows IPC transport; we use HTTP JSON-RPC |

### Configuration

All tunable constants live in `benchmarks/config.py`. Override via environment
variables:

| Variable               | Default                          | Description                                                  |
| ---------------------- | -------------------------------- | ------------------------------------------------------------ |
| `EVM_RPC_URL`          | `http://127.0.0.1:8545`          | Hardhat JSON-RPC endpoint                                    |
| `EVM_MNEMONIC`         | Hardhat default test mnemonic    | HD wallet mnemonic (localnet only)                           |
| `SOLANA_RPC_URL`       | `http://127.0.0.1:8899`          | Solana validator RPC endpoint                                |
| `ANCHOR_WALLET`        | `~/.config/solana/id.json`       | Payer keypair path                                           |
| `SOLANA_PROGRAM_ID_V4` | `4agCFfWu...` (from Anchor.toml) | V4 deployed program ID                                       |
| `SOLANA_PROGRAM_ID_V5` | `AtaYCBbN...` (from Anchor.toml) | V5 deployed program ID                                       |
| `N_CONTRIBUTIONS`      | `50`                             | Number of sequential contributions                           |
| `VARIANT`              | `V1`                             | Contract variant tag: V1 ERC-20, V4 SPL, V2, V3, V5          |
| `CLIENT`               | `python`                         | Client label: python, ts, dotnet                             |
| `BENCHMARK_ENV`        | _(auto-detected)_                | Override environment label (e.g. `sepolia`, `solana-devnet`) |

`BENCHMARK_ENV` is inferred from the RPC URL if not set: `infura`/`alchemy`/`sepolia`
in `EVM_RPC_URL` → `sepolia`; `devnet` in `SOLANA_RPC_URL` → `solana-devnet`.

Scenario constants (same on both chains for fair comparison):

- **Contribution:** 10 USDC per contributor (6 decimals)
- **Soft cap:** 100 USDC (reachable at N=10)
- **Hard cap:** 500 USDC (reachable at N=50)
- **Milestones:** [30, 30, 40]
- **Refund scenario:** soft cap set to 400 USDC (unreachable by 5 contributors) → campaign fails

### Scripts

#### `run_tests.py` — Full lifecycle benchmark

Exercises both the **success path** (create → contribute×N → finalize → withdraw×3)
and the **refund path** (create → contribute×5 → finalize → refund×5).

```bash
# EVM only (start Hardhat node first: cd contracts/evm && npx hardhat node)
python benchmarks/run_tests.py --platform evm

# Tag with variant and client for the multi-variant matrix
VARIANT=V1 CLIENT=python python benchmarks/run_tests.py --platform evm
VARIANT=V2 CLIENT=python python benchmarks/run_tests.py --platform evm
VARIANT=V3 CLIENT=python python benchmarks/run_tests.py --platform evm

# Solana variants (start solana-test-validator + anchor deploy first)
VARIANT=V4 CLIENT=python python benchmarks/run_tests.py --platform solana
VARIANT=V5 CLIENT=python python benchmarks/run_tests.py --platform solana

# Sepolia (set EVM_RPC_URL before running)
EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY \
VARIANT=V1 CLIENT=python python benchmarks/run_tests.py --platform evm
```

Output: `benchmarks/results/V1_python_hardhat-localnet_lifecycle.json`
(and legacy `benchmarks/results/evm_raw.json` for backward compat).

#### `throughput_test.py` — Isolated TPS measurement

Focuses solely on throughput: pre-creates all accounts/approvals outside the
timed window, then submits N sequential contributions with wall-clock timing.

```bash
python benchmarks/throughput_test.py --platform evm
VARIANT=V1 CLIENT=python python benchmarks/throughput_test.py --platform evm
python benchmarks/throughput_test.py --platform solana
```

Output: `benchmarks/results/V1_python_hardhat-localnet_throughput.json`

#### `deploy_evm.py` — Standalone EVM deployer

Deploys MockERC20, CrowdfundingFactory, and a campaign in one step. Prints a
JSON object with all addresses to **stdout** — suitable for piping into shell
variables or passing to the client benchmark scripts.

```bash
# Hardhat localnet
python benchmarks/deploy_evm.py --variant V1 > /tmp/evm_deploy.json
cat /tmp/evm_deploy.json
# {"variant":"V1","environment":"hardhat-localnet","mockERC20":"0x5Fb...","factory":"0xe7f...","campaign":"0x9fE..."}

# Sepolia
EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY \
EVM_PRIVATE_KEY=0x... \
python benchmarks/deploy_evm.py --variant V1 --env sepolia > /tmp/evm_deploy_sepolia.json
```

#### `run_client_benchmark.py` — Lifecycle benchmark via TS or .NET clients

Drives `npm run <op>` (ts) or `dotnet run -- <op>` (dotnet) as subprocesses
for each operation, parses their TxOutput JSON stdout, and writes a canonical
schema v2 result file.

```bash
# ts client, V1, hardhat-localnet
python benchmarks/run_client_benchmark.py \
    --platform evm --client ts --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
# → benchmarks/results/V1_ts_hardhat-localnet_lifecycle.json

# dotnet client, V1, hardhat-localnet
python benchmarks/run_client_benchmark.py \
    --platform evm --client dotnet --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
# → benchmarks/results/V1_dotnet_hardhat-localnet_lifecycle.json

# ts client, V4, solana-localnet
python benchmarks/run_client_benchmark.py \
    --platform solana --client ts --variant V4 --env solana-localnet
# → benchmarks/results/V4_ts_solana-localnet_lifecycle.json
```

> **Cross-client gas parity:** `ts/contribute.ts` bundles `approve` + `contribute`
> gas in its top-level `gasUsed`. The runner reads `data.contributeGasUsed` instead,
> so all clients report the same on-chain contribute gas for valid comparison.

#### `run_throughput_client.py` — Throughput-only benchmark via TS or .NET clients

Same subprocess approach as above but measures only the N-contribution window.
Records both `latency_ms` (client-measured elapsed) and `process_elapsed_ms`
(wall-clock including subprocess startup overhead) separately.

```bash
python benchmarks/run_throughput_client.py \
    --platform evm --client ts --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
# → benchmarks/results/V1_ts_hardhat-localnet_throughput.json
```

#### `collect_metrics.py` — Aggregate and compare

Scans the results directory, loads all `*_lifecycle.json` files, and prints
comparison tables. Supports multiple output formats for thesis integration.

```bash
# Scan all results, print github-markdown table (default)
python benchmarks/collect_metrics.py

# Specify directory
python benchmarks/collect_metrics.py --results-dir benchmarks/results/

# Output formats
python benchmarks/collect_metrics.py --format csv
python benchmarks/collect_metrics.py --format latex

# Write LaTeX table to file (for thesis appendix)
python benchmarks/collect_metrics.py --format latex \
    --output benchmarks/results/thesis_table.tex

# Legacy two-file mode (backward compat)
python benchmarks/collect_metrics.py \
    --evm benchmarks/results/evm_raw.json \
    --solana benchmarks/results/solana_raw.json
```

Output: multi-variant summary table + per-variant cross-chain operation tables.
Also writes `benchmarks/results/comparison_summary.json`.

### Output schema (schema_version "2")

Result files use the canonical schema v2 format:

```json
{
  "schema_version": "2",
  "variant": "V1",
  "variant_label": "ERC-20 receipt tokens",
  "client": "python",
  "client_label": "Python web3.py / anchorpy",
  "environment": "hardhat-localnet",
  "platform": "EVM",
  "chain_id": 31337,
  "timestamp_utc": 1741737600,
  "limitations": ["Hardhat automines instantly; ..."],
  "operations": [
    {
      "name": "contribute",
      "scenario": "success",
      "gas_used": 103257,
      "cost": "103257",
      "latency_ms": 5,
      "process_elapsed_ms": null,
      "tx_hash": "0x..."
    }
  ],
  "throughput": {
    "num_contributions": 50,
    "total_time_ms": 1234,
    "tps": 40.52
  }
}
```

**Field notes:**

- `scenario`: `"success"` (contribute/finalize/withdraw), `"refund"`, or `"throughput"`
- `process_elapsed_ms`: wall-clock time including subprocess startup (null for Python harness, populated for ts/dotnet client benchmark)
- **EVM `cost`:** gas used as a string integer. Fiat conversion requires live gas price.
- **Solana `cost`:** fee in lamports (flat 5,000 lam/sig). The `compute_units` field is null in localnet runs (planned for devnet).

### Result file naming

```
benchmarks/results/{VARIANT}_{CLIENT}_{ENV}_{kind}.json

Examples:
  V1_python_hardhat-localnet_lifecycle.json
  V1_ts_hardhat-localnet_lifecycle.json
  V1_dotnet_hardhat-localnet_lifecycle.json
  V4_python_solana-localnet_lifecycle.json
  V4_ts_solana-localnet_lifecycle.json
  V1_python_sepolia_lifecycle.json
  V4_python_solana-devnet_throughput.json
```

Legacy files `evm_raw.json` / `solana_raw.json` are still written by the Python
harness for backward compatibility with old `collect_metrics.py --evm` invocations.

### Phase 2 — Client-layer benchmark workflow

Full end-to-end sequence for running all three clients against EVM localnet:

```bash
REPO=/path/to/multi-chain-crowdfunding-analyses
source $REPO/benchmarks/.venv/bin/activate
cd $REPO

# 1. Start Hardhat node (keep open)
cd contracts/evm && npx hardhat node &

# 2. Deploy contracts, capture addresses
python benchmarks/deploy_evm.py --variant V1 > /tmp/evm_deploy.json

# 3. Edit root .env — paste addresses from /tmp/evm_deploy.json:
#   FACTORY_ADDRESS_V1=...  CAMPAIGN_ADDRESS_V1=...  PAYMENT_TOKEN_ADDRESS=...
# (ts and dotnet clients both read from the root .env automatically)

# 4. Python re-baseline
VARIANT=V1 CLIENT=python python benchmarks/run_tests.py --platform evm
VARIANT=V1 CLIENT=python python benchmarks/throughput_test.py --platform evm

# 5. ts lifecycle + throughput
python benchmarks/run_client_benchmark.py \
    --platform evm --client ts --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
python benchmarks/run_throughput_client.py \
    --platform evm --client ts --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json

# 6. dotnet lifecycle + throughput
python benchmarks/run_client_benchmark.py \
    --platform evm --client dotnet --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json
python benchmarks/run_throughput_client.py \
    --platform evm --client dotnet --variant V1 --env hardhat-localnet \
    --deploy-json /tmp/evm_deploy.json

# 7. Collect results
python benchmarks/collect_metrics.py --format github
python benchmarks/collect_metrics.py --format latex \
    --output benchmarks/results/thesis_table.tex
```

### Single root `.env`

All clients (Hardhat, TS, .NET, Python) read from one file at the repo root:

```
.env          ← gitignored; your local values
.env.example  ← committed template with placeholders
```

To switch to Sepolia, update these keys in root `.env`:

```
PRIVATE_KEY=0xYOUR_FUNDED_SEPOLIA_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```

For Python benchmarks, export before running:

```bash
# bash / WSL
set -a; source .env; set +a

# PowerShell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#].+?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}
```

### Limitations

These must be acknowledged in the thesis methodology section:

1. **Hardhat automines instantly.** EVM latency reflects local execution time
   only — no mempool wait, no block propagation. Re-run on Sepolia for real
   network latency.
2. **solana-test-validator is single-threaded.** TPS does not represent
   production conditions. Re-run on devnet for a more representative figure.
3. **Sequential methodology.** Contributions are submitted one-at-a-time with
   confirmation before the next. This measures worst-case (serial) throughput,
   not peak parallel capacity.
4. **Hardhat accounts:** configured with `accounts: { count: 60 }` in
   `hardhat.config.ts` (1 deployer + up to 59 contributors).
5. **Subprocess startup overhead** (`process_elapsed_ms`): `run_client_benchmark.py`
   and `run_throughput_client.py` include tsx/dotnet runtime initialisation time
   in `process_elapsed_ms`. Use `latency_ms` (client-measured) for apples-to-apples
   comparison with the Python harness. `process_elapsed_ms` is a DX cost metric.

---

## Dashboard (`dashboard/`)

A Next.js 14 web application that visualises benchmark results and can trigger live
benchmark runs from the browser.

### Prerequisites

- Node.js 20.x LTS (same as the rest of the TypeScript tooling)
- Benchmark result files in `benchmarks/results/` (schema v2 JSON)

### Install and start (development)

```bash
cd dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The dev server hot-reloads on file changes. For a production build:

```bash
npm run build
npm start
```

### What it does

| Feature             | Details                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Results overview    | Loads all schema v2 `*.json` files from `benchmarks/results/`, groups by `(variant, client, environment, kind)`, and shows only the latest file per group |
| Filter bar          | Filter displayed results by variant, client, or environment; refresh button reloads from disk                                                             |
| Result cards        | Click a card to drill into per-operation gas/fee, latency, and key metric cards                                                                           |
| Comparative charts  | Side-by-side TPS and cost-per-TPS bar charts; gas/fee and latency charts per operation                                                                    |
| Comparison table    | Cross-variant operation table with sortable columns (click a client header to sort by cost/latency)                                                       |
| Run panel (sidebar) | Select variant/client/benchmark type and start a live run; output streams in real time via polling                                                        |
| `/benchmarks` page  | Full comparison table + GasChart + LatencyChart + ThroughputChart in one scrollable view                                                                  |
| `/run` page         | Full-page run form (equivalent to the sidebar panel)                                                                                                      |

### API routes

All API routes require the Node.js runtime (`export const runtime = "nodejs"`).

| Route             | Method | Description                                                                                                                                                    |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/benchmarks` | GET    | Returns all loaded `BenchmarkFile[]` objects from `benchmarks/results/`                                                                                        |
| `/api/run`        | POST   | Spawns `benchmarks/run_tests.py` (or `--throughput`) as a subprocess; accepts `{ variant, client, kind }` body; returns `{ id, status: "running" }` (HTTP 202) |
| `/api/run/[id]`   | GET    | Returns the current status, accumulated stdout/stderr output, and result file path for a run                                                                   |

Run state is held in-process memory — it resets when the Next.js server restarts.

### Run request body

```json
{
  "variant": "V1",
  "client": "python",
  "kind": "lifecycle"
}
```

Valid values:

| Field     | Values                   |
| --------- | ------------------------ |
| `variant` | `V1` `V2` `V3` `V4` `V5` |
| `client`  | `python` `ts` `dotnet`   |
| `kind`    | `lifecycle` `throughput` |

The API maps `variant` to its platform (`evm`/`solana`) and environment
(`sepolia`/`solana-devnet`) automatically, and sets `VARIANT`, `CLIENT`, and
`BENCHMARK_ENV` environment variables for the subprocess.

> **Note:** V2 and V3 benchmarks require contract artifacts to be configured in
> `benchmarks/config.py` before triggering a run from the dashboard.

### Result file discovery

The dashboard reads files relative to the repo root — it resolves
`../benchmarks/results` from the Next.js process working directory
(`dashboard/`). Start the server from the `dashboard/` directory so this path is correct.

Only schema v2 files (`"schema_version": "2"`) are displayed; legacy files are silently skipped.

### Shared chart constants

Chart components share constants from `dashboard/lib/chart-constants.ts`:

- `VARIANT_COLORS` — per-variant hex palette used in all bar charts
- `TOOLTIP_STYLE` — Recharts tooltip style object
- `OPERATION_ORDER` — canonical operation ordering for chart axes
- `comboKey(r)` — builds `"V1 / python"` style series labels
- `deduplicateByKey(items)` — filters duplicate bar series by key

---

## Version Matrix (tested baseline)

| Tool                    | Version         | Scope                                                  |
| ----------------------- | --------------- | ------------------------------------------------------ |
| Node.js                 | 20.x LTS        | All TypeScript tooling                                 |
| TypeScript              | 5.4.x           | EVM + Solana clients                                   |
| Hardhat                 | 2.22.x          | EVM compilation, testing, local node                   |
| @openzeppelin/contracts | 5.1.x           | ERC-20, ERC-4626, ERC-1155 base implementations        |
| Solidity                | 0.8.24          | EVM contract compiler (Cancun EVM target)              |
| Rust                    | stable (1.84+)  | Solana program compilation                             |
| Solana CLI              | 3.0.15 (stable) | Program deployment, account inspection                 |
| Anchor CLI              | 0.32.1          | Build, test, deploy (contracts/solana/)                |
| anchor-lang             | 0.32.1          | Solana program framework                               |
| anchor-spl              | 0.32.1          | SPL Token CPI helpers                                  |
| @coral-xyz/anchor (TS)  | 0.32.1          | TS client Anchor SDK (clients/ts/)                     |
| @solana/spl-token (TS)  | 0.3.11          | SPL token helpers                                      |
| @solana/web3.js         | 1.95.4          | Solana RPC and transaction building                    |
| viem                    | 2.21.x          | EVM client RPC and contract interaction                |
| tsx                     | 4.19.x          | TypeScript ESM execution                               |
| Nethereum.Web3          | 4.25.0          | .NET EVM client                                        |
| dotenv.net              | 3.2.1           | .NET env var loading                                   |
| Solnet.Rpc/Wallet       | 6.1.0           | .NET Solana client                                     |
| .NET SDK                | 8.0             | .NET build toolchain                                   |
| Python                  | 3.12 (native)   | Benchmark harness (benchmarks/)                        |
| web3.py                 | 6.20.3          | Python EVM interaction                                 |
| lru-dict                | 1.3.0           | web3 cache (1.3.0 forced — 1.2.x has no Windows wheel) |
| solana-py               | 0.36.6          | Python Solana RPC client                               |
| solders                 | 0.26.0          | Python Solana types (Rust extension)                   |
| anchorpy                | 0.21.0          | Python Anchor IDL client                               |
| tabulate                | 0.9.0           | Benchmark table formatting                             |
| Next.js                 | 14.2.x          | Dashboard web application                              |
| React                   | 18.x            | Dashboard UI                                           |
| Recharts                | 3.8.x           | Dashboard charts                                       |
