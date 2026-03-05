use anchor_lang::prelude::*;

// WHY: placeholder ID — replaced by `anchor build` on first compile.
// Run `anchor keys list` after build to get the real program ID,
// then update both this macro and Anchor.toml [programs.localnet].
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod crowdfunding {
    use super::*;

    // TODO: implement create_campaign, fund, finalize, claim_refund, release_milestone
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

/// Placeholder context — will be replaced by real instruction contexts.
#[derive(Accounts)]
pub struct Initialize {}
