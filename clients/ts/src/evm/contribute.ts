import { parseArgs } from "node:util";
import { decodeEventLog } from "viem";
import {
  publicClient,
  walletClient,
  CAMPAIGN_ADDRESS,
  PAYMENT_TOKEN_ADDRESS,
  CAMPAIGN_ABI,
  ERC20_ABI,
  DECIMALS,
} from "./config.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    amount: { type: "string", default: "10" },
  },
  strict: false,
});

async function main() {
  const amountRaw = BigInt(Math.round(Number(values["amount"]!) * 10 ** DECIMALS));
  const start = performance.now();

  // Step 1: approve
  const approveHash = await walletClient.writeContract({
    address: PAYMENT_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [CAMPAIGN_ADDRESS, amountRaw],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Step 2: contribute
  const contributeHash = await walletClient.writeContract({
    address: CAMPAIGN_ADDRESS,
    abi: CAMPAIGN_ABI,
    functionName: "contribute",
    args: [amountRaw],
  });
  const contributeReceipt = await publicClient.waitForTransactionReceipt({ hash: contributeHash });
  const elapsed = performance.now() - start;

  // Parse Contributed event
  let totalRaised = "";
  for (const log of contributeReceipt.logs) {
    if (log.address.toLowerCase() === CAMPAIGN_ADDRESS.toLowerCase()) {
      try {
        const event = decodeEventLog({
          abi: CAMPAIGN_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "Contributed") {
          const args = event.args as { totalRaised: bigint };
          totalRaised = args.totalRaised.toString();
          break;
        }
      } catch {}
    }
  }

  const gasUsed = Number(approveReceipt.gasUsed) + Number(contributeReceipt.gasUsed);

  printResult({
    chain: "evm",
    operation: "contribute",
    txHash: contributeHash,
    blockNumber: Number(contributeReceipt.blockNumber),
    gasUsed,
    status: contributeReceipt.status === "success" ? "success" : "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      amount: amountRaw.toString(),
      approveTxHash: approveHash,
      contributeTxHash: contributeHash,
      approveGasUsed: Number(approveReceipt.gasUsed),
      contributeGasUsed: Number(contributeReceipt.gasUsed),
      totalRaised,
    },
  });
}

main().catch((err) => printError("contribute", err));
