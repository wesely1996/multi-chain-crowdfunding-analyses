import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  CrowdfundingCampaign,
  CrowdfundingFactory,
  MockERC20,
} from "../typechain-types";

// ─── shared constants ─────────────────────────────────────────────────────────

export const SOFT_CAP   = hre.ethers.parseUnits("50000",  6); // 50 000 USDC
export const HARD_CAP   = hre.ethers.parseUnits("100000", 6); // 100 000 USDC
export const CONTRIB    = hre.ethers.parseUnits("1000",   6); // 1 000 USDC per contributor
export const MILESTONES: number[] = [30, 30, 40];
export const THIRTY_DAYS = 30 * 86400;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Parse CampaignCreated event from factory logs to extract campaign address. */
export function parseCampaignAddress(logs: any[], factoryAddress: string, iface: any): string {
  for (const log of logs) {
    if (log.address.toLowerCase() === factoryAddress.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated") return parsed.args[0];
      } catch {}
    }
  }
  throw new Error("CampaignCreated event not found");
}

/** Approve paymentToken + call contribute() in one step. */
export async function fundAndApprove(
  usdc: MockERC20,
  campaign: CrowdfundingCampaign,
  signer: Awaited<ReturnType<typeof hre.ethers.getSigner>>,
  amount: bigint
) {
  await usdc.connect(signer).approve(await campaign.getAddress(), amount);
  await campaign.connect(signer).contribute(amount);
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** Deploy MockERC20 + Factory only (used by factory tests). */
export async function deployFactoryFixture() {
  const [deployer, creator, creator2] = await hre.ethers.getSigners();

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory;

  return { factory, usdc, deployer, creator, creator2 };
}

/** Deploy MockERC20 + Factory + create campaign + mint to alice/bob. */
export async function deployFixture() {
  const signers = await hre.ethers.getSigners();
  const [deployer, creator, alice, bob] = signers;

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory;

  const deadline = (await time.latest()) + THIRTY_DAYS;
  const tx = await factory
    .connect(creator)
    .createCampaign(
      await usdc.getAddress(),
      SOFT_CAP,
      HARD_CAP,
      deadline,
      MILESTONES,
      "Campaign Receipt",
      "CRT"
    );
  const receipt = await tx.wait();

  const factoryAddress = await factory.getAddress();
  const campaignAddress = parseCampaignAddress(receipt!.logs, factoryAddress, factory.interface);

  const campaign = (await hre.ethers.getContractAt(
    "CrowdfundingCampaign",
    campaignAddress
  )) as CrowdfundingCampaign;

  const receiptTokenAddress = await campaign.receiptToken();
  const receiptToken = await hre.ethers.getContractAt("CampaignToken", receiptTokenAddress);

  await usdc.mint(await alice.getAddress(), hre.ethers.parseUnits("200000", 6));
  await usdc.mint(await bob.getAddress(),   hre.ethers.parseUnits("200000", 6));

  return { factory, campaign, usdc, receiptToken, deployer, creator, alice, bob, deadline };
}
