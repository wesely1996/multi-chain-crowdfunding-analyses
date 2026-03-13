import { decodeEventLog } from "viem";
import {
  publicClient,
  walletClient,
  CAMPAIGN_ADDRESS,
  CAMPAIGN_ABI,
} from "./config.js";
import { printResult, printError } from "../shared/output.js";

async function main() {
  // Read campaign deadline and advance time past it (Hardhat localnet only)
  const deadline = (await publicClient.readContract({
    address: CAMPAIGN_ADDRESS,
    abi: CAMPAIGN_ABI,
    functionName: "deadline",
  })) as bigint;

  const block = await publicClient.getBlock();
  if (block.timestamp <= deadline) {
    const secondsToAdvance = Number(deadline - block.timestamp) + 1;
    await publicClient.request({
      method: "evm_increaseTime" as any,
      params: [secondsToAdvance] as any,
    });
    await publicClient.request({
      method: "evm_mine" as any,
      params: [] as any,
    });
  }

  const start = performance.now();

  const hash = await walletClient.writeContract({
    address: CAMPAIGN_ADDRESS,
    abi: CAMPAIGN_ABI,
    functionName: "finalize",
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const elapsed = performance.now() - start;

  // Parse Finalized event
  let successful: boolean | null = null;
  let totalRaised = "";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === CAMPAIGN_ADDRESS.toLowerCase()) {
      try {
        const event = decodeEventLog({
          abi: CAMPAIGN_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "Finalized") {
          const args = event.args as unknown as { successful: boolean; totalRaised: bigint };
          successful = args.successful;
          totalRaised = args.totalRaised.toString();
          break;
        }
      } catch {}
    }
  }

  printResult({
    chain: "evm",
    operation: "finalize",
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    status: receipt.status === "success" ? "success" : "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: { successful, totalRaised },
  });
}

main().catch((err) => printError("finalize", err));
