import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { CrowdfundingFactory, MockERC20 } from "../typechain-types";
import {
  SOFT_CAP,
  HARD_CAP,
  MILESTONES,
  THIRTY_DAYS,
  deployFactoryFixture,
  parseCampaignAddress,
} from "./fixtures";

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
    const campaignAddr = parseCampaignAddress(receipt!.logs, factoryAddr, factory.interface);

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

    const addr1 = parseCampaignAddress(r1!.logs, factoryAddr, iface);
    const addr2 = parseCampaignAddress(r2!.logs, factoryAddr, iface);

    const c1 = await hre.ethers.getContractAt("CrowdfundingCampaign", addr1);
    const c2 = await hre.ethers.getContractAt("CrowdfundingCampaign", addr2);

    const rt1 = await c1.receiptToken();
    const rt2 = await c2.receiptToken();

    expect(rt1).to.not.equal(rt2);
    expect(rt1).to.not.equal(hre.ethers.ZeroAddress);
    expect(rt2).to.not.equal(hre.ethers.ZeroAddress);
  });
});
