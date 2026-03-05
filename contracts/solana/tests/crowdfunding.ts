import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { expect } from "chai";

describe("crowdfunding", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;

  it("initialize placeholder succeeds", async () => {
    // WHY: smoke test to confirm the program deploys and the RPC round-trip works.
    // Real instruction tests will be added in the next milestone.
    const tx = await program.methods.initialize().rpc();
    expect(tx).to.be.a("string");
    console.log("Transaction signature:", tx);
  });
});
