# one-time-windows-setup.ps1
# Run once in PowerShell to install the full EVM toolchain on Windows.
# Solana benchmarks require WSL — see scripts/bash/one-time-wsl-setup.sh.
#
# Tested on Windows 11, Node 20 LTS, Python 3.12, .NET SDK 8.0
#
# Usage:
#   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser   # once, if scripts are blocked
#   .\scripts\powershell\one-time-windows-setup.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REPO_ROOT = (Resolve-Path "$PSScriptRoot\..\..")

# ── helpers ───────────────────────────────────────────────────────────────────

function Step([string]$label) {
    Write-Host ""
    Write-Host "==> $label" -ForegroundColor Cyan
}

function Ok([string]$msg) {
    Write-Host "    $msg" -ForegroundColor Green
}

function Warn([string]$msg) {
    Write-Host "    [warn] $msg" -ForegroundColor Yellow
}

function Die([string]$msg) {
    Write-Host ""
    Write-Host "  ERROR: $msg" -ForegroundColor Red
    exit 1
}

function CommandExists([string]$cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function WingetInstall([string]$id, [string]$friendlyName) {
    if (-not (CommandExists "winget")) {
        Die "winget not found. Install the App Installer from the Microsoft Store and retry."
    }
    Write-Host "    Installing $friendlyName via winget…"
    winget install --id $id --silent --accept-package-agreements --accept-source-agreements
    # Refresh PATH so the newly installed binary is visible in this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

# ── 0. Execution policy guard ─────────────────────────────────────────────────
Step "[0] Execution policy"
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq "Restricted") {
    Write-Host "    Setting ExecutionPolicy to RemoteSigned for current user…"
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
}
Ok "ExecutionPolicy: $(Get-ExecutionPolicy -Scope CurrentUser)"

# ── 1. Node.js 20 LTS ─────────────────────────────────────────────────────────
Step "[1] Node.js 20 LTS"
$nodeOk = $false
if (CommandExists "node") {
    $nodeVer = (node --version) -replace "v", ""
    if ([version]$nodeVer -ge [version]"20.0.0") {
        Ok "node $(node --version) already installed"
        $nodeOk = $true
    }
}
if (-not $nodeOk) {
    WingetInstall "OpenJS.NodeJS.LTS" "Node.js LTS"
    if (-not (CommandExists "node")) {
        Warn "node not on PATH yet — open a new PowerShell window and rerun if subsequent steps fail."
    } else {
        Ok "node $(node --version)"
    }
}

# ── 2. Python 3.12 ────────────────────────────────────────────────────────────
Step "[2] Python 3.12"
# Use the py launcher to check for 3.12 specifically
$pyOk = $false
if (CommandExists "py") {
    $pyVer = py -3.12 --version 2>&1
    if ($pyVer -match "Python 3\.12") {
        Ok "$pyVer already installed"
        $pyOk = $true
    }
}
if (-not $pyOk) {
    WingetInstall "Python.Python.3.12" "Python 3.12"
    # Refresh to pick up py launcher
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (CommandExists "py") {
        Ok "$(py -3.12 --version)"
    } else {
        Warn "py launcher not on PATH — you may need to reopen PowerShell after the install."
    }
}

# ── 3. .NET SDK 8.0 ───────────────────────────────────────────────────────────
Step "[3] .NET SDK 8.0"
$dotnetOk = $false
if (CommandExists "dotnet") {
    $sdks = dotnet --list-sdks 2>&1
    if ($sdks -match "^8\.") {
        Ok ".NET SDK 8.x already installed"
        $dotnetOk = $true
    }
}
if (-not $dotnetOk) {
    WingetInstall "Microsoft.DotNet.SDK.8" ".NET SDK 8.0"
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (CommandExists "dotnet") { Ok "dotnet $(dotnet --version)" }
}

# ── 4. npm install — contracts/evm ────────────────────────────────────────────
Step "[4] npm install — contracts/evm"
Push-Location "$REPO_ROOT\contracts\evm"
npm install --silent
Ok "contracts/evm done"
Pop-Location

# ── 5. npm install — clients/ts ───────────────────────────────────────────────
Step "[5] npm install — clients/ts"
Push-Location "$REPO_ROOT\clients\ts"
npm install --silent
Ok "clients/ts done"
Pop-Location

# ── 6. npm install — dashboard ────────────────────────────────────────────────
Step "[6] npm install — dashboard"
Push-Location "$REPO_ROOT\dashboard"
npm install --silent
Ok "dashboard done"
Pop-Location

# ── 7. Python venv (clients/python/.venv) ────────────────────────────────────
# The dashboard (dashboard/app/api/run/route.ts) looks for Python at:
#   clients/python/.venv/Scripts/python.exe   (Windows)
# Install in stages — plain `pip install -r requirements.txt` fails because
# web3 pins lru-dict<1.3.0 but 1.2.x has no prebuilt Windows wheel.
Step "[7] Python venv + packages (clients\python\.venv)"
$VENV = "$REPO_ROOT\clients\python\.venv"
$PIP  = "$VENV\Scripts\pip.exe"
$PY   = "$VENV\Scripts\python.exe"

if (-not (Test-Path "$VENV\Scripts\python.exe")) {
    Write-Host "    Creating venv at clients\python\.venv …"
    py -3.12 -m venv $VENV
}

& $PIP install --upgrade pip --quiet

Write-Host "    Stage 1: web3 (no-deps to bypass lru-dict pin)…"
& $PIP install --no-deps web3==6.20.3

Write-Host "    Stage 2: lru-dict 1.3.0 (Windows wheel)…"
& $PIP install lru-dict==1.3.0

Write-Host "    Stage 3: Solana stack…"
& $PIP install solana==0.36.6 solders==0.26.0 anchorpy==0.21.0 tabulate==0.9.0

Write-Host "    Stage 4: web3 transitive deps…"
& $PIP install `
    "eth-abi>=4.0.0" `
    "eth-account>=0.8.0,<0.13" `
    "eth-typing>=3.0.0,<5" `
    "eth-utils>=2.1.0,<5" `
    "hexbytes>=0.1.0,<0.4.0" `
    "eth-hash[pycryptodome]>=0.5.1" `
    "jsonschema>=4.0.0" `
    "protobuf>=4.21.6" `
    aiohttp requests pyunormalize rlp `
    "websockets>=10.0,<16.0" `
    typing-extensions `
    "toolz>=0.11.2,<0.12.0"

Ok "Python: $(& $PY --version)"

# ── 8. dotnet restore — clients/dotnet ───────────────────────────────────────
Step "[8] dotnet restore — clients/dotnet"
if (CommandExists "dotnet") {
    Push-Location "$REPO_ROOT\clients\dotnet"
    dotnet restore --verbosity quiet
    Ok "clients/dotnet restored"
    Pop-Location
} else {
    Warn ".NET SDK not found on PATH — skipping dotnet restore. Reopen PowerShell and run:"
    Warn "  cd clients\dotnet && dotnet restore"
}

# ── 9. Compile EVM contracts ──────────────────────────────────────────────────
Step "[9] Compile EVM contracts (npx hardhat compile)"
Push-Location "$REPO_ROOT\contracts\evm"
npx hardhat compile
Ok "Artifacts written to contracts/evm/artifacts/"
Pop-Location

# ── 10. .env file ─────────────────────────────────────────────────────────────
Step "[10] Root .env"
$envFile     = "$REPO_ROOT\.env"
$envExample  = "$REPO_ROOT\.env.example"
if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Ok ".env created from .env.example — fill in PRIVATE_KEY and contract addresses before running benchmarks"
} else {
    Ok ".env already exists"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Windows setup complete." -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next steps:"
Write-Host ""
Write-Host "  1. Start Hardhat node (separate terminal):"
Write-Host "       cd contracts\evm && npx hardhat node"
Write-Host ""
Write-Host "  2. Deploy all three EVM variants (V1/V2/V3):"
Write-Host "       cd contracts\evm && npx hardhat run scripts\deploy.ts --network localhost"
Write-Host "       # Copy the printed addresses into .env"
Write-Host ""
Write-Host "  3. Run EVM tests:"
Write-Host "       cd contracts\evm && npx hardhat test"
Write-Host ""
Write-Host "  4. Start the dashboard:"
Write-Host "       cd dashboard && npm run dev"
Write-Host ""
Write-Host "  5. Run a batch benchmark (dashboard must be running):"
Write-Host "       python scripts\batch_run.py"
Write-Host ""
Write-Host "  Solana benchmarks (V4/V5) must run from WSL:"
Write-Host "       wsl -- bash scripts/bash/one-time-wsl-setup.sh"
Write-Host ""
