import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { CrowdfundingFactory, MockERC20 } from "../typechain-types";

const SOFT_CAP    = hre.ethers.parseUnits("50000",  6);
const HARD_CAP    = hre.ethers.parseUnits("100000", 6);
const MILESTONES  = [30, 30, 40];
const THIRTY_DAYS = 30 * 86400;

async function deployFactoryFixture() {
  const [deployer, creator, creator2] = await hre.ethers.getSigners();

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory;

  return { factory, usdc, deployer, creator, creator2 };
}

describe("CrowdfundingFactory", () => {
  it("1. createCampaign emits CampaignCreated with correct args", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture);
    const deadline = (await time.latest()) + THIRTY_DAYS;
    const usdcAddr = await usdc.getAddress();

    const tx = await factory
      .connect(creator)
      .createCampaign(usdcAddr, SOFT_CAP, HARD_CAP, deadline, MILESTONES, "Token", "TKN");

    const receipt = await tx.wait();
    const factoryAddr = await factory.getAddress();
    const iface = factory.interface;

    let campaignAddr = "";
    for (const log of receipt!.logs) {
      if (log.address.toLowerCase() === factoryAddr.toLowerCase()) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "CampaignCreated") {
            campaignAddr = parsed.args[0];
          }
        } catch {}
      }
    }

    await expect(tx)
      .to.emit(factory, "CampaignCreated")
      .withArgs(campaignAddr, await creator.getAddress(), usdcAddr);
  });

  it("2. getCampaignsByCreator returns the created campaign", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture);
    const deadline = (await time.latest()) + THIRTY_DAYS;

    await factory
      .connect(creator)
      .createCampaign(await usdc.getAddress(), SOFT_CAP, HARD_CAP, deadline, MILESTONES, "T", "T");

    const creatorCampaigns = await factory.getCampaignsByCreator(await creator.getAddress());
    expect(creatorCampaigns).to.have.length(1);
    expect(creatorCampaigns[0]).to.not.equal(hre.ethers.ZeroAddress);
  });

  it("3. two campaigns get independent receipt token addresses", async () => {
    const { factory, usdc, creator, creator2 } = await loadFixture(deployFactoryFixture);
    const deadline = (await time.latest()) + THIRTY_DAYS;
    const usdcAddr = await usdc.getAddress();

    const tx1 = await factory.connect(creator).createCampaign(
      usdcAddr, SOFT_CAP, HARD_CAP, deadline, MILESTONES, "Token1", "TK1"
    );
    const tx2 = await factory.connect(creator2).createCampaign(
      usdcAddr, SOFT_CAP, HARD_CAP, deadline, MILESTONES, "Token2", "TK2"
    );

    const r1 = await tx1.wait();
    const r2 = await tx2.wait();
    const factoryAddr = await factory.getAddress();
    const iface = factory.interface;

    function extractCampaign(logs: (typeof r1)["logs"] & {}): string {
      for (const log of logs) {
        if (log.address.toLowerCase() === factoryAddr.toLowerCase()) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === "CampaignCreated") return parsed.args[0];
          } catch {}
        }
      }
      throw new Error("CampaignCreated not found");
    }

    const addr1 = extractCampaign(r1!.logs);
    const addr2 = extractCampaign(r2!.logs);

    const c1 = await hre.ethers.getContractAt("CrowdfundingCampaign", addr1);
    const c2 = await hre.ethers.getContractAt("CrowdfundingCampaign", addr2);

    const rt1 = await c1.receiptToken();
    const rt2 = await c2.receiptToken();

    expect(rt1).to.not.equal(rt2);
    expect(rt1).to.not.equal(hre.ethers.ZeroAddress);
    expect(rt2).to.not.equal(hre.ethers.ZeroAddress);
  });
});
