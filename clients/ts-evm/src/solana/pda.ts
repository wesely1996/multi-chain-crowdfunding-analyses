import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { programId } from "./config.js";

export function campaignPda(creator: PublicKey, campaignId: anchor.BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), creator.toBuffer(), campaignId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  return pda;
}

export function vaultPda(campaign: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), campaign.toBuffer()],
    programId,
  );
  return pda;
}

export function receiptMintPda(campaign: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt_mint"), campaign.toBuffer()],
    programId,
  );
  return pda;
}

export function contributorRecordPda(campaign: PublicKey, contributor: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("contributor"), campaign.toBuffer(), contributor.toBuffer()],
    programId,
  );
  return pda;
}
