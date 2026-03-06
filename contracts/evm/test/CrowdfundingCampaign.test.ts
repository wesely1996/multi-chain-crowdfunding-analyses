import { expect } from "chai";
import hre from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  CrowdfundingCampaign,
  CrowdfundingFactory,
  MockERC20,
} from "../typechain-types";

// ─── constants ────────────────────────────────────────────────────────────────

const SOFT_CAP  = hre.ethers.parseUnits("50000",  6); // 50 000 USDC
const HARD_CAP  = hre.ethers.parseUnits("100000", 6); // 100 000 USDC
const CONTRIB   = hre.ethers.parseUnits("1000",   6); // 1 000 USDC per contributor
const MILESTONES: number[] = [30, 30, 40];
const ONE_DAY   = 86400;
const THIRTY_DAYS = 30 * ONE_DAY;

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const signers = await hre.ethers.getSigners();
  const [deployer, creator, alice, bob] = signers;

  // Deploy payment token
  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  // Deploy factory
  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory;

  // Create a campaign via factory
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

  // Parse campaign address from CampaignCreated event on the factory
  const factoryAddress = await factory.getAddress();
  const iface = factory.interface;
  let campaignAddress = "";
  for (const log of receipt!.logs) {
    if (log.address.toLowerCase() === factoryAddress.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated") {
          campaignAddress = parsed.args[0];
          break;
        }
      } catch {}
    }
  }
  if (!campaignAddress) throw new Error("CampaignCreated event not found");

  const campaign = (await hre.ethers.getContractAt(
    "CrowdfundingCampaign",
    campaignAddress
  )) as CrowdfundingCampaign;

  const receiptTokenAddress = await campaign.receiptToken();
  const receiptToken = await hre.ethers.getContractAt("CampaignToken", receiptTokenAddress);

  // Mint USDC to contributors
  await usdc.mint(await alice.getAddress(), hre.ethers.parseUnits("200000", 6));
  await usdc.mint(await bob.getAddress(),   hre.ethers.parseUnits("200000", 6));

  return { factory, campaign, usdc, receiptToken, deployer, creator, alice, bob, deadline };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function fundAndApprove(
  usdc: MockERC20,
  campaign: CrowdfundingCampaign,
  signer: Awaited<ReturnType<typeof hre.ethers.getSigner>>,
  amount: bigint
) {
  await usdc.connect(signer).approve(await campaign.getAddress(), amount);
  await campaign.connect(signer).contribute(amount);
}

// ─── test suites ──────────────────────────────────────────────────────────────

describe("CrowdfundingCampaign", () => {

  // ── [Init] ──────────────────────────────────────────────────────────────────

  describe("[Init] Constructor", () => {
    it("1. sets all constructor parameters correctly", async () => {
      const { campaign, usdc, creator, deadline } = await loadFixture(deployFixture);

      expect(await campaign.creator()).to.equal(await creator.getAddress());
      expect(await campaign.paymentToken()).to.equal(await usdc.getAddress());
      expect(await campaign.softCap()).to.equal(SOFT_CAP);
      expect(await campaign.hardCap()).to.equal(HARD_CAP);
      expect(await campaign.deadline()).to.equal(deadline);
      expect(await campaign.getMilestoneCount()).to.equal(3n);
    });

    it("2. deploys receipt token at non-zero address", async () => {
      const { campaign } = await loadFixture(deployFixture);
      const addr = await campaign.receiptToken();
      expect(addr).to.not.equal(hre.ethers.ZeroAddress);
    });

    it("3. reverts if softCap > hardCap — InvalidCapRange", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture);
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
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign")).interface }, "InvalidCapRange");
    });

    it("4. reverts if deadline is in the past — InvalidDeadline", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture);
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
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign")).interface }, "InvalidDeadline");
    });

    it("5. reverts if milestones don't sum to 100 — InvalidMilestonePercentages", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture);
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
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign")).interface }, "InvalidMilestonePercentages");
    });
  });

  // ── [Funding] ────────────────────────────────────────────────────────────────

  describe("[Funding] contribute()", () => {
    it("6. accepts valid contribution, mints receipt tokens 1:1, emits Contributed", async () => {
      const { campaign, usdc, alice, receiptToken } = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);

      await expect(campaign.connect(alice).contribute(CONTRIB))
        .to.emit(campaign, "Contributed")
        .withArgs(await alice.getAddress(), CONTRIB, CONTRIB);

      expect(await receiptToken.balanceOf(await alice.getAddress())).to.equal(CONTRIB);
      expect(await campaign.totalRaised()).to.equal(CONTRIB);
    });

    it("7. reverts on zero amount — ZeroAmount", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await expect(campaign.connect(alice).contribute(0n))
        .to.be.revertedWithCustomError(campaign, "ZeroAmount");
    });

    it("8. reverts when contribution exceeds hardCap — ContributionExceedsHardCap", async () => {
      const { campaign, usdc, alice } = await loadFixture(deployFixture);
      const over = HARD_CAP + 1n;
      await usdc.connect(alice).approve(await campaign.getAddress(), over);
      await expect(campaign.connect(alice).contribute(over))
        .to.be.revertedWithCustomError(campaign, "ContributionExceedsHardCap");
    });

    it("9. reverts after deadline — CampaignNotActive", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture);
      await time.increaseTo(deadline + 1);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await expect(campaign.connect(alice).contribute(CONTRIB))
        .to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });
  });

  // ── [Finalize] ───────────────────────────────────────────────────────────────

  describe("[Finalize] finalize()", () => {
    it("10. sets successful=true when totalRaised >= softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.true;
    });

    it("11. sets successful=false when totalRaised < softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(alice).contribute(CONTRIB);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.false;
    });

    it("12. reverts if called before deadline — DeadlineNotReached", async () => {
      const { campaign } = await loadFixture(deployFixture);
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "DeadlineNotReached");
    });

    it("13. reverts on double finalization — AlreadyFinalized", async () => {
      const { campaign, deadline } = await loadFixture(deployFixture);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "AlreadyFinalized");
    });
  });

  // ── [Success → Milestone Withdraw] ──────────────────────────────────────────

  describe("[Success] withdrawMilestone()", () => {
    async function successFixture() {
      const f = await loadFixture(deployFixture);
      const { campaign, usdc, alice, creator, deadline } = f;
      // Fund exactly softCap
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("14. creator withdraws milestones sequentially; balances match percentages", async () => {
      const { campaign, usdc, creator } = await successFixture();
      const creatorAddr = await creator.getAddress();
      const campaignAddr = await campaign.getAddress();

      const before = await usdc.balanceOf(creatorAddr);

      // milestone 0: 30%
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(0n, SOFT_CAP * 30n / 100n);

      // milestone 1: 30%
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(1n, SOFT_CAP * 30n / 100n);

      // milestone 2: last — sweeps remaining
      await campaign.connect(creator).withdrawMilestone();

      expect(await usdc.balanceOf(campaignAddr)).to.equal(0n);
    });

    it("15. last milestone sweeps remaining balance (no dust)", async () => {
      const { campaign, usdc, creator } = await successFixture();
      const campaignAddr = await campaign.getAddress();

      // exhaust first two milestones
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();

      const remaining = await usdc.balanceOf(campaignAddr);
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(2n, remaining);

      expect(await usdc.balanceOf(campaignAddr)).to.equal(0n);
    });

    it("16. reverts for non-creator caller — NotCreator", async () => {
      const { campaign, alice } = await successFixture();
      await expect(campaign.connect(alice).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NotCreator");
    });

    it("21. reverts when all milestones already withdrawn — NoMoreMilestones", async () => {
      const { campaign, creator } = await successFixture();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NoMoreMilestones");
    });
  });

  // ── [Fail → Refund] ──────────────────────────────────────────────────────────

  describe("[Fail] refund()", () => {
    async function failFixture() {
      const f = await loadFixture(deployFixture);
      const { campaign, usdc, alice, bob, deadline } = f;
      // Contribute less than softCap
      await usdc.connect(alice).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(alice).contribute(CONTRIB);
      await usdc.connect(bob).approve(await campaign.getAddress(), CONTRIB);
      await campaign.connect(bob).contribute(CONTRIB);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("17. contributor recovers full contribution; receipt tokens burned — Refunded event", async () => {
      const { campaign, usdc, receiptToken, alice } = await failFixture();
      const aliceAddr = await alice.getAddress();
      const balBefore = await usdc.balanceOf(aliceAddr);

      await expect(campaign.connect(alice).refund())
        .to.emit(campaign, "Refunded")
        .withArgs(aliceAddr, CONTRIB);

      expect(await usdc.balanceOf(aliceAddr)).to.equal(balBefore + CONTRIB);
      expect(await receiptToken.balanceOf(aliceAddr)).to.equal(0n);
    });

    it("18. reverts on refund for successful campaign — CampaignNotFailed", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture);
      await usdc.connect(alice).approve(await campaign.getAddress(), SOFT_CAP);
      await campaign.connect(alice).contribute(SOFT_CAP);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.connect(alice).refund())
        .to.be.revertedWithCustomError(campaign, "CampaignNotFailed");
    });

    it("19. reverts on refund with zero contribution — NothingToRefund", async () => {
      const { campaign, bob } = await failFixture();
      // Bob contributed but let's use a signer who didn't contribute
      const signers = await hre.ethers.getSigners();
      const outsider = signers[10];
      await expect(campaign.connect(outsider).refund())
        .to.be.revertedWithCustomError(campaign, "NothingToRefund");
    });

    it("20. multi-contributor refund: both contributors recover correctly", async () => {
      const { campaign, usdc, alice, bob } = await failFixture();
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
});
