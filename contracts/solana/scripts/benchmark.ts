/**
 * Solana Crowdfunding Benchmark
 *
 * Mirrors the EVM benchmark (contracts/evm/scripts/benchmark.ts) for the
 * cross-chain comparison in docs/measurements.md.
 *
 * Measurements collected:
 *   - contribute()       : fee (lamports), confirmation time (ms)  — N=50 sequential
 *   - finalize()         : fee (lamports), confirmation time (ms)
 *   - withdrawMilestone(): fee (lamports), confirmation time (ms)  — 3 milestones
 *   - Throughput         : total time for 50 contributions, TPS
 *
 * Run against a live localnet:
 *   solana-test-validator --reset &
 *   sleep 5
 *   anchor build && anchor deploy
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node -P tsconfig.json scripts/benchmark.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

// ─── Config ────────────────────────────────────────────────────────────────────

const N = 50;                     // contributors (matches EVM benchmark)
const AMOUNT_PER_CONTRIB = 1_000_000; // 1 token (6 decimals) per contributor
// softCap = 1 token, hardCap = 100 tokens → campaign succeeds after N contributions
const SOFT_CAP  = new anchor.BN(1_000_000);
const HARD_CAP  = new anchor.BN(100_000_000);
const MILESTONES = Buffer.from([30, 30, 40]); // matches EVM benchmark

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pdaOf(seeds: Buffer[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

interface Stats { avg: number; min: number; max: number }
function stats(arr: number[]): Stats {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { avg, min: Math.min(...arr), max: Math.max(...arr) };
}

function printRow(label: string, fees: number[], times: number[]) {
  const f = stats(fees);
  const t = stats(times);
  console.log(
    `  ${label.padEnd(24)}` +
    `  fee avg/min/max (lamports): ${f.avg.toFixed(0).padStart(6)} / ${f.min} / ${f.max}` +
    `   time avg/min/max (ms): ${t.avg.toFixed(0).padStart(5)} / ${t.min} / ${t.max}`
  );
}

/** Send a transaction and return { fee, elapsedMs }. */
async function timed(
  connection: anchor.web3.Connection,
  fn: () => Promise<string>
): Promise<{ fee: number; elapsedMs: number }> {
  const t0 = Date.now();
  const sig = await fn();
  const elapsedMs = Date.now() - t0;
  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const fee = tx?.meta?.fee ?? 0;
  return { fee, elapsedMs };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const connection = provider.connection;
  const payer: Keypair = (provider.wallet as any).payer;

  console.log("=".repeat(72));
  console.log("Solana Crowdfunding Benchmark");
  console.log(`Network : ${connection.rpcEndpoint}`);
  console.log(`N       : ${N} sequential contributions`);
  console.log("=".repeat(72));

  // ─── Phase 1: mint + fund contributors ──────────────────────────────────────

  process.stdout.write("Setting up payment mint and contributors... ");
  const paymentMint = await createMint(
    connection, payer, payer.publicKey, null, 6
  );

  const creator = Keypair.generate();
  const contributors = Array.from({ length: N }, () => Keypair.generate());

  await connection.requestAirdrop(creator.publicKey, 5_000_000_000);
  for (const c of contributors) {
    await connection.requestAirdrop(c.publicKey, 2_000_000_000);
  }
  await sleep(3000); // wait for all airdrops to land

  // Pre-create all contributor payment ATAs and mint tokens.
  // Addresses stored so the timed loop makes zero setup RPC calls.
  const paymentAtaAddresses: PublicKey[] = [];
  for (const c of contributors) {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection, payer, paymentMint, c.publicKey
    );
    await mintTo(connection, payer, paymentMint, ata.address, payer, AMOUNT_PER_CONTRIB);
    paymentAtaAddresses.push(ata.address);
  }
  await sleep(1000);
  console.log("done");

  // ─── Phase 2: create contribution-benchmark campaign ────────────────────────
  // Use a deadline 5 minutes out so it never expires during the contribution loop.

  const campaignId = new anchor.BN(Date.now() & 0xffffffff);
  const campaignPda     = pdaOf([Buffer.from("campaign"), creator.publicKey.toBuffer(), campaignId.toArrayLike(Buffer, "le", 8)], program.programId);
  const vaultPda        = pdaOf([Buffer.from("vault"),         campaignPda.toBuffer()], program.programId);
  const receiptMintPda  = pdaOf([Buffer.from("receipt_mint"),  campaignPda.toBuffer()], program.programId);

  const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 300);

  await program.methods
    .initializeCampaign(campaignId, SOFT_CAP, HARD_CAP, deadline, MILESTONES)
    .accounts({
      creator: creator.publicKey,
      // campaign is auto-resolved by Anchor from (creator, campaign_id) seeds
      paymentMint,
      vault: vaultPda,
      receiptMint: receiptMintPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([creator])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  console.log(`Campaign : ${campaignPda.toBase58()}`);

  // Pre-create receipt ATAs for all contributors now that the receipt mint exists.
  process.stdout.write("Pre-creating receipt ATAs... ");
  const receiptAtaAddresses: PublicKey[] = [];
  for (const c of contributors) {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection, payer, receiptMintPda, c.publicKey
    );
    receiptAtaAddresses.push(ata.address);
  }
  console.log("done");

  // ─── Phase 3: 50 sequential contributions ───────────────────────────────────

  console.log(`\nRunning ${N} sequential contribute() calls...`);
  const contribFees:  number[] = [];
  const contribTimes: number[] = [];
  const totalStart = Date.now();

  for (let i = 0; i < N; i++) {
    const c = contributors[i];

    // No setup RPC calls here — addresses were pre-computed in Phase 1 & 2.
    const { fee, elapsedMs } = await timed(connection, () =>
      program.methods
        .contribute(new anchor.BN(AMOUNT_PER_CONTRIB))
        .accounts({
          contributor: c.publicKey,
          campaign: campaignPda,
          // contributorRecord auto-resolved from (campaign, contributor) seeds
          contributorPaymentAta: paymentAtaAddresses[i],
          vault: vaultPda,
          contributorReceiptAta: receiptAtaAddresses[i],
          receiptMint: receiptMintPda,
          paymentMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([c])
        .rpc({ commitment: "confirmed", skipPreflight: true })
    );

    contribFees.push(fee);
    contribTimes.push(elapsedMs);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${N}`);
  }

  const totalMs = Date.now() - totalStart;
  const tps     = N / (totalMs / 1000);

  // ─── Phase 4: finalize benchmark ────────────────────────────────────────────
  // Create a separate small campaign with a 5-second deadline so we don't have
  // to wait 5 minutes for the contribution campaign to expire.

  console.log("\nSetting up finalize / withdraw benchmark campaign (5-second deadline)...");
  const fCampaignId    = new anchor.BN((Date.now() & 0xffffffff) + 1);
  const fCampaignPda   = pdaOf([Buffer.from("campaign"), creator.publicKey.toBuffer(), fCampaignId.toArrayLike(Buffer, "le", 8)], program.programId);
  const fVaultPda      = pdaOf([Buffer.from("vault"),        fCampaignPda.toBuffer()], program.programId);
  const fReceiptMintPda = pdaOf([Buffer.from("receipt_mint"), fCampaignPda.toBuffer()], program.programId);

  const fDeadline = new anchor.BN(Math.floor(Date.now() / 1000) + 5);

  await program.methods
    .initializeCampaign(fCampaignId, SOFT_CAP, HARD_CAP, fDeadline, MILESTONES)
    .accounts({
      creator: creator.publicKey,
      // campaign auto-resolved from (creator, campaign_id) seeds
      paymentMint,
      vault: fVaultPda,
      receiptMint: fReceiptMintPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([creator])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  // One contribution so softCap is met (successful path for withdrawMilestone).
  // contributor[0]'s payment ATA address is already in paymentAtaAddresses[0].
  const fc = contributors[0];
  // Re-mint 1 token to contributor[0] after earlier contribution drained it.
  await mintTo(connection, payer, paymentMint, paymentAtaAddresses[0], payer, AMOUNT_PER_CONTRIB);
  const fReceiptAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, fReceiptMintPda, fc.publicKey
  );

  await program.methods
    .contribute(new anchor.BN(AMOUNT_PER_CONTRIB))
    .accounts({
      contributor: fc.publicKey,
      campaign: fCampaignPda,
      // contributorRecord auto-resolved from (campaign, contributor) seeds
      contributorPaymentAta: paymentAtaAddresses[0],
      vault: fVaultPda,
      contributorReceiptAta: fReceiptAta.address,
      receiptMint: fReceiptMintPda,
      paymentMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([fc])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  // Wait for 5-second deadline.
  await sleep(6000);

  const { fee: finalizeFee, elapsedMs: finalizeTime } = await timed(connection, () =>
    program.methods
      .finalize()
      .accounts({ caller: payer.publicKey, campaign: fCampaignPda })
      .rpc({ commitment: "confirmed", skipPreflight: true })
  );

  // ─── Phase 5: withdrawMilestone × 3 ─────────────────────────────────────────

  const creatorPaymentAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, paymentMint, creator.publicKey
  );

  const withdrawFees:  number[] = [];
  const withdrawTimes: number[] = [];

  for (let m = 0; m < 3; m++) {
    const { fee, elapsedMs } = await timed(connection, () =>
      program.methods
        .withdrawMilestone()
        .accounts({
          creator: creator.publicKey,
          campaign: fCampaignPda,
          vault: fVaultPda,
          creatorPaymentAta: creatorPaymentAta.address,
          paymentMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc({ commitment: "confirmed", skipPreflight: true })
    );
    withdrawFees.push(fee);
    withdrawTimes.push(elapsedMs);
  }

  // ─── Results ────────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(72));
  console.log("Results");
  console.log("=".repeat(72));

  printRow("contribute() [N=50]", contribFees, contribTimes);
  printRow("finalize()", [finalizeFee], [finalizeTime]);
  withdrawFees.forEach((f, i) =>
    printRow(`withdrawMilestone[${i}]`, [f], [withdrawTimes[i]])
  );

  console.log();
  console.log(`  Throughput : ${N} contributions in ${totalMs} ms → ${tps.toFixed(2)} TPS`);
  console.log();

  const feeS = stats(contribFees);
  console.log("Fee note: Solana base fee = 5 000 lamports / signature (flat).");
  console.log(`  ${(feeS.avg / 1e9).toFixed(9)} SOL avg per contribute().`);
  console.log("  (No gas-price equivalent; priority fees not set in this benchmark.)");
  console.log("=".repeat(72));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
