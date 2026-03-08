import { parseArgs } from "node:util";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  connection,
  wallet,
  program,
  paymentMint,
  SOLANA_CAMPAIGN_ADDRESS,
  SOLANA_CAMPAIGN_ID,
  DECIMALS,
} from "./config.js";
import { campaignPda, vaultPda, receiptMintPda } from "./pda.js";
import { printResult, printError } from "../output.js";

const { values } = parseArgs({
  options: {
    amount: { type: "string", default: "10" },
    campaign: { type: "string" },
  },
  strict: false,
});

async function main() {
  const amountRaw = new anchor.BN(Math.round(Number(values["amount"]!) * 10 ** DECIMALS));

  let campaignAddr: PublicKey;
  if (values["campaign"]) {
    campaignAddr = new PublicKey(values["campaign"]);
  } else if (SOLANA_CAMPAIGN_ADDRESS) {
    campaignAddr = new PublicKey(SOLANA_CAMPAIGN_ADDRESS);
  } else {
    campaignAddr = campaignPda(wallet.publicKey, new anchor.BN(Number(SOLANA_CAMPAIGN_ID)));
  }

  const vault = vaultPda(campaignAddr);
  const receiptMint = receiptMintPda(campaignAddr);
  const contributorPaymentAta = getAssociatedTokenAddressSync(paymentMint, wallet.publicKey);
  const contributorReceiptAta = getAssociatedTokenAddressSync(receiptMint, wallet.publicKey);

  const start = performance.now();

  const sig = await program.methods
    .contribute(amountRaw)
    .accounts({
      contributor: wallet.publicKey,
      campaign: campaignAddr,
      contributorPaymentAta,
      vault,
      contributorReceiptAta,
      receiptMint,
      paymentMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .signers([wallet])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  const elapsed = performance.now() - start;

  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  printResult({
    chain: "solana",
    operation: "contribute",
    txHash: sig,
    blockNumber: tx?.slot ?? null,
    gasUsed: tx?.meta?.fee ?? null,
    status: tx?.meta?.err ? "reverted" : "success",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      amount: amountRaw.toString(),
      campaignAddress: campaignAddr.toBase58(),
    },
  });
}

main().catch((err) => printError("contribute", err));
