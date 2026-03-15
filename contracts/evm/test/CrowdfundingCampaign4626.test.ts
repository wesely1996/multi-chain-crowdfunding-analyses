import { expect } from "chai";
import hre from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  CrowdfundingCampaign4626,
  CrowdfundingFactory4626,
  MockERC20,
} from "../typechain-types";
import { SOFT_CAP, HARD_CAP, CONTRIB, MILESTONES, THIRTY_DAYS } from "./fixtures";

// ─── helpers ────────────────────────────────────────────────────────────────

function parseCampaignAddress4626(logs: any[], factoryAddress: string, iface: any): string {
  for (const log of logs) {
    if (log.address.toLowerCase() === factoryAddress.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated4626") return parsed.args[0];
      } catch {}
    }
  }
  throw new Error("CampaignCreated4626 event not found");
}

// ─── fixtures ───────────────────────────────────────────────────────────────

async function deployFactoryFixture4626() {
  const [deployer, creator, creator2] = await hre.ethers.getSigners();

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory4626");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory4626;

  return { factory, usdc, deployer, creator, creator2 };
}

async function deployFixture4626() {
  const signers = await hre.ethers.getSigners();
  const [deployer, creator, alice, bob] = signers;

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory4626");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory4626;

  const deadline = (await time.latest()) + THIRTY_DAYS;
  const tx = await factory
    .connect(creator)
    .createCampaign(
      await usdc.getAddress(),
      SOFT_CAP,
      HARD_CAP,
      deadline,
      MILESTONES,
      "Campaign Vault Share",
      "CVS"
    );
  const receipt = await tx.wait();

  const factoryAddress = await factory.getAddress();
  const campaignAddress = parseCampaignAddress4626(receipt!.logs, factoryAddress, factory.interface);

  const campaign = (await hre.ethers.getContractAt(
    "CrowdfundingCampaign4626",
    campaignAddress
  )) as CrowdfundingCampaign4626;

  await usdc.mint(await alice.getAddress(), hre.ethers.parseUnits("200000", 6));
  await usdc.mint(await bob.getAddress(),   hre.ethers.parseUnits("200000", 6));

  return { factory, campaign, usdc, deployer, creator, alice, bob, deadline };
}

// ─── test suites ──────────────────────────────────────────────────────────────

describe("CrowdfundingCampaign4626", () => {

  // ── [Init] ──────────────────────────────────────────────────────────────────

  describe("[Init] Constructor", () => {
    it("1. sets all constructor parameters correctly", async () => {
      const { campaign, usdc, creator, deadline } = await loadFixture(deployFixture4626);

      expect(await campaign.creator()).to.equal(await creator.getAddress());
      expect(await campaign.asset()).to.equal(await usdc.getAddress());
      expect(await campaign.softCap()).to.equal(SOFT_CAP);
      expect(await campaign.hardCap()).to.equal(HARD_CAP);
      expect(await campaign.deadline()).to.equal(deadline);
      expect(await campaign.getMilestoneCount()).to.equal(3n);
    });

    it("2. is itself the ERC-4626 vault token — asset() equals payment token", async () => {
      const { campaign, usdc } = await loadFixture(deployFixture4626);
      expect(await campaign.asset()).to.equal(await usdc.getAddress());
      // Campaign contract IS the share token — verify it implements ERC-20
      expect(await campaign.decimals()).to.equal(6n);
    });

    it("3. reverts if softCap > hardCap — InvalidCapRange", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture4626);
      const deadline = (await time.latest()) + THIRTY_DAYS;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          HARD_CAP,   // softCap > hardCap
          SOFT_CAP,
          deadline,
          MILESTONES,
          "T", "T"
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign4626")).interface }, "InvalidCapRange");
    });

    it("4. reverts if deadline is in the past — InvalidDeadline", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture4626);
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          SOFT_CAP,
          HARD_CAP,
          pastDeadline,
          MILESTONES,
          "T", "T"
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign4626")).interface }, "InvalidDeadline");
    });

    it("5. reverts if milestones don't sum to 100 — InvalidMilestonePercentages", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture4626);
      const deadline = (await time.latest()) + THIRTY_DAYS;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          SOFT_CAP,
          HARD_CAP,
          deadline,
          [40, 40, 40], // sums to 120
          "T", "T"
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign4626")).interface }, "InvalidMilestonePercentages");
    });
  });

  // ── [Funding] ────────────────────────────────────────────────────────────────

  describe("[Funding] contribute()", () => {
    it("6. accepts valid contribution, mints vault shares 1:1, emits Contributed", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture4626);
      const aliceAddr = await alice.getAddress();
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);

      await expect(campaign.connect(alice).contribute(CONTRIB))
        .to.emit(campaign, "Contributed")
        .withArgs(aliceAddr, CONTRIB, CONTRIB);

      // Campaign IS the share token — balanceOf replaces receiptToken.balanceOf
      expect(await campaign.balanceOf(aliceAddr)).to.equal(CONTRIB);
      expect(await campaign.totalRaised()).to.equal(CONTRIB);
    });

    it("7. reverts on zero amount — ZeroAmount", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture4626);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await expect(campaign.connect(alice).contribute(0n))
        .to.be.revertedWithCustomError(campaign, "ZeroAmount");
    });

    it("8. reverts when contribution exceeds hardCap — ContributionExceedsHardCap", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture4626);
      const over = HARD_CAP + 1n;
      await usdc.connect(alice).approve(await campaign.getAddress(), over);
      await expect(campaign.connect(alice).contribute(over))
        .to.be.revertedWithCustomError(campaign, "ContributionExceedsHardCap");
    });

    it("9. reverts after deadline — CampaignNotActive", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture4626);
      await time.increaseTo(deadline + 1);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await expect(campaign.connect(alice).contribute(CONTRIB))
        .to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });
  });

  // ── [Finalize] ───────────────────────────────────────────────────────────────

  describe("[Finalize] finalize()", () => {
    it("10. sets successful=true when totalRaised >= softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture4626);
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.true;
    });

    it("11. sets successful=false when totalRaised < softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture4626);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(alice).contribute(CONTRIB);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.false;
    });

    it("12. reverts if called before deadline — DeadlineNotReached", async () => {
      const { campaign } = await loadFixture(deployFixture4626);
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "DeadlineNotReached");
    });

    it("13. reverts on double finalization — AlreadyFinalized", async () => {
      const { campaign, deadline } = await loadFixture(deployFixture4626);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "AlreadyFinalized");
    });
  });

  // ── [Success → Milestone Withdraw] ──────────────────────────────────────────

  describe("[Success] withdrawMilestone()", () => {
    async function successFixture4626() {
      const f = await loadFixture(deployFixture4626);
      const { campaign, usdc, alice, deadline } = f;
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("14. creator withdraws milestones sequentially; balances match percentages", async () => {
      const { campaign, usdc, creator } = await successFixture4626();
      const creatorAddr = await creator.getAddress();
      const campaignAddr = await campaign.getAddress();

      // milestone 0: 30%
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(0n, SOFT_CAP * 30n / 100n, creatorAddr);

      // milestone 1: 30%
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(1n, SOFT_CAP * 30n / 100n, creatorAddr);

      // milestone 2: last — sweeps remaining
      await campaign.connect(creator).withdrawMilestone();

      expect(await usdc.balanceOf(campaignAddr)).to.equal(0n);
    });

    it("15. last milestone sweeps remaining balance (no dust)", async () => {
      const { campaign, usdc, creator } = await successFixture4626();
      const campaignAddr = await campaign.getAddress();
      const creatorAddr  = await creator.getAddress();

      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();

      const remaining = await usdc.balanceOf(campaignAddr);
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(2n, remaining, creatorAddr);

      expect(await usdc.balanceOf(campaignAddr)).to.equal(0n);
    });

    it("16. reverts for non-creator caller — NotCreator", async () => {
      const { campaign, alice } = await successFixture4626();
      await expect(campaign.connect(alice).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NotCreator");
    });

    it("21. reverts when all milestones already withdrawn — NoMoreMilestones", async () => {
      const { campaign, creator } = await successFixture4626();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NoMoreMilestones");
    });
  });

  // ── [Fail → Refund] ──────────────────────────────────────────────────────────

  describe("[Fail] refund()", () => {
    async function failFixture4626() {
      const f = await loadFixture(deployFixture4626);
      const { campaign, usdc, alice, bob, deadline } = f;
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(alice).contribute(CONTRIB);
      await usdc.connect(bob).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(bob).contribute(CONTRIB);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("17. contributor recovers full contribution; vault shares burned — Refunded event", async () => {
      const { campaign, usdc, alice } = await failFixture4626();
      const aliceAddr = await alice.getAddress();
      const balBefore = await usdc.balanceOf(aliceAddr);

      await expect(campaign.connect(alice).refund())
        .to.emit(campaign, "Refunded")
        .withArgs(aliceAddr, CONTRIB);

      expect(await usdc.balanceOf(aliceAddr)).to.equal(balBefore + CONTRIB);
      // Shares (campaign ERC-20 balance) burned to 0
      expect(await campaign.balanceOf(aliceAddr)).to.equal(0n);
    });

    it("18. reverts on refund for successful campaign — CampaignNotFailed", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture4626);
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.connect(alice).refund())
        .to.be.revertedWithCustomError(campaign, "CampaignNotFailed");
    });

    it("19. reverts on refund with zero contribution — NothingToRefund", async () => {
      const { campaign } = await failFixture4626();
      const signers = await hre.ethers.getSigners();
      const outsider = signers[10];
      await expect(campaign.connect(outsider).refund())
        .to.be.revertedWithCustomError(campaign, "NothingToRefund");
    });

    it("20. multi-contributor refund: both contributors recover correctly", async () => {
      const { campaign, usdc, alice, bob } = await failFixture4626();
      const aliceAddr = await alice.getAddress();
      const bobAddr   = await bob.getAddress();

      const aliceBefore = await usdc.balanceOf(aliceAddr);
      const bobBefore   = await usdc.balanceOf(bobAddr);

      await campaign.connect(alice).refund();
      await campaign.connect(bob).refund();

      expect(await usdc.balanceOf(aliceAddr)).to.equal(aliceBefore + CONTRIB);
      expect(await usdc.balanceOf(bobAddr)).to.equal(bobBefore + CONTRIB);
      expect(await usdc.balanceOf(await campaign.getAddress())).to.equal(0n);
    });
  });

  // ── [ERC-4626 overrides] ─────────────────────────────────────────────────────

  describe("[ERC-4626] disabled vault entry points", () => {
    it("22. should reject direct deposit() — UseContributeInstead", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture4626);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await expect(campaign.connect(alice).deposit(CONTRIB, await alice.getAddress()))
        .to.be.revertedWithCustomError(campaign, "UseContributeInstead");
    });

    it("23. should reject direct redeem() — UseRefundInstead", async () => {
      const { campaign, alice } = await loadFixture(deployFixture4626);
      await expect(campaign.connect(alice).redeem(CONTRIB, await alice.getAddress(), await alice.getAddress()))
        .to.be.revertedWithCustomError(campaign, "UseRefundInstead");
    });
  });
});

// ─── Factory tests ──────────────────────────────────────────────────────────

describe("CrowdfundingFactory4626", () => {
  it("1. createCampaign emits CampaignCreated4626 with correct args", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture4626);
    const deadline = (await time.latest()) + THIRTY_DAYS;
    const usdcAddr = await usdc.getAddress();

    const tx = await factory
      .connect(creator)
      .createCampaign(usdcAddr, SOFT_CAP, HARD_CAP, deadline, MILESTONES, "Token", "TKN");

    const receipt = await tx.wait();
    const factoryAddr = await factory.getAddress();
    const campaignAddr = parseCampaignAddress4626(receipt!.logs, factoryAddr, factory.interface);

    await expect(tx)
      .to.emit(factory, "CampaignCreated4626")
      .withArgs(campaignAddr, await creator.getAddress(), usdcAddr);
  });

  it("2. getCampaignsByCreator returns the created campaign", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture4626);
    const deadline = (await time.latest()) + THIRTY_DAYS;

    await factory
      .connect(creator)
      .createCampaign(await usdc.getAddress(), SOFT_CAP, HARD_CAP, deadline, MILESTONES, "T", "T");

    const creatorCampaigns = await factory.getCampaignsByCreator(await creator.getAddress());
    expect(creatorCampaigns).to.have.length(1);
    expect(creatorCampaigns[0]).to.not.equal(hre.ethers.ZeroAddress);
  });

  it("3. two campaigns have independent addresses — each IS its own ERC-4626 token", async () => {
    const { factory, usdc, creator, creator2 } = await loadFixture(deployFactoryFixture4626);
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

    const addr1 = parseCampaignAddress4626(r1!.logs, factoryAddr, iface);
    const addr2 = parseCampaignAddress4626(r2!.logs, factoryAddr, iface);

    // Each campaign is its own ERC-4626 vault token — addresses must differ
    expect(addr1).to.not.equal(addr2);
    expect(addr1).to.not.equal(hre.ethers.ZeroAddress);
    expect(addr2).to.not.equal(hre.ethers.ZeroAddress);

    // Verify each campaign wraps the same underlying asset
    const c1 = await hre.ethers.getContractAt("CrowdfundingCampaign4626", addr1);
    const c2 = await hre.ethers.getContractAt("CrowdfundingCampaign4626", addr2);
    expect(await c1.asset()).to.equal(usdcAddr);
    expect(await c2.asset()).to.equal(usdcAddr);
  });
});
