import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  connection,
  wallet,
  program,
  sendAndConfirmTx,
  paymentMint,
  tokenProgram,
} from "./config.js";
import { vaultPda, resolveCampaign } from "./pda.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
  },
  strict: false,
});

async function main() {
  const campaignAddr = resolveCampaign(values["campaign"], wallet.publicKey);
  const vault = vaultPda(campaignAddr);
  const creatorPaymentAta = getAssociatedTokenAddressSync(paymentMint, wallet.publicKey);

  const start = performance.now();

  // creator must be explicitly passed despite `relations` annotation (Anchor 0.32 bug)
  const sig = await sendAndConfirmTx(
    program.methods
      .withdrawMilestone()
      .accounts({
        creator: wallet.publicKey,
        campaign: campaignAddr,
        vault,
        creatorPaymentAta,
        paymentMint,
        tokenProgram,
      } as any)
      .signers([wallet]),
  );

  const elapsed = performance.now() - start;

  // getTransaction and account fetch are independent — run them in parallel
  const [tx, after] = await Promise.all([
    connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
    (program.account as any).campaign.fetch(campaignAddr),
  ]);

  // Program increments currentMilestone during withdraw_milestone, so subtract 1
  const milestoneIndex = Number(after.currentMilestone) - 1;

  // Derive amount from vault token balance delta embedded in the transaction metadata
  const vaultIndex = tx?.transaction.message.accountKeys.findIndex(
    (k: PublicKey) => k.equals(vault),
  ) ?? -1;
  const preBal  = tx?.meta?.preTokenBalances?.find( (b: any) => b.accountIndex === vaultIndex)?.uiTokenAmount.amount ?? "0";
  const postBal = tx?.meta?.postTokenBalances?.find((b: any) => b.accountIndex === vaultIndex)?.uiTokenAmount.amount ?? "0";
  const amount  = BigInt(preBal) - BigInt(postBal);

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

main().catch((err) => printError("withdraw", err, "solana"));
