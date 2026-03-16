import { parseArgs } from "node:util";
import BN from "bn.js";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  connection,
  wallet,
  program,
  paymentMint,
  DECIMALS,
  tokenProgram,
} from "./config.js";
import { campaignPda, vaultPda, receiptMintPda } from "./pda.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    "soft-cap": { type: "string", default: "100" },
    "hard-cap": { type: "string", default: "500" },
    "deadline-seconds": { type: "string", default: "1800" },
    milestones: { type: "string", default: "30,30,40" },
    "campaign-id": { type: "string" },
  },
  strict: false,
});

async function main() {
  const softCap = new BN(Math.round(Number(values["soft-cap"]!) * 10 ** DECIMALS));
  const hardCap = new BN(Math.round(Number(values["hard-cap"]!) * 10 ** DECIMALS));
  const deadlineSeconds = Number(values["deadline-seconds"]!);
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const milestones = Buffer.from(values["milestones"]!.split(",").map(Number));
  const campaignId = new BN(values["campaign-id"] ?? (Date.now() & 0xffffffff));

  const campaign = campaignPda(wallet.publicKey, campaignId);
  const vault = vaultPda(campaign);
  const receiptMint = receiptMintPda(campaign);

  const start = performance.now();

  const sig = await program.methods
    .initializeCampaign(campaignId, softCap, hardCap, deadline, milestones)
    .accounts({
      creator: wallet.publicKey,
      paymentMint,
      vault,
      receiptMint,
      tokenProgram,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  const elapsed = performance.now() - start;

  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  printResult({
    chain: "solana",
    operation: "create-campaign",
    txHash: sig,
    blockNumber: tx?.slot ?? null,
    gasUsed: tx?.meta?.fee ?? null,
    status: tx?.meta?.err ? "reverted" : "success",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      campaignAddress: campaign.toBase58(),
      vaultAddress: vault.toBase58(),
      receiptMintAddress: receiptMint.toBase58(),
      campaignId: campaignId.toString(),
      softCap: softCap.toString(),
      hardCap: hardCap.toString(),
      deadline: deadline.toString(),
      milestones: Array.from(milestones),
    },
  });
}

main().catch((err) => printError("create-campaign", err, "solana"));
