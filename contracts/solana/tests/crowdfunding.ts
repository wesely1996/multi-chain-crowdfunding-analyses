import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { expect } from "chai";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("crowdfunding", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const connection = provider.connection;
  // NodeWallet exposes .payer; cast to any to avoid type noise.
  const payer: Keypair = (provider.wallet as any).payer;

  // ─── PDA helpers ───────────────────────────────────────────────────────────

  function findCampaignPda(creator: PublicKey, campaignId: anchor.BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        creator.toBuffer(),
        campaignId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    return pda;
  }

  function findVaultPda(campaign: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaign.toBuffer()],
      program.programId
    );
    return pda;
  }

  function findReceiptMintPda(campaign: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt_mint"), campaign.toBuffer()],
      program.programId
    );
    return pda;
  }

  function findContributorRecordPda(
    campaign: PublicKey,
    contributor: PublicKey
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("contributor"),
        campaign.toBuffer(),
        contributor.toBuffer(),
      ],
      program.programId
    );
    return pda;
  }

  // ─── Shared keypairs and state ─────────────────────────────────────────────

  const creator = Keypair.generate();
  const contributor = Keypair.generate();
  let paymentMint: PublicKey;

  // Campaign IDs (one per campaign so PDAs don't collide).
  const ID_SUCCESS = new anchor.BN(1);   // 60-second deadline; used in tests 1–4, 9
  const ID_EXPIRED = new anchor.BN(3);   // 2-second deadline; test 3 only
  const ID_SHORT_SUCCESS = new anchor.BN(10); // 2-second deadline; tests 5, 7
  const ID_FAIL = new anchor.BN(2);      // 2-second deadline; tests 6, 8

  let successCampaign: PublicKey;
  let shortSuccessCampaign: PublicKey;
  let failCampaign: PublicKey;
  let expiredCampaign: PublicKey;

  // ─── before hook ───────────────────────────────────────────────────────────

  before(async () => {
    // Fund creator, contributor, and wallet (payer) on localnet.
    await Promise.all([
      connection.requestAirdrop(creator.publicKey, 10e9),
      connection.requestAirdrop(contributor.publicKey, 10e9),
    ]);
    await sleep(2000);

    // Create 6-decimal payment mint (USDC-like).
    paymentMint = await createMint(
      connection,
      payer,
      payer.publicKey, // mintAuthority
      null,            // freezeAuthority
      6
    );

    // Mint 1 000 tokens (1e9 units) to contributor.
    const contributorPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    await mintTo(
      connection,
      payer,
      paymentMint,
      contributorPaymentAta.address,
      payer,
      1_000_000_000
    );
    await sleep(1000);
  });

  // ─── Test 1: initialize_campaign ──────────────────────────────────────────

  it("1. initialize_campaign with valid params creates campaign account", async () => {
    const now = Math.floor(Date.now() / 1000);
    successCampaign = findCampaignPda(creator.publicKey, ID_SUCCESS);
    const vault = findVaultPda(successCampaign);
    const receiptMint = findReceiptMintPda(successCampaign);

    await program.methods
      .initializeCampaign(
        ID_SUCCESS,
        new anchor.BN(100_000_000), // softCap = 100 tokens
        new anchor.BN(500_000_000), // hardCap = 500 tokens
        new anchor.BN(now + 60),    // 60-second deadline
        Buffer.from([30, 30, 40])
      )
      .accounts({
        creator: creator.publicKey,
        campaign: successCampaign,
        paymentMint,
        vault,
        receiptMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    const account = await program.account.campaign.fetch(successCampaign);
    expect(account.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(account.softCap.toNumber()).to.equal(100_000_000);
    expect(account.hardCap.toNumber()).to.equal(500_000_000);
    expect(account.milestoneCount).to.equal(3);
    expect(account.finalized).to.equal(false);
    expect(account.totalRaised.toNumber()).to.equal(0);
  });

  // ─── Test 2: contribute valid amount ──────────────────────────────────────

  it("2. contribute increases vault balance and mints receipt tokens", async () => {
    const vault = findVaultPda(successCampaign);
    const receiptMint = findReceiptMintPda(successCampaign);
    const contributorRecord = findContributorRecordPda(
      successCampaign,
      contributor.publicKey
    );

    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      receiptMint,
      contributor.publicKey
    );

    const amount = new anchor.BN(200_000_000); // 200 tokens — exceeds softCap

    await program.methods
      .contribute(amount)
      .accounts({
        contributor: contributor.publicKey,
        campaign: successCampaign,
        contributorRecord,
        contributorPaymentAta: contribPaymentAta.address,
        vault,
        contributorReceiptAta: contribReceiptAta.address,
        receiptMint,
        paymentMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([contributor])
      .rpc();

    const vaultInfo = await getAccount(connection, vault);
    expect(Number(vaultInfo.amount)).to.equal(200_000_000);

    const receiptInfo = await getAccount(connection, contribReceiptAta.address);
    expect(Number(receiptInfo.amount)).to.equal(200_000_000);

    const record = await program.account.contributorRecord.fetch(contributorRecord);
    expect(record.amount.toNumber()).to.equal(200_000_000);
  });

  // ─── Test 3: contribute after deadline → DeadlinePassed ───────────────────

  it("3. contribute after deadline fails with DeadlinePassed", async () => {
    const now = Math.floor(Date.now() / 1000);
    expiredCampaign = findCampaignPda(creator.publicKey, ID_EXPIRED);
    const vault = findVaultPda(expiredCampaign);
    const receiptMint = findReceiptMintPda(expiredCampaign);

    await program.methods
      .initializeCampaign(
        ID_EXPIRED,
        new anchor.BN(100_000_000),
        new anchor.BN(500_000_000),
        new anchor.BN(now + 2), // 2-second deadline
        Buffer.from([100])
      )
      .accounts({
        creator: creator.publicKey,
        campaign: expiredCampaign,
        paymentMint,
        vault,
        receiptMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    // Wait for deadline to pass.
    await sleep(3000);

    const contributorRecord = findContributorRecordPda(
      expiredCampaign,
      contributor.publicKey
    );
    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = getAssociatedTokenAddressSync(
      receiptMint,
      contributor.publicKey
    );

    try {
      await program.methods
        .contribute(new anchor.BN(1_000_000))
        .accounts({
          contributor: contributor.publicKey,
          campaign: expiredCampaign,
          contributorRecord,
          contributorPaymentAta: contribPaymentAta.address,
          vault,
          contributorReceiptAta: contribReceiptAta,
          receiptMint,
          paymentMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([contributor])
        .rpc();
      expect.fail("Expected DeadlinePassed error");
    } catch (err: any) {
      expect(err.toString()).to.include("DeadlinePassed");
    }
  });

  // ─── Test 4: contribute exceeding hardCap → HardCapExceeded ──────────────

  it("4. contribute exceeding hardCap fails with HardCapExceeded", async () => {
    // successCampaign: total_raised = 200M, hardCap = 500M.
    // Contributing 400M would push it to 600M > 500M.
    const vault = findVaultPda(successCampaign);
    const receiptMint = findReceiptMintPda(successCampaign);
    const contributorRecord = findContributorRecordPda(
      successCampaign,
      contributor.publicKey
    );

    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = getAssociatedTokenAddressSync(
      receiptMint,
      contributor.publicKey
    );

    try {
      await program.methods
        .contribute(new anchor.BN(400_000_000))
        .accounts({
          contributor: contributor.publicKey,
          campaign: successCampaign,
          contributorRecord,
          contributorPaymentAta: contribPaymentAta.address,
          vault,
          contributorReceiptAta: contribReceiptAta,
          receiptMint,
          paymentMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([contributor])
        .rpc();
      expect.fail("Expected HardCapExceeded error");
    } catch (err: any) {
      expect(err.toString()).to.include("HardCapExceeded");
    }
  });

  // ─── Test 5: finalize when total >= softCap → successful = true ──────────

  it("5. finalize sets successful = true when total_raised >= softCap", async () => {
    const now = Math.floor(Date.now() / 1000);
    shortSuccessCampaign = findCampaignPda(creator.publicKey, ID_SHORT_SUCCESS);
    const vault = findVaultPda(shortSuccessCampaign);
    const receiptMint = findReceiptMintPda(shortSuccessCampaign);

    await program.methods
      .initializeCampaign(
        ID_SHORT_SUCCESS,
        new anchor.BN(100_000_000),
        new anchor.BN(500_000_000),
        new anchor.BN(now + 2), // 2-second deadline
        Buffer.from([100])      // single milestone — full sweep
      )
      .accounts({
        creator: creator.publicKey,
        campaign: shortSuccessCampaign,
        paymentMint,
        vault,
        receiptMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    // Contribute 200 tokens (above softCap).
    const contribRecord = findContributorRecordPda(
      shortSuccessCampaign,
      contributor.publicKey
    );
    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      receiptMint,
      contributor.publicKey
    );

    await program.methods
      .contribute(new anchor.BN(200_000_000))
      .accounts({
        contributor: contributor.publicKey,
        campaign: shortSuccessCampaign,
        contributorRecord: contribRecord,
        contributorPaymentAta: contribPaymentAta.address,
        vault,
        contributorReceiptAta: contribReceiptAta.address,
        receiptMint,
        paymentMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([contributor])
      .rpc();

    // Wait for deadline.
    await sleep(3000);

    await program.methods
      .finalize()
      .accounts({
        caller: payer.publicKey,
        campaign: shortSuccessCampaign,
      })
      .rpc();

    const account = await program.account.campaign.fetch(shortSuccessCampaign);
    expect(account.finalized).to.equal(true);
    expect(account.successful).to.equal(true);
  });

  // ─── Test 6: finalize when total < softCap → successful = false ──────────

  it("6. finalize sets successful = false when total_raised < softCap", async () => {
    const now = Math.floor(Date.now() / 1000);
    failCampaign = findCampaignPda(creator.publicKey, ID_FAIL);
    const vault = findVaultPda(failCampaign);
    const receiptMint = findReceiptMintPda(failCampaign);

    await program.methods
      .initializeCampaign(
        ID_FAIL,
        new anchor.BN(100_000_000),
        new anchor.BN(500_000_000),
        new anchor.BN(now + 2), // 2-second deadline
        Buffer.from([100])
      )
      .accounts({
        creator: creator.publicKey,
        campaign: failCampaign,
        paymentMint,
        vault,
        receiptMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    // Contribute 50 tokens — below softCap of 100.
    const contribRecord = findContributorRecordPda(
      failCampaign,
      contributor.publicKey
    );
    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      receiptMint,
      contributor.publicKey
    );

    await program.methods
      .contribute(new anchor.BN(50_000_000))
      .accounts({
        contributor: contributor.publicKey,
        campaign: failCampaign,
        contributorRecord: contribRecord,
        contributorPaymentAta: contribPaymentAta.address,
        vault,
        contributorReceiptAta: contribReceiptAta.address,
        receiptMint,
        paymentMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([contributor])
      .rpc();

    // Wait for deadline.
    await sleep(3000);

    await program.methods
      .finalize()
      .accounts({
        caller: payer.publicKey,
        campaign: failCampaign,
      })
      .rpc();

    const account = await program.account.campaign.fetch(failCampaign);
    expect(account.finalized).to.equal(true);
    expect(account.successful).to.equal(false);
  });

  // ─── Test 7: withdraw_milestone after success ──────────────────────────────

  it("7. withdraw_milestone transfers tokens to creator and advances milestone", async () => {
    const vault = findVaultPda(shortSuccessCampaign);

    const creatorPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      creator.publicKey
    );

    const vaultBefore = await getAccount(connection, vault);
    const creatorBefore = await getAccount(connection, creatorPaymentAta.address);

    await program.methods
      .withdrawMilestone()
      .accounts({
        creator: creator.publicKey,
        campaign: shortSuccessCampaign,
        vault,
        creatorPaymentAta: creatorPaymentAta.address,
        paymentMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    const vaultAfter = await getAccount(connection, vault);
    const creatorAfter = await getAccount(connection, creatorPaymentAta.address);

    // Single milestone [100] → full vault sweep.
    expect(Number(vaultAfter.amount)).to.equal(0);
    expect(Number(creatorAfter.amount) - Number(creatorBefore.amount)).to.equal(
      Number(vaultBefore.amount)
    );

    const account = await program.account.campaign.fetch(shortSuccessCampaign);
    expect(account.currentMilestone).to.equal(1);
  });

  // ─── Test 8: refund after fail ─────────────────────────────────────────────

  it("8. refund returns payment tokens and burns receipt tokens", async () => {
    const vault = findVaultPda(failCampaign);
    const receiptMint = findReceiptMintPda(failCampaign);
    const contributorRecord = findContributorRecordPda(
      failCampaign,
      contributor.publicKey
    );

    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      receiptMint,
      contributor.publicKey
    );

    const paymentBefore = await getAccount(connection, contribPaymentAta.address);
    const receiptBefore = await getAccount(connection, contribReceiptAta.address);
    expect(Number(receiptBefore.amount)).to.equal(50_000_000); // sanity

    await program.methods
      .refund()
      .accounts({
        contributor: contributor.publicKey,
        campaign: failCampaign,
        contributorRecord,
        contributorPaymentAta: contribPaymentAta.address,
        contributorReceiptAta: contribReceiptAta.address,
        vault,
        receiptMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor])
      .rpc();

    const paymentAfter = await getAccount(connection, contribPaymentAta.address);
    const receiptAfter = await getAccount(connection, contribReceiptAta.address);

    expect(
      Number(paymentAfter.amount) - Number(paymentBefore.amount)
    ).to.equal(50_000_000);
    expect(Number(receiptAfter.amount)).to.equal(0);
  });

  // ─── Test 9: refund on successful campaign → NotFailed ────────────────────

  it("9. refund on a successful campaign fails with NotFailed", async () => {
    const vault = findVaultPda(shortSuccessCampaign);
    const receiptMint = findReceiptMintPda(shortSuccessCampaign);
    const contributorRecord = findContributorRecordPda(
      shortSuccessCampaign,
      contributor.publicKey
    );

    const contribPaymentAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      paymentMint,
      contributor.publicKey
    );
    const contribReceiptAta = getAssociatedTokenAddressSync(
      receiptMint,
      contributor.publicKey
    );

    try {
      await program.methods
        .refund()
        .accounts({
          contributor: contributor.publicKey,
          campaign: shortSuccessCampaign,
          contributorRecord,
          contributorPaymentAta: contribPaymentAta.address,
          contributorReceiptAta: contribReceiptAta,
          vault,
          receiptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([contributor])
        .rpc();
      expect.fail("Expected NotFailed error");
    } catch (err: any) {
      expect(err.toString()).to.include("NotFailed");
    }
  });
});
