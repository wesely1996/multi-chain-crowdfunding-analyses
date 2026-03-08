import { parseArgs } from "node:util";
import {
  publicClient,
  account,
  CAMPAIGN_ADDRESS,
  CAMPAIGN_ABI,
} from "./config.js";
import { printResult, printError } from "./output.js";

const { values } = parseArgs({
  options: {
    contributor: { type: "string" },
  },
  strict: false,
});

async function main() {
  const start = performance.now();

  const [
    creator,
    softCap,
    hardCap,
    deadline,
    totalRaised,
    totalWithdrawn,
    finalized,
    successful,
    currentMilestone,
    milestoneCount,
    milestonePercentages,
    paymentToken,
    receiptToken,
  ] = await Promise.all([
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "creator" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "softCap" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "hardCap" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "deadline" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "totalRaised" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "totalWithdrawn" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "finalized" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "successful" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "currentMilestone" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "getMilestoneCount" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "getMilestonePercentages" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "paymentToken" }),
    publicClient.readContract({ address: CAMPAIGN_ADDRESS, abi: CAMPAIGN_ABI, functionName: "receiptToken" }),
  ]);

  const data: Record<string, unknown> = {
    creator,
    softCap: (softCap as bigint).toString(),
    hardCap: (hardCap as bigint).toString(),
    deadline: (deadline as bigint).toString(),
    totalRaised: (totalRaised as bigint).toString(),
    totalWithdrawn: (totalWithdrawn as bigint).toString(),
    finalized,
    successful,
    currentMilestone,
    milestoneCount: (milestoneCount as bigint).toString(),
    milestonePercentages: (milestonePercentages as number[]).map(Number),
    paymentToken,
    receiptToken,
  };

  // Optional: read contributor's contribution
  const contributorAddr = values["contributor"] || account.address;
  if (contributorAddr) {
    const contribution = await publicClient.readContract({
      address: CAMPAIGN_ADDRESS,
      abi: CAMPAIGN_ABI,
      functionName: "contributions",
      args: [contributorAddr as `0x${string}`],
    });
    data.contribution = (contribution as bigint).toString();
    data.contributorAddress = contributorAddr;
  }

  const elapsed = performance.now() - start;

  printResult({
    chain: "evm",
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

main().catch((err) => printError("status", err));
