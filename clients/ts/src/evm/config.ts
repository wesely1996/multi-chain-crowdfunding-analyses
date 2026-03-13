import "dotenv/config";
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
import erc20Abi from "../../abi/MockERC20.json" with { type: "json" };

import { requireEnv, DECIMALS } from "../shared/env.js";

// ── Env validation ──────────────────────────────────────────────────────────

export const RPC_URL = requireEnv("RPC_URL");
export const PRIVATE_KEY = requireEnv("PRIVATE_KEY") as `0x${string}`;
export const FACTORY_ADDRESS = requireEnv("FACTORY_ADDRESS") as Address;
export const CAMPAIGN_ADDRESS = requireEnv("CAMPAIGN_ADDRESS") as Address;
export const PAYMENT_TOKEN_ADDRESS = requireEnv("PAYMENT_TOKEN_ADDRESS") as Address;

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

// ── ABIs ────────────────────────────────────────────────────────────────────

export const FACTORY_ABI = factoryAbi;
export const CAMPAIGN_ABI = campaignAbi;
export const ERC20_ABI = erc20Abi;
