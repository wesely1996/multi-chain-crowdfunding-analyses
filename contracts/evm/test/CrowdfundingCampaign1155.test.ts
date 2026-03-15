import { expect } from "chai";
import hre from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  CrowdfundingCampaign1155,
  CrowdfundingFactory1155,
  MockERC20,
} from "../typechain-types";
import { MILESTONES, THIRTY_DAYS } from "./fixtures";

// ─── 1155-specific constants ─────────────────────────────────────────────────

const TIER_PRICES = [
  hre.ethers.parseUnits("100",  6), // Bronze: 100 USDC
  hre.ethers.parseUnits("500",  6), // Silver: 500 USDC
  hre.ethers.parseUnits("1000", 6), // Gold:  1000 USDC
];
const TIER_NAMES = ["Bronze", "Silver", "Gold"];

// softCap = Silver price → alice contributes Silver to reach exactly softCap
const SOFT_CAP_1155 = hre.ethers.parseUnits("500",  6);
// hardCap = Gold price → alice contributes Gold to fill hardCap
const HARD_CAP_1155 = hre.ethers.parseUnits("1000", 6);

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseCampaignAddress1155(logs: any[], factoryAddress: string, iface: any): string {
  for (const log of logs) {
    if (log.address.toLowerCase() === factoryAddress.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated1155") return parsed.args[0];
      } catch {}
    }
  }
  throw new Error("CampaignCreated1155 event not found");
}

// ─── fixtures ────────────────────────────────────────────────────────────────

async function deployFactoryFixture1155() {
  const [deployer, creator, creator2] = await hre.ethers.getSigners();

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory1155;

  return { factory, usdc, deployer, creator, creator2 };
}

async function deployFixture1155() {
  const signers = await hre.ethers.getSigners();
  const [deployer, creator, alice, bob] = signers;

  const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("Mock USDC", "USDC")) as MockERC20;

  const FactoryFactory = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
  const factory = (await FactoryFactory.deploy()) as CrowdfundingFactory1155;

  const deadline = (await time.latest()) + THIRTY_DAYS;
  const tx = await factory
    .connect(creator)
    .createCampaign(
      await usdc.getAddress(),
      SOFT_CAP_1155,
      HARD_CAP_1155,
      deadline,
      MILESTONES,
      TIER_PRICES as [bigint, bigint, bigint],
      TIER_NAMES as [string, string, string],
      ""
    );
  const receipt = await tx.wait();

  const factoryAddress = await factory.getAddress();
  const campaignAddress = parseCampaignAddress1155(receipt!.logs, factoryAddress, factory.interface);

  const campaign = (await hre.ethers.getContractAt(
    "CrowdfundingCampaign1155",
    campaignAddress
  )) as CrowdfundingCampaign1155;

  const tierTokenAddress = await campaign.tierToken();
  const tierToken = await hre.ethers.getContractAt("CampaignTierToken", tierTokenAddress);

  await usdc.mint(await alice.getAddress(), hre.ethers.parseUnits("200000", 6));
  await usdc.mint(await bob.getAddress(),   hre.ethers.parseUnits("200000", 6));

  return { factory, campaign, usdc, tierToken, deployer, creator, alice, bob, deadline };
}

// ─── test suites ──────────────────────────────────────────────────────────────

describe("CrowdfundingCampaign1155", () => {

  // ── [Init] ──────────────────────────────────────────────────────────────────

  describe("[Init] Constructor", () => {
    it("1. sets all constructor parameters correctly", async () => {
      const { campaign, usdc, creator, deadline } = await loadFixture(deployFixture1155);

      expect(await campaign.creator()).to.equal(await creator.getAddress());
      expect(await campaign.paymentToken()).to.equal(await usdc.getAddress());
      expect(await campaign.softCap()).to.equal(SOFT_CAP_1155);
      expect(await campaign.hardCap()).to.equal(HARD_CAP_1155);
      expect(await campaign.deadline()).to.equal(deadline);
      expect(await campaign.getMilestoneCount()).to.equal(3n);
    });

    it("2. deploys tierToken at non-zero address with correct tiers", async () => {
      const { campaign } = await loadFixture(deployFixture1155);
      const tierTokenAddr = await campaign.tierToken();
      expect(tierTokenAddr).to.not.equal(hre.ethers.ZeroAddress);

      // Verify tier prices stored correctly
      const bronze = await campaign.tiers(0);
      const silver = await campaign.tiers(1);
      const gold   = await campaign.tiers(2);
      expect(bronze.price).to.equal(TIER_PRICES[0]);
      expect(silver.price).to.equal(TIER_PRICES[1]);
      expect(gold.price).to.equal(TIER_PRICES[2]);
    });

    it("3. reverts if softCap > hardCap — InvalidCapRange", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture1155);
      const deadline = (await time.latest()) + THIRTY_DAYS;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          HARD_CAP_1155,   // softCap > hardCap
          SOFT_CAP_1155,
          deadline,
          MILESTONES,
          TIER_PRICES as [bigint, bigint, bigint],
          TIER_NAMES as [string, string, string],
          ""
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign1155")).interface }, "InvalidCapRange");
    });

    it("4. reverts if deadline is in the past — InvalidDeadline", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture1155);
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          SOFT_CAP_1155,
          HARD_CAP_1155,
          pastDeadline,
          MILESTONES,
          TIER_PRICES as [bigint, bigint, bigint],
          TIER_NAMES as [string, string, string],
          ""
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign1155")).interface }, "InvalidDeadline");
    });

    it("5. reverts if milestones don't sum to 100 — InvalidMilestonePercentages", async () => {
      const { factory, usdc, creator } = await loadFixture(deployFixture1155);
      const deadline = (await time.latest()) + THIRTY_DAYS;
      await expect(
        factory.connect(creator).createCampaign(
          await usdc.getAddress(),
          SOFT_CAP_1155,
          HARD_CAP_1155,
          deadline,
          [40, 40, 40], // sums to 120
          TIER_PRICES as [bigint, bigint, bigint],
          TIER_NAMES as [string, string, string],
          ""
        )
      ).to.be.revertedWithCustomError({ interface: (await hre.ethers.getContractFactory("CrowdfundingCampaign1155")).interface }, "InvalidMilestonePercentages");
    });
  });

  // ── [Funding] ────────────────────────────────────────────────────────────────

  describe("[Funding] contribute(tierId)", () => {
    it("6. accepts valid Bronze contribution, mints tier token, emits Contributed", async () => {
      const { campaign, usdc, tierToken, alice } = await loadFixture(deployFixture1155);
      const aliceAddr    = await alice.getAddress();
      const campaignAddr = await campaign.getAddress();
      await usdc.connect(alice).approve(campaignAddr, TIER_PRICES[0]);

      await expect(campaign.connect(alice).contribute(0))
        .to.emit(campaign, "Contributed")
        .withArgs(aliceAddr, TIER_PRICES[0], TIER_PRICES[0]);

      expect(await tierToken.balanceOf(aliceAddr, 0)).to.equal(1n);
      expect(await campaign.totalRaised()).to.equal(TIER_PRICES[0]);
    });

    it("7. reverts on invalid tierId — InvalidTierId", async () => {
      const { campaign } = await loadFixture(deployFixture1155);
      await expect(campaign.contribute(3))
        .to.be.revertedWithCustomError(campaign, "InvalidTierId");
    });

    it("8. reverts when contribution exceeds hardCap — ContributionExceedsHardCap", async () => {
      const { campaign, usdc, alice, bob } = await loadFixture(deployFixture1155);
      const campaignAddr = await campaign.getAddress();

      // Alice fills hardCap with Gold (1000 USDC = HARD_CAP_1155)
      await usdc.connect(alice).approve(campaignAddr, TIER_PRICES[2]);
      await campaign.connect(alice).contribute(2); // Gold

      // Bob tries Bronze — would exceed hardCap
      await usdc.connect(bob).approve(campaignAddr, TIER_PRICES[0]);
      await expect(campaign.connect(bob).contribute(0))
        .to.be.revertedWithCustomError(campaign, "ContributionExceedsHardCap");
    });

    it("9. reverts after deadline — CampaignNotActive", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture1155);
      await time.increaseTo(deadline + 1);
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[0]);
      await expect(campaign.connect(alice).contribute(0))
        .to.be.revertedWithCustomError(campaign, "CampaignNotActive");
    });
  });

  // ── [Finalize] ───────────────────────────────────────────────────────────────

  describe("[Finalize] finalize()", () => {
    it("10. sets successful=true when totalRaised >= softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture1155);
      // Silver = 500 USDC = SOFT_CAP_1155
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[1]);
      await campaign.connect(alice).contribute(1); // Silver
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.true;
    });

    it("11. sets successful=false when totalRaised < softCap", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture1155);
      // Bronze = 100 USDC < SOFT_CAP_1155 (500 USDC)
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[0]);
      await campaign.connect(alice).contribute(0); // Bronze
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      expect(await campaign.successful()).to.be.false;
    });

    it("12. reverts if called before deadline — DeadlineNotReached", async () => {
      const { campaign } = await loadFixture(deployFixture1155);
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "DeadlineNotReached");
    });

    it("13. reverts on double finalization — AlreadyFinalized", async () => {
      const { campaign, deadline } = await loadFixture(deployFixture1155);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.finalize())
        .to.be.revertedWithCustomError(campaign, "AlreadyFinalized");
    });
  });

  // ── [Success → Milestone Withdraw] ──────────────────────────────────────────

  describe("[Success] withdrawMilestone()", () => {
    async function successFixture1155() {
      const f = await loadFixture(deployFixture1155);
      const { campaign, usdc, alice, deadline } = f;
      // Silver = 500 USDC = SOFT_CAP_1155
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[1]);
      await campaign.connect(alice).contribute(1); // Silver
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("14. creator withdraws milestones sequentially; balances match percentages", async () => {
      const { campaign, usdc, creator } = await successFixture1155();
      const creatorAddr  = await creator.getAddress();
      const campaignAddr = await campaign.getAddress();

      // milestone 0: 30% of 500e6 = 150e6
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(0n, SOFT_CAP_1155 * 30n / 100n, creatorAddr);

      // milestone 1: 30%
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.emit(campaign, "MilestoneWithdrawn")
        .withArgs(1n, SOFT_CAP_1155 * 30n / 100n, creatorAddr);

      // milestone 2: last — sweeps remaining
      await campaign.connect(creator).withdrawMilestone();

      expect(await usdc.balanceOf(campaignAddr)).to.equal(0n);
    });

    it("15. last milestone sweeps remaining balance (no dust)", async () => {
      const { campaign, usdc, creator } = await successFixture1155();
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
      const { campaign, alice } = await successFixture1155();
      await expect(campaign.connect(alice).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NotCreator");
    });

    it("21. reverts when all milestones already withdrawn — NoMoreMilestones", async () => {
      const { campaign, creator } = await successFixture1155();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await campaign.connect(creator).withdrawMilestone();
      await expect(campaign.connect(creator).withdrawMilestone())
        .to.be.revertedWithCustomError(campaign, "NoMoreMilestones");
    });
  });

  // ── [Fail → Refund] ──────────────────────────────────────────────────────────

  describe("[Fail] refund(tierId)", () => {
    async function failFixture1155() {
      const f = await loadFixture(deployFixture1155);
      const { campaign, usdc, alice, bob, deadline } = f;
      // Both contribute Bronze — total 200 USDC < SOFT_CAP_1155 (500 USDC)
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[0]);
      await campaign.connect(alice).contribute(0); // Bronze
      await usdc.connect(bob).approve(await campaign.getAddress(), TIER_PRICES[0]);
      await campaign.connect(bob).contribute(0);   // Bronze
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      return f;
    }

    it("17. contributor recovers tier contribution; tier token burned — Refunded event", async () => {
      const { campaign, usdc, tierToken, alice } = await failFixture1155();
      const aliceAddr = await alice.getAddress();
      const balBefore = await usdc.balanceOf(aliceAddr);

      await expect(campaign.connect(alice).refund(0))
        .to.emit(campaign, "Refunded")
        .withArgs(aliceAddr, TIER_PRICES[0]);

      expect(await usdc.balanceOf(aliceAddr)).to.equal(balBefore + TIER_PRICES[0]);
      expect(await tierToken.balanceOf(aliceAddr, 0)).to.equal(0n);
    });

    it("18. reverts on refund for successful campaign — CampaignNotFailed", async () => {
      const { campaign, usdc, alice, deadline } = await loadFixture(deployFixture1155);
      // Silver = softCap → success
      await usdc.connect(alice).approve(await campaign.getAddress(), TIER_PRICES[1]);
      await campaign.connect(alice).contribute(1);
      await time.increaseTo(deadline + 1);
      await campaign.finalize();
      await expect(campaign.connect(alice).refund(1))
        .to.be.revertedWithCustomError(campaign, "CampaignNotFailed");
    });

    it("19. reverts on refund with no tier contribution — NothingToRefundForTier", async () => {
      const { campaign } = await failFixture1155();
      const signers = await hre.ethers.getSigners();
      const outsider = signers[10];
      await expect(campaign.connect(outsider).refund(0))
        .to.be.revertedWithCustomError(campaign, "NothingToRefundForTier");
    });

    it("20. multi-contributor refund: both contributors recover correctly", async () => {
      const { campaign, usdc, alice, bob } = await failFixture1155();
      const aliceAddr = await alice.getAddress();
      const bobAddr   = await bob.getAddress();

      const aliceBefore = await usdc.balanceOf(aliceAddr);
      const bobBefore   = await usdc.balanceOf(bobAddr);

      await campaign.connect(alice).refund(0);
      await campaign.connect(bob).refund(0);

      expect(await usdc.balanceOf(aliceAddr)).to.equal(aliceBefore + TIER_PRICES[0]);
      expect(await usdc.balanceOf(bobAddr)).to.equal(bobBefore + TIER_PRICES[0]);
      expect(await usdc.balanceOf(await campaign.getAddress())).to.equal(0n);
    });
  });

  // ── [ERC-1155 tier extras] ────────────────────────────────────────────────────

  describe("[Tiers] additional tier behaviour", () => {
    it("22. multi-tier contribution: contributor buys Bronze + Silver + Gold; all balances correct", async () => {
      const { campaign, usdc, tierToken, alice } = await loadFixture(deployFixture1155);
      const aliceAddr    = await alice.getAddress();
      const campaignAddr = await campaign.getAddress();
      const totalCost    = TIER_PRICES[0] + TIER_PRICES[1] + TIER_PRICES[2]; // 1600 USDC

      // Need a campaign with large enough hardCap — redeploy with higher caps inline
      const [, , , , signers5] = await hre.ethers.getSigners();
      // Use the fixture campaign (hardCap=1000e6). Total 1600e6 would exceed.
      // Instead, approve & contribute each tier separately checking it stays in cap:
      // Bronze (100) + Silver (500) + Gold (1000) = 1600 > hardCap (1000). Need bigger hardCap.
      // Deploy fresh campaign with hardCap=2000e6
      const MockERC20Factory2 = await hre.ethers.getContractFactory("MockERC20");
      const usdc2 = await MockERC20Factory2.deploy("Mock USDC", "USDC");
      await usdc2.waitForDeployment();

      const Factory2 = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
      const factory2 = await Factory2.deploy();
      await factory2.waitForDeployment();

      const bigHardCap = hre.ethers.parseUnits("2000", 6);
      const dl2 = (await time.latest()) + THIRTY_DAYS;
      const tx2 = await factory2.connect(alice).createCampaign(
        await usdc2.getAddress(),
        SOFT_CAP_1155, bigHardCap, dl2,
        MILESTONES,
        TIER_PRICES as [bigint, bigint, bigint],
        TIER_NAMES as [string, string, string],
        ""
      );
      const r2 = await tx2.wait();
      const fAddr2 = await factory2.getAddress();
      const cAddr2 = parseCampaignAddress1155(r2!.logs, fAddr2, factory2.interface);
      const camp2 = await hre.ethers.getContractAt("CrowdfundingCampaign1155", cAddr2);
      const tt2Addr = await camp2.tierToken();
      const tt2 = await hre.ethers.getContractAt("CampaignTierToken", tt2Addr);

      await usdc2.mint(aliceAddr, totalCost);
      await usdc2.connect(alice).approve(cAddr2, totalCost);

      await camp2.connect(alice).contribute(0); // Bronze
      await camp2.connect(alice).contribute(1); // Silver
      await camp2.connect(alice).contribute(2); // Gold

      expect(await tt2.balanceOf(aliceAddr, 0)).to.equal(1n); // Bronze
      expect(await tt2.balanceOf(aliceAddr, 1)).to.equal(1n); // Silver
      expect(await tt2.balanceOf(aliceAddr, 2)).to.equal(1n); // Gold
      expect(await camp2.totalRaised()).to.equal(totalCost);
    });

    it("23. independent tier tracking: Alice buys Bronze, Bob buys Gold; tierContributions correct", async () => {
      const { campaign, usdc, alice, bob } = await loadFixture(deployFixture1155);
      const aliceAddr    = await alice.getAddress();
      const bobAddr      = await bob.getAddress();
      const campaignAddr = await campaign.getAddress();

      await usdc.connect(alice).approve(campaignAddr, TIER_PRICES[0]);
      await campaign.connect(alice).contribute(0); // Bronze

      // Bob needs Gold but hardCap=1000e6, Bronze already uses 100e6 → 900e6 remaining < Gold (1000e6)
      // So Bob contributes Silver (500e6) instead — still independent tier tracking
      await usdc.connect(bob).approve(campaignAddr, TIER_PRICES[1]);
      await campaign.connect(bob).contribute(1); // Silver

      expect(await campaign.tierContributions(aliceAddr, 0)).to.equal(1n); // Alice: 1 Bronze
      expect(await campaign.tierContributions(aliceAddr, 1)).to.equal(0n); // Alice: 0 Silver
      expect(await campaign.tierContributions(bobAddr,   0)).to.equal(0n); // Bob:   0 Bronze
      expect(await campaign.tierContributions(bobAddr,   1)).to.equal(1n); // Bob:   1 Silver
    });

    it("24. partial refund: contribute Bronze + Silver, refund Bronze only; Silver balance unchanged", async () => {
      const { campaign, usdc, tierToken, alice, deadline } = await loadFixture(deployFixture1155);
      const aliceAddr    = await alice.getAddress();
      const campaignAddr = await campaign.getAddress();

      // Need hardCap to fit Bronze + Silver = 600 USDC; current hardCap = 1000 USDC ✓
      await usdc.connect(alice).approve(campaignAddr, TIER_PRICES[0] + TIER_PRICES[1]);
      await campaign.connect(alice).contribute(0); // Bronze (100)
      await campaign.connect(alice).contribute(1); // Silver (500)

      // Fail the campaign (no one else, total = 600 > softCap 500, so actually success!)
      // Need a campaign that will fail — redeploy with higher softCap
      // Let's just check before finalization that partial state is tracked,
      // then finalize with a fail by using a fixture with higher softCap.

      // Instead: advance time and check totalRaised < a higher softCap.
      // For simplicity: reuse deployFixture1155's softCap=500e6.
      // Bronze+Silver = 100+500 = 600 > softCap(500) → campaign would SUCCEED → can't refund.
      // So partial refund only makes sense on a failed campaign.
      // Redeploy with softCap=5000e6 (unreachable).

      const MockERC20FactoryP = await hre.ethers.getContractFactory("MockERC20");
      const usdcP = await MockERC20FactoryP.deploy("Mock USDC", "USDC");
      await usdcP.waitForDeployment();

      const FactoryP = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
      const factoryP = await FactoryP.deploy();
      await factoryP.waitForDeployment();

      const bigSoftCap = hre.ethers.parseUnits("5000", 6);
      const bigHardCap = hre.ethers.parseUnits("10000", 6);
      const dlP = (await time.latest()) + THIRTY_DAYS;
      const txP = await factoryP.connect(alice).createCampaign(
        await usdcP.getAddress(),
        bigSoftCap, bigHardCap, dlP,
        MILESTONES,
        TIER_PRICES as [bigint, bigint, bigint],
        TIER_NAMES as [string, string, string],
        ""
      );
      const rP = await txP.wait();
      const fAddrP = await factoryP.getAddress();
      const cAddrP = parseCampaignAddress1155(rP!.logs, fAddrP, factoryP.interface);
      const campP = await hre.ethers.getContractAt("CrowdfundingCampaign1155", cAddrP);
      const ttPAddr = await campP.tierToken();
      const ttP = await hre.ethers.getContractAt("CampaignTierToken", ttPAddr);

      const costP = TIER_PRICES[0] + TIER_PRICES[1]; // 600 USDC
      await usdcP.mint(aliceAddr, costP);
      await usdcP.connect(alice).approve(cAddrP, costP);

      await campP.connect(alice).contribute(0); // Bronze
      await campP.connect(alice).contribute(1); // Silver

      // Verify holdings before refund
      expect(await ttP.balanceOf(aliceAddr, 0)).to.equal(1n);
      expect(await ttP.balanceOf(aliceAddr, 1)).to.equal(1n);

      // Fail the campaign
      await time.increaseTo(dlP + 1);
      await campP.finalize();
      expect(await campP.successful()).to.be.false;

      // Refund Bronze only
      await campP.connect(alice).refund(0);

      // Silver balance unchanged
      expect(await ttP.balanceOf(aliceAddr, 0)).to.equal(0n); // Bronze burned
      expect(await ttP.balanceOf(aliceAddr, 1)).to.equal(1n); // Silver intact
      expect(await campP.tierContributions(aliceAddr, 0)).to.equal(0n);
      expect(await campP.tierContributions(aliceAddr, 1)).to.equal(1n);
    });
  });
});

// ─── Factory tests ──────────────────────────────────────────────────────────

describe("CrowdfundingFactory1155", () => {
  it("1. createCampaign emits CampaignCreated1155 with correct args", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture1155);
    const deadline = (await time.latest()) + THIRTY_DAYS;
    const usdcAddr = await usdc.getAddress();

    const tx = await factory
      .connect(creator)
      .createCampaign(
        usdcAddr, SOFT_CAP_1155, HARD_CAP_1155, deadline, MILESTONES,
        TIER_PRICES as [bigint, bigint, bigint],
        TIER_NAMES as [string, string, string],
        ""
      );

    const receipt = await tx.wait();
    const factoryAddr = await factory.getAddress();
    const campaignAddr = parseCampaignAddress1155(receipt!.logs, factoryAddr, factory.interface);

    const campaignContract = await hre.ethers.getContractAt("CrowdfundingCampaign1155", campaignAddr);
    const tierTokenAddr = await campaignContract.tierToken();

    await expect(tx)
      .to.emit(factory, "CampaignCreated1155")
      .withArgs(campaignAddr, await creator.getAddress(), usdcAddr, tierTokenAddr);
  });

  it("2. getCampaignsByCreator returns the created campaign", async () => {
    const { factory, usdc, creator } = await loadFixture(deployFactoryFixture1155);
    const deadline = (await time.latest()) + THIRTY_DAYS;

    await factory
      .connect(creator)
      .createCampaign(
        await usdc.getAddress(), SOFT_CAP_1155, HARD_CAP_1155, deadline, MILESTONES,
        TIER_PRICES as [bigint, bigint, bigint],
        TIER_NAMES as [string, string, string],
        ""
      );

    const creatorCampaigns = await factory.getCampaignsByCreator(await creator.getAddress());
    expect(creatorCampaigns).to.have.length(1);
    expect(creatorCampaigns[0]).to.not.equal(hre.ethers.ZeroAddress);
  });

  it("3. two campaigns get independent tierToken addresses", async () => {
    const { factory, usdc, creator, creator2 } = await loadFixture(deployFactoryFixture1155);
    const deadline = (await time.latest()) + THIRTY_DAYS;
    const usdcAddr = await usdc.getAddress();

    const tx1 = await factory.connect(creator).createCampaign(
      usdcAddr, SOFT_CAP_1155, HARD_CAP_1155, deadline, MILESTONES,
      TIER_PRICES as [bigint, bigint, bigint], TIER_NAMES as [string, string, string], ""
    );
    const tx2 = await factory.connect(creator2).createCampaign(
      usdcAddr, SOFT_CAP_1155, HARD_CAP_1155, deadline, MILESTONES,
      TIER_PRICES as [bigint, bigint, bigint], TIER_NAMES as [string, string, string], ""
    );

    const r1 = await tx1.wait();
    const r2 = await tx2.wait();
    const factoryAddr = await factory.getAddress();
    const iface = factory.interface;

    const addr1 = parseCampaignAddress1155(r1!.logs, factoryAddr, iface);
    const addr2 = parseCampaignAddress1155(r2!.logs, factoryAddr, iface);

    const c1 = await hre.ethers.getContractAt("CrowdfundingCampaign1155", addr1);
    const c2 = await hre.ethers.getContractAt("CrowdfundingCampaign1155", addr2);

    const tt1 = await c1.tierToken();
    const tt2 = await c2.tierToken();

    expect(tt1).to.not.equal(tt2);
    expect(tt1).to.not.equal(hre.ethers.ZeroAddress);
    expect(tt2).to.not.equal(hre.ethers.ZeroAddress);
  });
});
