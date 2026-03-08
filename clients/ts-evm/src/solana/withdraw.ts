import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  connection,
  wallet,
  program,
  paymentMint,
  SOLANA_CAMPAIGN_ADDRESS,
  SOLANA_CAMPAIGN_ID,
} from "./config.js";
import { campaignPda, vaultPda } from "./pda.js";
import { printResult, printError } from "../output.js";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
  },
  strict: false,
});

async function main() {
  let campaignAddr: PublicKey;
  if (values["campaign"]) {
    campaignAddr = new PublicKey(values["campaign"]);
  } else if (SOLANA_CAMPAIGN_ADDRESS) {
    campaignAddr = new PublicKey(SOLANA_CAMPAIGN_ADDRESS);
  } else {
    campaignAddr = campaignPda(wallet.publicKey, new anchor.BN(Number(SOLANA_CAMPAIGN_ID)));
  }

  const vault = vaultPda(campaignAddr);
  const creatorPaymentAta = getAssociatedTokenAddressSync(paymentMint, wallet.publicKey);

  // Read milestone index before withdraw
  const before = await (program.account as any).campaign.fetch(campaignAddr);
  const milestoneIndex = before.currentMilestone;

  const start = performance.now();

  // creator must be explicitly passed despite `relations` annotation (Anchor 0.32 bug)
  const sig = await program.methods
    .withdrawMilestone()
    .accounts({
      creator: wallet.publicKey,
      campaign: campaignAddr,
      vault,
      creatorPaymentAta,
      paymentMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .signers([wallet])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  const elapsed = performance.now() - start;

  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  // Read updated state to get withdrawn amount
  const after = await (program.account as any).campaign.fetch(campaignAddr);
  const amount = after.totalWithdrawn.sub(before.totalWithdrawn);

  printResult({
    chain: "solana",
    operation: "withdraw",
    txHash: sig,
    blockNumber: tx?.slot ?? null,
    gasUsed: tx?.meta?.fee ?? null,
    status: tx?.meta?.err ? "reverted" : "success",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      milestoneIndex,
      amount: amount.toString(),
      campaignAddress: campaignAddr.toBase58(),
    },
  });
}

main().catch((err) => printError("withdraw", err));
