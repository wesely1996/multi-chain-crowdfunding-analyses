#!/usr/bin/env bash
# Deploy crowdfunding program to localnet.
# Must be run from contracts/solana/ inside WSL or a native Linux/macOS shell.
set -euo pipefail

CLUSTER="${ANCHOR_CLUSTER:-localnet}"
echo "Building program..."
anchor build

echo "Syncing program ID..."
PROGRAM_ID=$(solana-keygen pubkey target/deploy/crowdfunding-keypair.json)
echo "Program ID: $PROGRAM_ID"

# Patch declare_id! in source and Anchor.toml
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/crowdfunding/src/lib.rs
sed -i "s/crowdfunding = \"[^\"]*\"/crowdfunding = \"$PROGRAM_ID\"/" Anchor.toml

echo "Rebuilding with correct program ID..."
anchor build

echo "Deploying to $CLUSTER..."
anchor deploy --provider.cluster "$CLUSTER"

echo "Done. Program ID: $PROGRAM_ID"
