/**
 * benchmark.ts — EVM crowdfunding gas benchmark (all three variants)
 *
 * Runs the same scenario for ERC-20 (V1), ERC-4626 (V2), and ERC-1155 (V3):
 *   1. Deploy MockERC20 + Factory + Campaign
 *   2. Signers [1..50]: mint, approve, contribute — record gasUsed each
 *   3. Advance time past deadline
 *   4. finalize() — record gas
 *   5. withdrawMilestone() × 3 — record gas each
 *   6. Print side-by-side comparison table
 *
 * ERC-20 / ERC-4626: contribute(amount)  — 50 × 10 USDC
 * ERC-1155:          contribute(tierId)  — 50 × Bronze (10 USDC each)
 */
import hre from "hardhat";

interface GasRecord {
  label: string;
  gasUsed: bigint;
}

interface VariantStats {
  name: string;
  contributeAvg: bigint;
  contributeMin: bigint;
  contributeMax: bigint;
  finalizeGas: bigint;
  milestoneGas: bigint[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseCampaignFromLogs(logs: any[], factoryAddr: string, iface: any, eventName: string): string {
  for (const log of logs) {
    if (log.address.toLowerCase() === factoryAddr.toLowerCase()) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === eventName) return parsed.args[0];
      } catch {}
    }
  }
  throw new Error(`${eventName} not found in logs`);
}

function statsOf(gas: bigint[]): { avg: bigint; min: bigint; max: bigint } {
  const avg = gas.reduce((a, b) => a + b, 0n) / BigInt(gas.length);
  const min = gas.reduce((a, b) => (a < b ? a : b));
  const max = gas.reduce((a, b) => (a > b ? a : b));
  return { avg, min, max };
}

// ─── ERC-20 (V1) benchmark ────────────────────────────────────────────────────

async function benchmarkERC20(
  usdc: any,
  deployer: any,
  contributors: any[],
  usdcAddr: string
): Promise<VariantStats> {
  const CONTRIB   = hre.ethers.parseUnits("10",  6);
  const softCap   = hre.ethers.parseUnits("100", 6);
  const hardCap   = hre.ethers.parseUnits("500", 6);
  const block     = await hre.ethers.provider.getBlock("latest");
  const deadline  = block!.timestamp + 30 * 86400;
  const milestones: number[] = [30, 30, 40];

  const Factory = await hre.ethers.getContractFactory("CrowdfundingFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  const createTx = await factory.createCampaign(usdcAddr, softCap, hardCap, deadline, milestones, "BT-ERC20", "BT");
  const createR  = await createTx.wait();
  const campaignAddr = parseCampaignFromLogs(createR!.logs, factoryAddr, factory.interface, "CampaignCreated");
  const campaign = await hre.ethers.getContractAt("CrowdfundingCampaign", campaignAddr);

  process.stdout.write("\n[V1 ERC-20] contributions: ");
  const contributeGas: bigint[] = [];
  for (let i = 0; i < 50; i++) {
    const signer = contributors[i];
    await usdc.mint(await signer.getAddress(), CONTRIB);
    await usdc.connect(signer).approve(campaignAddr, CONTRIB);
    const tx = await campaign.connect(signer).contribute(CONTRIB);
    const r  = await tx.wait();
    contributeGas.push(r!.gasUsed);
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
  }

  await hre.network.provider.send("evm_increaseTime", [30 * 86400 + 1]);
  await hre.network.provider.send("evm_mine", []);

  const finalizeTx = await campaign.finalize();
  const finalizeR  = await finalizeTx.wait();
  const finalizeGas = finalizeR!.gasUsed;

  const milestoneGas: bigint[] = [];
  for (let m = 0; m < milestones.length; m++) {
    const tx = await campaign.connect(deployer).withdrawMilestone();
    const r  = await tx.wait();
    milestoneGas.push(r!.gasUsed);
  }

  const { avg, min, max } = statsOf(contributeGas);
  return { name: "ERC-20 (V1)", contributeAvg: avg, contributeMin: min, contributeMax: max, finalizeGas, milestoneGas };
}

// ─── ERC-4626 (V2) benchmark ──────────────────────────────────────────────────

async function benchmarkERC4626(
  usdc: any,
  deployer: any,
  contributors: any[],
  usdcAddr: string
): Promise<VariantStats> {
  const CONTRIB   = hre.ethers.parseUnits("10",  6);
  const softCap   = hre.ethers.parseUnits("100", 6);
  const hardCap   = hre.ethers.parseUnits("500", 6);
  const block     = await hre.ethers.provider.getBlock("latest");
  const deadline  = block!.timestamp + 30 * 86400;
  const milestones: number[] = [30, 30, 40];

  const Factory = await hre.ethers.getContractFactory("CrowdfundingFactory4626");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  const createTx = await factory.createCampaign(usdcAddr, softCap, hardCap, deadline, milestones, "BT-4626", "BV");
  const createR  = await createTx.wait();
  const campaignAddr = parseCampaignFromLogs(createR!.logs, factoryAddr, factory.interface, "CampaignCreated4626");
  const campaign = await hre.ethers.getContractAt("CrowdfundingCampaign4626", campaignAddr);

  process.stdout.write("\n[V2 ERC-4626] contributions: ");
  const contributeGas: bigint[] = [];
  for (let i = 0; i < 50; i++) {
    const signer = contributors[i];
    await usdc.mint(await signer.getAddress(), CONTRIB);
    await usdc.connect(signer).approve(campaignAddr, CONTRIB);
    const tx = await campaign.connect(signer).contribute(CONTRIB);
    const r  = await tx.wait();
    contributeGas.push(r!.gasUsed);
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
  }

  await hre.network.provider.send("evm_increaseTime", [30 * 86400 + 1]);
  await hre.network.provider.send("evm_mine", []);

  const finalizeTx = await campaign.finalize();
  const finalizeR  = await finalizeTx.wait();
  const finalizeGas = finalizeR!.gasUsed;

  const milestoneGas: bigint[] = [];
  for (let m = 0; m < milestones.length; m++) {
    const tx = await campaign.connect(deployer).withdrawMilestone();
    const r  = await tx.wait();
    milestoneGas.push(r!.gasUsed);
  }

  const { avg, min, max } = statsOf(contributeGas);
  return { name: "ERC-4626 (V2)", contributeAvg: avg, contributeMin: min, contributeMax: max, finalizeGas, milestoneGas };
}

// ─── ERC-1155 (V3) benchmark ──────────────────────────────────────────────────

async function benchmarkERC1155(
  usdc: any,
  deployer: any,
  contributors: any[],
  usdcAddr: string
): Promise<VariantStats> {
  // Bronze = 10 USDC so 50 contributors fill 500 USDC > softCap (100 USDC)
  const BRONZE_PRICE = hre.ethers.parseUnits("10",  6);
  const softCap      = hre.ethers.parseUnits("100", 6);
  const hardCap      = hre.ethers.parseUnits("600", 6); // 60 × 10 (slack for 50 contributors)
  const block1155    = await hre.ethers.provider.getBlock("latest");
  const deadline     = block1155!.timestamp + 30 * 86400;
  const milestones: number[]   = [30, 30, 40];
  const tierPrices: [bigint, bigint, bigint] = [
    BRONZE_PRICE,
    hre.ethers.parseUnits("50",  6),
    hre.ethers.parseUnits("100", 6),
  ];
  const tierNames: [string, string, string] = ["Bronze", "Silver", "Gold"];

  const Factory = await hre.ethers.getContractFactory("CrowdfundingFactory1155");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  const createTx = await factory.createCampaign(
    usdcAddr, softCap, hardCap, deadline, milestones, tierPrices, tierNames, ""
  );
  const createR  = await createTx.wait();
  const campaignAddr = parseCampaignFromLogs(createR!.logs, factoryAddr, factory.interface, "CampaignCreated1155");
  const campaign = await hre.ethers.getContractAt("CrowdfundingCampaign1155", campaignAddr);

  process.stdout.write("\n[V3 ERC-1155] contributions (Bronze): ");
  const contributeGas: bigint[] = [];
  for (let i = 0; i < 50; i++) {
    const signer = contributors[i];
    await usdc.mint(await signer.getAddress(), BRONZE_PRICE);
    await usdc.connect(signer).approve(campaignAddr, BRONZE_PRICE);
    const tx = await campaign.connect(signer).contribute(0); // Bronze tier
    const r  = await tx.wait();
    contributeGas.push(r!.gasUsed);
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
  }

  await hre.network.provider.send("evm_increaseTime", [30 * 86400 + 1]);
  await hre.network.provider.send("evm_mine", []);

  const finalizeTx = await campaign.finalize();
  const finalizeR  = await finalizeTx.wait();
  const finalizeGas = finalizeR!.gasUsed;

  const milestoneGas: bigint[] = [];
  for (let m = 0; m < milestones.length; m++) {
    const tx = await campaign.connect(deployer).withdrawMilestone();
    const r  = await tx.wait();
    milestoneGas.push(r!.gasUsed);
  }

  const { avg, min, max } = statsOf(contributeGas);
  return { name: "ERC-1155 (V3)", contributeAvg: avg, contributeMin: min, contributeMax: max, finalizeGas, milestoneGas };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const signers = await hre.ethers.getSigners();
  if (signers.length < 51) {
    throw new Error("Need at least 51 signers — set accounts.count >= 51 in hardhat.config.ts");
  }

  const deployer     = signers[0];
  const contributors = signers.slice(1, 51); // 50 contributors

  console.log("Deployer:", await deployer.getAddress());

  // Shared MockERC20
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC");
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();

  const v1 = await benchmarkERC20(usdc,  deployer, contributors, usdcAddr);
  const v2 = await benchmarkERC4626(usdc, deployer, contributors, usdcAddr);
  const v3 = await benchmarkERC1155(usdc, deployer, contributors, usdcAddr);

  const variants = [v1, v2, v3];

  // ── Comparison table ──────────────────────────────────────────────────────
  const col = 18;
  const pad = (s: string) => s.padStart(col);

  console.log("\n\n─── EVM Gas Benchmark — Cross-Variant Comparison ─────────────────────────────────────────");
  console.log(`${"Function".padEnd(26)} │ ${variants.map(v => v.name.padStart(col)).join(" │ ")}`);
  console.log(`${"─".repeat(26)}─┼─${variants.map(() => "─".repeat(col)).join("─┼─")}`);

  const row = (label: string, fn: (v: VariantStats) => bigint) =>
    console.log(`${label.padEnd(26)} │ ${variants.map(v => pad(fn(v).toLocaleString())).join(" │ ")}`);

  row("contribute() avg (gas)",  v => v.contributeAvg);
  row("contribute() min (gas)",  v => v.contributeMin);
  row("contribute() max (gas)",  v => v.contributeMax);
  row("finalize()   (gas)",      v => v.finalizeGas);

  for (let m = 0; m < 3; m++) {
    row(`withdrawMilestone(${m}) (gas)`, v => v.milestoneGas[m] ?? 0n);
  }

  console.log(`${"─".repeat(26)}─┴─${variants.map(() => "─".repeat(col)).join("─┴─")}`);
  console.log("Contributors: 50 per variant | 10 USDC Bronze each (V3)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
