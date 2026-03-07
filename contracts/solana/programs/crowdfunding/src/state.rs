use anchor_lang::prelude::*;

/// Campaign account — 256 bytes allocated
/// seeds: [b"campaign", creator, campaign_id.to_le_bytes()]
#[account]
pub struct Campaign {
    pub creator: Pubkey,          // 32
    pub payment_mint: Pubkey,     // 32
    pub receipt_mint: Pubkey,     // 32
    pub soft_cap: u64,            // 8
    pub hard_cap: u64,            // 8
    pub deadline: i64,            // 8
    pub total_raised: u64,        // 8
    pub finalized: bool,          // 1
    pub successful: bool,         // 1
    pub current_milestone: u8,    // 1
    pub total_withdrawn: u64,     // 8
    pub milestone_count: u8,      // 1
    pub milestones: [u8; 10],     // 10
    pub campaign_id: u64,         // 8
    pub bump: u8,                 // 1
    pub vault_bump: u8,           // 1
    pub receipt_mint_bump: u8,    // 1
}
// discriminator 8 + 32+32+32+8+8+8+8+1+1+1+8+1+10+8+1+1+1 = 8 + 161 = 169 < 256

/// ContributorRecord — 128 bytes allocated
/// seeds: [b"contributor", campaign, contributor]
#[account]
pub struct ContributorRecord {
    pub campaign: Pubkey,      // 32
    pub contributor: Pubkey,   // 32
    pub amount: u64,           // 8
    pub bump: u8,              // 1
}
// discriminator 8 + 73 = 81 < 128
