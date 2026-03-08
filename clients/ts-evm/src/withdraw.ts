import { decodeEventLog } from "viem";
import {
  publicClient,
  walletClient,
  CAMPAIGN_ADDRESS,
  CAMPAIGN_ABI,
} from "./config.js";
import { printResult, printError } from "./output.js";

async function main() {
  const start = performance.now();

  const hash = await walletClient.writeContract({
    address: CAMPAIGN_ADDRESS,
    abi: CAMPAIGN_ABI,
    functionName: "withdrawMilestone",
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const elapsed = performance.now() - start;

  // Parse MilestoneWithdrawn event
  let milestoneIndex: number | null = null;
  let amount = "";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === CAMPAIGN_ADDRESS.toLowerCase()) {
      try {
        const event = decodeEventLog({
          abi: CAMPAIGN_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "MilestoneWithdrawn") {
          const args = event.args as { milestoneIndex: bigint; amount: bigint };
          milestoneIndex = Number(args.milestoneIndex);
          amount = args.amount.toString();
          break;
        }
      } catch {}
    }
  }

  printResult({
    chain: "evm",
    operation: "withdraw",
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    status: receipt.status === "success" ? "success" : "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: { milestoneIndex, amount },
  });
}

main().catch((err) => printError("withdraw", err));
