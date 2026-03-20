import { config as _dotenvConfig } from "dotenv";
_dotenvConfig({ path: "../../.env" });
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

import factoryAbi from "../../abi/CrowdfundingFactory.json" with { type: "json" };
import campaignAbi from "../../abi/CrowdfundingCampaign.json" with { type: "json" };
import v2FactoryAbi from "../../abi/CrowdfundingFactory4626.json" with { type: "json" };
import v2CampaignAbi from "../../abi/CrowdfundingCampaign4626.json" with { type: "json" };
import v3FactoryAbi from "../../abi/CrowdfundingFactory1155.json" with { type: "json" };
import v3CampaignAbi from "../../abi/CrowdfundingCampaign1155.json" with { type: "json" };
import erc20Abi from "../../abi/MockERC20.json" with { type: "json" };

import { requireEnv, DECIMALS } from "../shared/env.js";

// ── Env validation ──────────────────────────────────────────────────────────

export const RPC_URL = requireEnv("RPC_URL");
export const PRIVATE_KEY = requireEnv("PRIVATE_KEY") as `0x${string}`;
export const PAYMENT_TOKEN_ADDRESS = requireEnv("PAYMENT_TOKEN_ADDRESS") as Address;
export const VARIANT = process.env["VARIANT"] ?? "V1";
export const FACTORY_ADDRESS = requireEnv(`FACTORY_ADDRESS_${VARIANT}`) as Address;
export const CAMPAIGN_ADDRESS = requireEnv(`CAMPAIGN_ADDRESS_${VARIANT}`) as Address;

export { DECIMALS };

// ── Chain config ────────────────────────────────────────────────────────────

const chain: Chain = {
  ...hardhat,
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
};

// ── Clients ─────────────────────────────────────────────────────────────────

export const account = privateKeyToAccount(PRIVATE_KEY);

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

// ── Variant-aware ABI selection ──────────────────────────────────────────────

const FACTORY_ABI_MAP: Record<string, unknown[]> = {
  V1: factoryAbi as unknown[],
  V2: v2FactoryAbi as unknown[],
  V3: v3FactoryAbi as unknown[],
};

const CAMPAIGN_ABI_MAP: Record<string, unknown[]> = {
  V1: campaignAbi as unknown[],
  V2: v2CampaignAbi as unknown[],
  V3: v3CampaignAbi as unknown[],
};

export const FACTORY_ABI = FACTORY_ABI_MAP[VARIANT] ?? factoryAbi;
export const CAMPAIGN_ABI = CAMPAIGN_ABI_MAP[VARIANT] ?? campaignAbi;
export const ERC20_ABI = erc20Abi;
