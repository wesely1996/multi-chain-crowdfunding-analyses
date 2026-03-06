/**
 * benchmark.ts — EVM crowdfunding gas benchmark
 *
 * Scenario:
 *   1. Deploy MockERC20 + CrowdfundingFactory + Campaign (hardCap = 500 USDC)
 *   2. Signers [1..50]: mint 10 USDC, approve, contribute(10 USDC) — record gasUsed each
 *   3. Advance time past deadline
 *   4. finalize() — record gas
 *   5. withdrawMilestone() × 3 — record gas each
 *   6. Print gas table
 */
import hre from "hardhat";

interface GasRecord {
  label: string;
  gasUsed: bigint;
}

async function main() {
  const signers = await hre.ethers.getSigners();
  if (signers.length < 51) {
    throw new Error("Need at least 51 signers — set accounts.count >= 51 in hardhat.config.ts");
  }

  const deployer = signers[0];
  const contributors = signers.slice(1, 51); // 50 contributors

  console.log("Deployer:", await deployer.getAddress());

  // ── Deploy ─────────────────────────────────────────────────────────────────
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC");
  await usdc.waitForDeployment();

  const Factory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const CONTRIB  = hre.ethers.parseUnits("10",  6); // 10 USDC per contributor
  const softCap  = hre.ethers.parseUnits("100", 6); // 100 USDC (easily reachable)
  const hardCap  = hre.ethers.parseUnits("500", 6); // 500 USDC (50 × 10)
  const deadline = Math.floor(Date.now() / 1000) + 30 * 86400;
  const milestones: number[] = [30, 30, 40];
  const usdcAddr = await usdc.getAddress();

  const createTx = await factory.createCampaign(
    usdcAddr, softCap, hardCap, deadline, milestones, "Bench Token", "BT"
  );
  const createReceipt = await createTx.wait();

  const factoryAddr = await factory.getAddress();
  const iface = factory.interface;
  let campaignAddr = "";
  for (const log of createReceipt!.logs) {
    if (log.address.toLowerCase() === factoryAddr.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "CampaignCreated") { campaignAddr = parsed.args[0]; break; }
      } catch {}
    }
  }

  const campaign = await hre.ethers.getContractAt("CrowdfundingCampaign", campaignAddr);
  console.log("Campaign:", campaignAddr);

  // ── 50 sequential contributions ───────────────────────────────────────────
  const contributeGas: bigint[] = [];

  for (let i = 0; i < 50; i++) {
    const signer = contributors[i];
    await usdc.mint(await signer.getAddress(), CONTRIB);
    await usdc.connect(signer).approve(campaignAddr, CONTRIB);
    const tx = await campaign.connect(signer).contribute(CONTRIB);
    const r = await tx.wait();
    contributeGas.push(r!.gasUsed);
    if ((i + 1) % 10 === 0) process.stdout.write(`  contributed: ${i + 1}/50\n`);
  }

  // ── Advance time + finalize ────────────────────────────────────────────────
  await hre.network.provider.send("evm_increaseTime", [30 * 86400 + 1]);
  await hre.network.provider.send("evm_mine", []);

  const finalizeTx = await campaign.finalize();
  const finalizeReceipt = await finalizeTx.wait();
  const finalizeGas = finalizeReceipt!.gasUsed;

  // ── Milestone withdrawals ─────────────────────────────────────────────────
  const milestoneGas: bigint[] = [];
  const creator = signers[0]; // deployer created via factory — but factory sets msg.sender as creator
  // The factory call was from deployer (signers[0]) — creator is deployer

  // Actually the factory was called by deployer (signers[0]), so creator = deployer
  for (let m = 0; m < milestones.length; m++) {
    const tx = await campaign.connect(deployer).withdrawMilestone();
    const r = await tx.wait();
    milestoneGas.push(r!.gasUsed);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const avgContribute = contributeGas.reduce((a, b) => a + b, 0n) / BigInt(contributeGas.length);
  const minContribute = contributeGas.reduce((a, b) => a < b ? a : b);
  const maxContribute = contributeGas.reduce((a, b) => a > b ? a : b);

  console.log("\n─── Gas Benchmark Results ───────────────────────────────────");
  console.log("Function               │ Gas Used");
  console.log("───────────────────────┼──────────────────");
  console.log(`contribute() avg       │ ${avgContribute.toLocaleString()}`);
  console.log(`contribute() min       │ ${minContribute.toLocaleString()}`);
  console.log(`contribute() max       │ ${maxContribute.toLocaleString()}`);
  console.log(`finalize()             │ ${finalizeGas.toLocaleString()}`);
  for (let m = 0; m < milestoneGas.length; m++) {
    console.log(`withdrawMilestone(${m})   │ ${milestoneGas[m].toLocaleString()}`);
  }
  console.log("─────────────────────────────────────────────────────────────");
  console.log(`Total contribute gas   : ${contributeGas.reduce((a, b) => a + b, 0n).toLocaleString()}`);
  console.log(`Contributions count    : ${contributeGas.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
