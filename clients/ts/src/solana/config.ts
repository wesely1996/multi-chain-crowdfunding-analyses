import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import fs from "node:fs";
import os from "node:os";
import idlJson from "../../idl/crowdfunding.json" with { type: "json" };

import { requireEnv, DECIMALS } from "../shared/env.js";

// ── Env validation ──────────────────────────────────────────────────────────

export const SOLANA_RPC_URL = requireEnv("SOLANA_RPC_URL");
export const SOLANA_KEYPAIR_PATH = requireEnv("SOLANA_KEYPAIR_PATH");
export const SOLANA_PROGRAM_ID = requireEnv("SOLANA_PROGRAM_ID");
export const SOLANA_PAYMENT_MINT = requireEnv("SOLANA_PAYMENT_MINT");
export const SOLANA_CAMPAIGN_ADDRESS = process.env["SOLANA_CAMPAIGN_ADDRESS"] ?? "";
export const SOLANA_CAMPAIGN_ID = process.env["SOLANA_CAMPAIGN_ID"] ?? "0";

export { DECIMALS };

// ── Connection & wallet ─────────────────────────────────────────────────────

export const connection = new Connection(SOLANA_RPC_URL, "confirmed");

const resolvedKeypairPath = SOLANA_KEYPAIR_PATH.startsWith("~")
  ? SOLANA_KEYPAIR_PATH.replace("~", os.homedir())
  : SOLANA_KEYPAIR_PATH;
const keypairData = JSON.parse(fs.readFileSync(resolvedKeypairPath, "utf-8"));
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

// ── RPC helper (works around SendTransactionError constructor mismatch) ─────

export async function sendAndConfirmTx(
  builder: { transaction(): Promise<import("@solana/web3.js").Transaction> },
): Promise<string> {
  const tx = await builder.transaction();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);

  const simResult = await connection.simulateTransaction(tx);
  if (simResult.value.err) {
    const logs = simResult.value.logs?.join("\n") ?? "";
    const anchorMsg = logs.match(/Error Message: (.+)/)?.[1] ?? JSON.stringify(simResult.value.err);
    throw new Error(anchorMsg);
  }

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
