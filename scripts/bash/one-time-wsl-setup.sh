#!/usr/bin/env bash
# one-time-wsl-setup.sh
# Run once inside WSL 2 to install the full Solana toolchain + Python harness.
# Idempotent: re-running skips steps that are already done.
#
# Tested on Ubuntu 22.04 / WSL 2  (Windows 11, Solana CLI 3.x, Anchor 0.32.1)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── 0. System packages ────────────────────────────────────────────────────────
echo "==> [0] System packages"
sudo apt-get update -q
sudo apt-get install -y \
    build-essential pkg-config libssl-dev curl git \
    python3.12 python3.12-venv python3.12-dev \
    ca-certificates

# ── 1. Rust ───────────────────────────────────────────────────────────────────
echo "==> [1] Rust (stable, 1.84+)"
if ! command -v rustup &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi
source "$HOME/.cargo/env"
rustup update stable

# ── 2. Solana CLI ─────────────────────────────────────────────────────────────
echo "==> [2] Solana CLI (stable via Anza mirror)"
# release.solana.com has intermittent SSL issues in WSL — use Anza mirror instead.
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
export PATH="$SOLANA_BIN:$PATH"

grep -qxF "export PATH=\"$SOLANA_BIN:\$PATH\"" ~/.bashrc \
    || echo "export PATH=\"$SOLANA_BIN:\$PATH\"" >> ~/.bashrc

echo "    Solana CLI: $(solana --version)"

# ── 3. Anchor CLI via AVM ─────────────────────────────────────────────────────
echo "==> [3] Anchor CLI 0.32.1 via AVM"
if ! command -v avm &>/dev/null; then
    cargo install --git https://github.com/coral-xyz/anchor avm --force
fi
avm install 0.32.1
avm use 0.32.1
echo "    Anchor CLI: $(anchor --version)"

# ── 4. Node.js 20 LTS via nvm ─────────────────────────────────────────────────
echo "==> [4] Node.js 20 LTS via nvm"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
nvm alias default 20

# Make node/npm visible to subprocesses (e.g. `anchor test` invokes npm)
NODE_BIN_DIR="$(dirname "$(nvm which 20)")"
grep -qxF "export PATH=\"$NODE_BIN_DIR:\$PATH\"" ~/.bashrc \
    || echo "export PATH=\"$NODE_BIN_DIR:\$PATH\"" >> ~/.bashrc

echo "    Node: $(node --version)  npm: $(npm --version)"

# ── 5. Solana local keypair + localnet config ─────────────────────────────────
echo "==> [5] Solana keypair + localnet config"
if [ ! -f "$HOME/.config/solana/id.json" ]; then
    solana-keygen new --no-bip39-passphrase --silent
fi
solana config set --url localhost
echo "    Keypair: $HOME/.config/solana/id.json"
echo "    $(solana config get)"

# ── 6. Python venv (clients/python/.venv) ─────────────────────────────────────
# The dashboard (dashboard/app/api/run/route.ts) resolves Python at:
#   clients/python/.venv/bin/python
# Install in stages — plain `pip install -r requirements.txt` fails because
# web3 pins lru-dict<1.3.0 but 1.2.x has no prebuilt Linux wheel.
echo "==> [6] Python 3.12 venv + packages (clients/python/.venv)"
VENV_DIR="$REPO_ROOT/clients/python/.venv"

if [ ! -f "$VENV_DIR/bin/python" ]; then
    python3.12 -m venv "$VENV_DIR"
fi

PIP="$VENV_DIR/bin/pip"
"$PIP" install --upgrade pip --quiet

"$PIP" install --no-deps web3==6.20.3
"$PIP" install lru-dict==1.3.0
"$PIP" install \
    solana==0.36.6 \
    solders==0.26.0 \
    anchorpy==0.21.0 \
    tabulate==0.9.0
"$PIP" install \
    "eth-abi>=4.0.0" \
    "eth-account>=0.8.0,<0.13" \
    "eth-typing>=3.0.0,<5" \
    "eth-utils>=2.1.0,<5" \
    "hexbytes>=0.1.0,<0.4.0" \
    "eth-hash[pycryptodome]>=0.5.1" \
    "jsonschema>=4.0.0" \
    "protobuf>=4.21.6" \
    aiohttp requests pyunormalize rlp \
    "websockets>=10.0,<16.0" \
    typing-extensions \
    "toolz>=0.11.2,<0.12.0"

echo "    Python: $("$VENV_DIR/bin/python" --version)"

# ── 7. Solana contract: npm install ───────────────────────────────────────────
echo "==> [7] contracts/solana — npm install"
(cd "$REPO_ROOT/contracts/solana" && npm install --silent)

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  WSL setup complete."
echo "======================================================"
echo ""
echo "  Next steps:"
echo "  1. Reload shell:   source ~/.bashrc"
echo "  2. Build programs: cd contracts/solana && anchor build"
echo "  3. Run tests:      anchor test  (starts/stops validator automatically)"
echo ""
echo "  To run benchmarks manually:"
echo "  • Start validator from WSL home (not /mnt/c/...):   cd ~ && solana-test-validator --reset"
echo "  • Deploy:                                            cd \$REPO && anchor deploy"
echo "  • Run lifecycle:   VARIANT=V4 python benchmarks/run_tests.py --platform solana"
echo "  • Or use the dashboard:  cd dashboard && npm run dev"
echo ""
