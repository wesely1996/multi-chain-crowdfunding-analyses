import { parseArgs } from "node:util";
import { decodeEventLog } from "viem";
import {
  publicClient,
  walletClient,
  CAMPAIGN_ADDRESS,
  CAMPAIGN_ABI,
  VARIANT,
} from "./config.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    "tier-id": { type: "string", default: "0" },
  },
  strict: false,
});

async function main() {
  const tierId = BigInt(values["tier-id"]!);
  const start = performance.now();

  let hash: `0x${string}`;
  if (VARIANT === "V3") {
    hash = await walletClient.writeContract({
      address: CAMPAIGN_ADDRESS,
      abi: CAMPAIGN_ABI,
      functionName: "refund",
      args: [tierId],
    });
  } else {
    hash = await walletClient.writeContract({
      address: CAMPAIGN_ADDRESS,
      abi: CAMPAIGN_ABI,
      functionName: "refund",
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const elapsed = performance.now() - start;

  // Parse Refunded event
  let contributor = "";
  let amount = "";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === CAMPAIGN_ADDRESS.toLowerCase()) {
      try {
        const event = decodeEventLog({
          abi: CAMPAIGN_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "Refunded") {
          const args = event.args as { contributor: string; amount: bigint };
          contributor = args.contributor;
          amount = args.amount.toString();
          break;
        }
      } catch {}
    }
  }

  printResult({
    chain: "evm",
    operation: "refund",
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    status: receipt.status === "success" ? "success" : "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: { contributor, amount },
  });
}

main().catch((err) => printError("refund", err));
