import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());

  // ── MockERC20 ──────────────────────────────────────────────────────────────
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC");
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockERC20:", usdcAddr);

  // Mint 1 000 000 USDC to deployer
  const oneMillionUSDC = hre.ethers.parseUnits("1000000", 6);
  await usdc.mint(await deployer.getAddress(), oneMillionUSDC);
  console.log("Minted 1 000 000 USDC to deployer");

  // ── CrowdfundingFactory ────────────────────────────────────────────────────
  const Factory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("CrowdfundingFactory:", factoryAddr);

  // ── Create campaign via factory ───────────────────────────────────────────
  const softCap  = hre.ethers.parseUnits("50000",  6); // 50 000 USDC
  const hardCap  = hre.ethers.parseUnits("100000", 6); // 100 000 USDC
  const deadline = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days from now
  const milestones: number[] = [30, 30, 40];

  const tx = await factory.createCampaign(
    usdcAddr,
    softCap,
    hardCap,
    deadline,
    milestones,
    "Campaign Receipt Token",
    "CRT"
  );
  const receipt = await tx.wait();

  // Parse campaign address from factory CampaignCreated event
  const factoryIface = factory.interface;
  let campaignAddr = "";
  for (const log of receipt!.logs) {
    if (log.address.toLowerCase() === factoryAddr.toLowerCase()) {
      try {
        const parsed = factoryIface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated") {
          campaignAddr = parsed.args[0];
          break;
        }
      } catch {}
    }
  }

  const campaign = await hre.ethers.getContractAt("CrowdfundingCampaign", campaignAddr);
  const receiptTokenAddr = await campaign.receiptToken();

  console.log("\n─── Deployment Summary ──────────────────────────────────────");
  console.log("MockERC20 (USDC):       ", usdcAddr);
  console.log("CrowdfundingFactory:    ", factoryAddr);
  console.log("CrowdfundingCampaign:   ", campaignAddr);
  console.log("CampaignToken (CRT):    ", receiptTokenAddr);
  console.log("softCap:                 50 000 USDC");
  console.log("hardCap:                100 000 USDC");
  console.log("deadline:               ", new Date(deadline * 1000).toISOString());
  console.log("milestones:             ", milestones.join("% / ") + "%");
  console.log("─────────────────────────────────────────────────────────────");

  // ── CrowdfundingFactory4626 ────────────────────────────────────────────────
  const Factory4626 = await hre.ethers.getContractFactory("CrowdfundingFactory4626");
  const factory4626 = await Factory4626.deploy();
  await factory4626.waitForDeployment();
  const factory4626Addr = await factory4626.getAddress();
  console.log("\nCrowdfundingFactory4626:", factory4626Addr);

  const tx4626 = await factory4626.createCampaign(
    usdcAddr,
    softCap,
    hardCap,
    deadline,
    milestones,
    "Campaign Vault Share",
    "CVS"
  );
  const receipt4626 = await tx4626.wait();

  const iface4626 = factory4626.interface;
  let campaign4626Addr = "";
  for (const log of receipt4626!.logs) {
    if (log.address.toLowerCase() === factory4626Addr.toLowerCase()) {
      try {
        const parsed = iface4626.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated4626") {
          campaign4626Addr = parsed.args[0];
          break;
        }
      } catch {}
    }
  }

  console.log("\n─── ERC-4626 Deployment Summary ─────────────────────────────");
  console.log("CrowdfundingFactory4626: ", factory4626Addr);
  console.log("CrowdfundingCampaign4626:", campaign4626Addr);
  console.log("(Campaign IS the vault share token — no separate CampaignToken)");
  console.log("─────────────────────────────────────────────────────────────");

  // ── CrowdfundingFactory1155 ────────────────────────────────────────────────
  const Factory1155 = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
  const factory1155 = await Factory1155.deploy();
  await factory1155.waitForDeployment();
  const factory1155Addr = await factory1155.getAddress();
  console.log("\nCrowdfundingFactory1155:", factory1155Addr);

  const tierPrices: [bigint, bigint, bigint] = [
    hre.ethers.parseUnits("100",  6), // Bronze
    hre.ethers.parseUnits("500",  6), // Silver
    hre.ethers.parseUnits("1000", 6), // Gold
  ];
  const tierNames: [string, string, string] = ["Bronze", "Silver", "Gold"];

  const tx1155 = await factory1155.createCampaign(
    usdcAddr,
    softCap,
    hardCap,
    deadline,
    milestones,
    tierPrices,
    tierNames,
    "https://example.com/tiers/{id}.json"
  );
  const receipt1155 = await tx1155.wait();

  const iface1155 = factory1155.interface;
  let campaign1155Addr = "";
  let tierTokenAddr   = "";
  for (const log of receipt1155!.logs) {
    if (log.address.toLowerCase() === factory1155Addr.toLowerCase()) {
      try {
        const parsed = iface1155.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated1155") {
          campaign1155Addr = parsed.args[0];
          tierTokenAddr    = parsed.args[3];
          break;
        }
      } catch {}
    }
  }

  console.log("\n─── ERC-1155 Deployment Summary ─────────────────────────────");
  console.log("CrowdfundingFactory1155: ", factory1155Addr);
  console.log("CrowdfundingCampaign1155:", campaign1155Addr);
  console.log("CampaignTierToken:       ", tierTokenAddr);
  console.log("Tiers: Bronze=100 USDC / Silver=500 USDC / Gold=1000 USDC");
  console.log("─────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
