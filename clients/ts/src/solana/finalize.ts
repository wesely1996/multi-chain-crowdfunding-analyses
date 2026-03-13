import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  connection,
  wallet,
  program,
  sendAndConfirmTx,
  SOLANA_CAMPAIGN_ADDRESS,
  SOLANA_CAMPAIGN_ID,
} from "./config.js";
import { campaignPda } from "./pda.js";
import { printResult, printError } from "../shared/output.js";

const { values } = parseArgs({
  options: {
    campaign: { type: "string" },
  },
  strict: false,
});

async function main() {
  let campaignAddr: PublicKey;
  if (values["campaign"]) {
    campaignAddr = new PublicKey(values["campaign"]);
  } else if (SOLANA_CAMPAIGN_ADDRESS) {
    campaignAddr = new PublicKey(SOLANA_CAMPAIGN_ADDRESS);
  } else {
    campaignAddr = campaignPda(wallet.publicKey, new BN(Number(SOLANA_CAMPAIGN_ID)));
  }

  const start = performance.now();

  const sig = await sendAndConfirmTx(
    program.methods
      .finalize()
      .accounts({
        caller: wallet.publicKey,
        campaign: campaignAddr,
      } as any)
      .signers([wallet]),
  );

  const elapsed = performance.now() - start;

  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  // Read updated campaign state
  const campaignAccount = await (program.account as any).campaign.fetch(campaignAddr);

  printResult({
    chain: "solana",
    operation: "finalize",
    txHash: sig,
    blockNumber: tx?.slot ?? null,
    gasUsed: tx?.meta?.fee ?? null,
    status: tx?.meta?.err ? "reverted" : "success",
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(elapsed),
    data: {
      successful: campaignAccount.successful,
      totalRaised: campaignAccount.totalRaised.toString(),
      campaignAddress: campaignAddr.toBase58(),
    },
  });
}

main().catch((err) => printError("finalize", err, "solana"));
