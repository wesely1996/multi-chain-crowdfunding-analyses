use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// WHY: placeholder ID — replaced by `anchor keys sync` after first build.
// Run `anchor keys list` and update both this macro and Anchor.toml [programs.localnet].
declare_id!("AtaYCBbNJJwwwckTouZ2G4ZgrzPNT2JtZF1yL7zUxQpC");

#[program]
pub mod crowdfunding_token2022 {
    use super::*;

    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        campaign_id: u64,
        soft_cap: u64,
        hard_cap: u64,
        deadline: i64,
        milestones: Vec<u8>,
    ) -> Result<()> {
        instructions::initialize_campaign::handler(ctx, campaign_id, soft_cap, hard_cap, deadline, milestones)
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::contribute::handler(ctx, amount)
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        instructions::finalize::handler(ctx)
    }

    pub fn withdraw_milestone(ctx: Context<WithdrawMilestone>) -> Result<()> {
        instructions::withdraw_milestone::handler(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handler(ctx)
    }
}
