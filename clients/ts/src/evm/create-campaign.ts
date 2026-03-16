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
  VARIANT,
} from "./config.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    "soft-cap": { type: "string", default: "100" },
    "hard-cap": { type: "string", default: "500" },
    "deadline-days": { type: "string", default: "30" },
    milestones: { type: "string", default: "30,30,40" },
    "token-name": { type: "string", default: "Campaign Receipt Token" },
    "token-symbol": { type: "string", default: "CRT" },
    "tier-prices": { type: "string", default: "10,10,10" },
    "tier-names": { type: "string", default: "A,B,C" },
    "token-uri": { type: "string", default: "" },
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
  const tierPrices = values["tier-prices"]!.split(",").map((p) => BigInt(Math.round(Number(p) * 10 ** DECIMALS)));
  const tierNames = values["tier-names"]!.split(",");
  const tokenUri = values["token-uri"]!;

  const start = performance.now();

  let hash: `0x${string}`;
  if (VARIANT === "V3") {
    hash = await walletClient.writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "createCampaign",
      args: [PAYMENT_TOKEN_ADDRESS, softCap, hardCap, deadline, milestones, tierPrices, tierNames, tokenUri],
    });
  } else {
    hash = await walletClient.writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "createCampaign",
      args: [PAYMENT_TOKEN_ADDRESS, softCap, hardCap, deadline, milestones, tokenName, tokenSymbol],
    });
  }

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

  // Read receipt/tier token address from the new campaign (variant-dependent)
  let receiptTokenAddress = "";
  if (campaignAddress) {
    const tokenFn = VARIANT === "V3" ? "tierToken" : VARIANT === "V2" ? null : "receiptToken";
    if (tokenFn) {
      receiptTokenAddress = (await publicClient.readContract({
        address: campaignAddress as `0x${string}`,
        abi: CAMPAIGN_ABI,
        functionName: tokenFn,
      })) as string;
    } else {
      receiptTokenAddress = campaignAddress; // V2: campaign IS the vault/receipt token
    }
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
