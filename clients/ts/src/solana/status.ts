import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import {
  connection,
  wallet,
  program,
} from "./config.js";
import { contributorRecordPda, resolveCampaign } from "./pda.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
    contributor: { type: "string" },
  },
  strict: false,
});

async function main() {
  const start = performance.now();

  const campaignAddr = resolveCampaign(values["campaign"], wallet.publicKey);

  const campaignAccount = await (program.account as any).campaign.fetch(campaignAddr);

  const data: Record<string, unknown> = {
    campaignAddress: campaignAddr.toBase58(),
    creator: campaignAccount.creator.toBase58(),
    paymentMint: campaignAccount.paymentMint.toBase58(),
    receiptMint: campaignAccount.receiptMint.toBase58(),
    softCap: campaignAccount.softCap.toString(),
    hardCap: campaignAccount.hardCap.toString(),
    deadline: campaignAccount.deadline.toString(),
    totalRaised: campaignAccount.totalRaised.toString(),
    totalWithdrawn: campaignAccount.totalWithdrawn.toString(),
    finalized: campaignAccount.finalized,
    successful: campaignAccount.successful,
    currentMilestone: campaignAccount.currentMilestone,
    milestoneCount: campaignAccount.milestoneCount,
    milestones: Array.from(campaignAccount.milestones).slice(0, campaignAccount.milestoneCount),
    campaignId: campaignAccount.campaignId.toString(),
  };

  // Optional: read contributor record
  const contributorAddr = values["contributor"] ?? wallet.publicKey.toBase58();
  try {
    const recordPda = contributorRecordPda(campaignAddr, new PublicKey(contributorAddr));
    const record = await (program.account as any).contributorRecord.fetch(recordPda);
    data.contribution = record.amount.toString();
    data.contributorAddress = contributorAddr;
  } catch {
    data.contribution = "0";
    data.contributorAddress = contributorAddr;
  }

  const elapsed = performance.now() - start;

  printResult({
    chain: "solana",
    operation: "status",
    txHash: null,
    blockNumber: null,
    gasUsed: null,
    status: "success",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data,
  });
}

main().catch((err) => printError("status", err, "solana"));
