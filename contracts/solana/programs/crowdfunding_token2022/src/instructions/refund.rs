use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Burn, Token2022, Transfer};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::CrowdfundingError;
use crate::state::{Campaign, ContributorRecord};

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"contributor", campaign.key().as_ref(), contributor.key().as_ref()],
        bump = contributor_record.bump,
        close = contributor,
    )]
    pub contributor_record: Account<'info, ContributorRecord>,

    #[account(
        mut,
        token::mint = campaign.payment_mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_payment_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = campaign.receipt_mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_receipt_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
        token::mint = campaign.payment_mint,
        token::authority = campaign,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"receipt_mint", campaign.key().as_ref()],
        bump = campaign.receipt_mint_bump,
        mint::token_program = token_program,
    )]
    pub receipt_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Refund>) -> Result<()> {
    // --- Checks ---
    require!(
        ctx.accounts.campaign.finalized && !ctx.accounts.campaign.successful,
        CrowdfundingError::NotFailed
    );
    require!(
        ctx.accounts.contributor_record.amount > 0,
        CrowdfundingError::NothingToRefund
    );

    let refund_amount = ctx.accounts.contributor_record.amount;

    // --- Effect (CEI): zero out contribution BEFORE external calls ---
    ctx.accounts.contributor_record.amount = 0;

    // Save PDA signer seed values.
    let creator_key = ctx.accounts.campaign.creator;
    let campaign_id_bytes = ctx.accounts.campaign.campaign_id.to_le_bytes();
    let bump = ctx.accounts.campaign.bump;

    let seeds: &[&[u8]] = &[
        b"campaign",
        creator_key.as_ref(),
        campaign_id_bytes.as_ref(),
        &[bump],
    ];

    // --- Interaction 1: transfer payment tokens from vault to contributor ---
    token_2022::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.contributor_payment_ata.to_account_info(),
                authority: ctx.accounts.campaign.to_account_info(),
            },
            &[seeds],
        ),
        refund_amount,
    )?;

    // --- Interaction 2: burn receipt tokens from contributor ---
    token_2022::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.receipt_mint.to_account_info(),
                from: ctx.accounts.contributor_receipt_ata.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        refund_amount,
    )?;

    // contributor_record is closed via `close = contributor` constraint.
    Ok(())
}
