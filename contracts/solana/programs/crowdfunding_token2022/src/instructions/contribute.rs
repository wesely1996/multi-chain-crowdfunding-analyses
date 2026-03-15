use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::{self, MintTo, Token2022, Transfer};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::CrowdfundingError;
use crate::state::{Campaign, ContributorRecord};

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init_if_needed,
        payer = contributor,
        space = 128,
        seeds = [b"contributor", campaign.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contributor_record: Account<'info, ContributorRecord>,

    #[account(
        mut,
        token::mint = campaign.payment_mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_payment_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
        token::mint = campaign.payment_mint,
        token::authority = campaign,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = contributor,
        associated_token::mint = receipt_mint,
        associated_token::authority = contributor,
        associated_token::token_program = token_program,
    )]
    pub contributor_receipt_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"receipt_mint", campaign.key().as_ref()],
        bump = campaign.receipt_mint_bump,
        mint::token_program = token_program,
    )]
    pub receipt_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        address = campaign.payment_mint,
        mint::token_program = token_program,
    )]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Contribute>, amount: u64) -> Result<()> {
    // --- Guards ---
    require!(!ctx.accounts.campaign.finalized, CrowdfundingError::AlreadyFinalized);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= ctx.accounts.campaign.deadline, CrowdfundingError::DeadlinePassed);
    let new_total = ctx
        .accounts
        .campaign
        .total_raised
        .checked_add(amount)
        .ok_or(CrowdfundingError::Overflow)?;
    require!(new_total <= ctx.accounts.campaign.hard_cap, CrowdfundingError::HardCapExceeded);

    // --- Save values needed for signer seeds before mutable borrows ---
    let creator_key = ctx.accounts.campaign.creator;
    let campaign_id_bytes = ctx.accounts.campaign.campaign_id.to_le_bytes();
    let bump = ctx.accounts.campaign.bump;
    let record_is_new = ctx.accounts.contributor_record.campaign == Pubkey::default();
    let campaign_key = ctx.accounts.campaign.key();
    let contributor_key = ctx.accounts.contributor.key();
    let contributor_record_bump = ctx.bumps.contributor_record;

    // --- CPI: transfer payment tokens from contributor to vault ---
    token_2022::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.contributor_payment_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        amount,
    )?;

    // --- Effects: update campaign and contributor record ---
    ctx.accounts.campaign.total_raised = new_total;

    let record = &mut ctx.accounts.contributor_record;
    if record_is_new {
        record.campaign = campaign_key;
        record.contributor = contributor_key;
        record.bump = contributor_record_bump;
    }
    record.amount = record
        .amount
        .checked_add(amount)
        .ok_or(CrowdfundingError::Overflow)?;

    // --- CPI: mint receipt tokens to contributor ---
    let seeds: &[&[u8]] = &[
        b"campaign",
        creator_key.as_ref(),
        campaign_id_bytes.as_ref(),
        &[bump],
    ];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.receipt_mint.to_account_info(),
                to: ctx.accounts.contributor_receipt_ata.to_account_info(),
                authority: ctx.accounts.campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    Ok(())
}
