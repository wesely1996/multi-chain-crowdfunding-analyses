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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
