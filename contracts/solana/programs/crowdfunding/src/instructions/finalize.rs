use anchor_lang::prelude::*;

use crate::errors::CrowdfundingError;
use crate::state::Campaign;

#[derive(Accounts)]
pub struct Finalize<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
}

pub fn handler(ctx: Context<Finalize>) -> Result<()> {
    let campaign = &mut ctx.accounts.campaign;
    require!(!campaign.finalized, CrowdfundingError::AlreadyFinalized);
    let now = Clock::get()?.unix_timestamp;
    require!(now > campaign.deadline, CrowdfundingError::DeadlineNotPassed);
    campaign.finalized = true;
    campaign.successful = campaign.total_raised >= campaign.soft_cap;
    Ok(())
}
