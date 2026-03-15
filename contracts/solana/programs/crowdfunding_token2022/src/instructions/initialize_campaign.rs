use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::CrowdfundingError;
use crate::state::Campaign;

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct InitializeCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 256,
        seeds = [b"campaign", creator.key().as_ref(), &campaign_id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    pub payment_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = campaign,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [b"receipt_mint", campaign.key().as_ref()],
        bump,
        mint::decimals = payment_mint.decimals,
        mint::authority = campaign,
        mint::token_program = token_program,
    )]
    pub receipt_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeCampaign>,
    campaign_id: u64,
    soft_cap: u64,
    hard_cap: u64,
    deadline: i64,
    milestones: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(deadline > now, CrowdfundingError::DeadlineInPast);
    require!(soft_cap > 0 && soft_cap <= hard_cap, CrowdfundingError::InvalidCaps);
    require!(
        !milestones.is_empty() && milestones.len() <= 10,
        CrowdfundingError::InvalidMilestones
    );
    let sum: u16 = milestones.iter().map(|&x| x as u16).sum();
    require!(sum == 100, CrowdfundingError::InvalidMilestones);

    let campaign = &mut ctx.accounts.campaign;
    campaign.creator = ctx.accounts.creator.key();
    campaign.payment_mint = ctx.accounts.payment_mint.key();
    campaign.receipt_mint = ctx.accounts.receipt_mint.key();
    campaign.soft_cap = soft_cap;
    campaign.hard_cap = hard_cap;
    campaign.deadline = deadline;
    campaign.total_raised = 0;
    campaign.finalized = false;
    campaign.successful = false;
    campaign.current_milestone = 0;
    campaign.total_withdrawn = 0;
    campaign.milestone_count = milestones.len() as u8;

    let mut m = [0u8; 10];
    m[..milestones.len()].copy_from_slice(&milestones);
    campaign.milestones = m;

    campaign.campaign_id = campaign_id;
    campaign.bump = ctx.bumps.campaign;
    campaign.vault_bump = ctx.bumps.vault;
    campaign.receipt_mint_bump = ctx.bumps.receipt_mint;

    Ok(())
}
