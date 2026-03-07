use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::CrowdfundingError;
use crate::state::Campaign;

#[derive(Accounts)]
pub struct WithdrawMilestone<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
        token::mint = campaign.payment_mint,
        token::authority = campaign,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = campaign.payment_mint,
        token::authority = creator,
    )]
    pub creator_payment_ata: Account<'info, TokenAccount>,

    #[account(address = campaign.payment_mint)]
    pub payment_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawMilestone>) -> Result<()> {
    let campaign = &ctx.accounts.campaign;

    require!(
        campaign.finalized && campaign.successful,
        CrowdfundingError::NotSuccessful
    );
    require!(
        campaign.current_milestone < campaign.milestone_count,
        CrowdfundingError::AllMilestonesWithdrawn
    );

    let idx = campaign.current_milestone as usize;
    let is_last = idx == (campaign.milestone_count - 1) as usize;

    // Last milestone: sweep the full vault balance to avoid dust from integer division.
    let amount = if is_last {
        ctx.accounts.vault.amount
    } else {
        let pct = campaign.milestones[idx] as u64;
        campaign
            .total_raised
            .checked_mul(pct)
            .ok_or(CrowdfundingError::Overflow)?
            .checked_div(100)
            .ok_or(CrowdfundingError::Overflow)?
    };

    // Save values needed for PDA signer seeds.
    let creator_key = campaign.creator;
    let campaign_id_bytes = campaign.campaign_id.to_le_bytes();
    let bump = campaign.bump;

    // --- Effects (CEI): update state before CPI ---
    let campaign = &mut ctx.accounts.campaign;
    campaign.total_withdrawn = campaign
        .total_withdrawn
        .checked_add(amount)
        .ok_or(CrowdfundingError::Overflow)?;
    campaign.current_milestone += 1;

    // --- Interaction: CPI transfer from vault to creator ---
    let seeds: &[&[u8]] = &[
        b"campaign",
        creator_key.as_ref(),
        campaign_id_bytes.as_ref(),
        &[bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.creator_payment_ata.to_account_info(),
                authority: ctx.accounts.campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    Ok(())
}
