import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import fs from "node:fs";
import idlJson from "../../idl/crowdfunding.json" with { type: "json" };

// ── Env validation ──────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(JSON.stringify({ error: `Missing env var: ${name}` }));
    process.exit(1);
  }
  return value;
}

export const SOLANA_RPC_URL = requireEnv("SOLANA_RPC_URL");
export const SOLANA_KEYPAIR_PATH = requireEnv("SOLANA_KEYPAIR_PATH");
export const SOLANA_PROGRAM_ID = requireEnv("SOLANA_PROGRAM_ID");
export const SOLANA_PAYMENT_MINT = requireEnv("SOLANA_PAYMENT_MINT");
export const SOLANA_CAMPAIGN_ADDRESS = process.env["SOLANA_CAMPAIGN_ADDRESS"] ?? "";
export const SOLANA_CAMPAIGN_ID = process.env["SOLANA_CAMPAIGN_ID"] ?? "0";

// ── Connection & wallet ─────────────────────────────────────────────────────

export const connection = new Connection(SOLANA_RPC_URL, "confirmed");

const keypairData = JSON.parse(fs.readFileSync(SOLANA_KEYPAIR_PATH, "utf-8"));
export const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));

export const programId = new PublicKey(SOLANA_PROGRAM_ID);
export const paymentMint = new PublicKey(SOLANA_PAYMENT_MINT);

// ── Anchor program ──────────────────────────────────────────────────────────

const anchorWallet = new anchor.Wallet(wallet);
const provider = new anchor.AnchorProvider(connection, anchorWallet, {
  commitment: "confirmed",
  skipPreflight: true,
});
anchor.setProvider(provider);

export const program = new Program(idlJson as any, provider);

// ── Token decimals ──────────────────────────────────────────────────────────

export const DECIMALS = 6;
