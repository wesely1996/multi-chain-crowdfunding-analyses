import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { programId, SOLANA_CAMPAIGN_ADDRESS, SOLANA_CAMPAIGN_ID } from "./config.js";

export function campaignPda(creator: PublicKey, campaignId: BN): PublicKey {
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

/**
 * Resolve campaign address from: explicit arg > SOLANA_CAMPAIGN_ADDRESS env > PDA derivation.
 */
export function resolveCampaign(explicit: string | undefined, walletPubkey: PublicKey): PublicKey {
  if (explicit) return new PublicKey(explicit);
  if (SOLANA_CAMPAIGN_ADDRESS) return new PublicKey(SOLANA_CAMPAIGN_ADDRESS);
  return campaignPda(walletPubkey, new BN(Number(SOLANA_CAMPAIGN_ID)));
}
