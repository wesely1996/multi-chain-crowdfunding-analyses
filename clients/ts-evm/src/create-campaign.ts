import { parseArgs } from "node:util";
import { decodeEventLog } from "viem";
import {
  publicClient,
  walletClient,
  account,
  FACTORY_ADDRESS,
  PAYMENT_TOKEN_ADDRESS,
  FACTORY_ABI,
  CAMPAIGN_ABI,
  DECIMALS,
} from "./config.js";
import { printResult, printError } from "./output.js";

const { values } = parseArgs({
  options: {
    "soft-cap": { type: "string", default: "100" },
    "hard-cap": { type: "string", default: "500" },
    "deadline-days": { type: "string", default: "30" },
    milestones: { type: "string", default: "30,30,40" },
    "token-name": { type: "string", default: "Campaign Receipt Token" },
    "token-symbol": { type: "string", default: "CRT" },
  },
  strict: false,
});

async function main() {
  const softCap = BigInt(Math.round(Number(values["soft-cap"]!) * 10 ** DECIMALS));
  const hardCap = BigInt(Math.round(Number(values["hard-cap"]!) * 10 ** DECIMALS));
  const deadlineDays = Number(values["deadline-days"]!);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineDays * 86400);
  const milestones = values["milestones"]!.split(",").map(Number);
  const tokenName = values["token-name"]!;
  const tokenSymbol = values["token-symbol"]!;

  const start = performance.now();

  const hash = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "createCampaign",
    args: [PAYMENT_TOKEN_ADDRESS, softCap, hardCap, deadline, milestones, tokenName, tokenSymbol],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const elapsed = performance.now() - start;

  // Parse CampaignCreated event from factory logs
  let campaignAddress = "";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()) {
      try {
        const event = decodeEventLog({
          abi: FACTORY_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "CampaignCreated") {
          campaignAddress = (event.args as { campaign: string }).campaign;
          break;
        }
      } catch {}
    }
  }

  // Read receiptToken address from the new campaign
  let receiptTokenAddress = "";
  if (campaignAddress) {
    receiptTokenAddress = (await publicClient.readContract({
      address: campaignAddress as `0x${string}`,
      abi: CAMPAIGN_ABI,
      functionName: "receiptToken",
    })) as string;
  }

  printResult({
    chain: "evm",
    operation: "create-campaign",
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    status: receipt.status === "success" ? "success" : "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      campaignAddress,
      receiptTokenAddress,
      softCap: softCap.toString(),
      hardCap: hardCap.toString(),
      deadline: deadline.toString(),
      milestones,
      tokenName,
      tokenSymbol,
    },
  });
}

main().catch((err) => printError("create-campaign", err));
