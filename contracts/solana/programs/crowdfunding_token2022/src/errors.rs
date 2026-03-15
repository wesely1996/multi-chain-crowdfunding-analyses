use anchor_lang::prelude::*;

#[error_code]
pub enum CrowdfundingError {
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("softCap must be > 0 and <= hardCap")]
    InvalidCaps,
    #[msg("Milestone percentages must sum to exactly 100")]
    InvalidMilestones,
    #[msg("Campaign is not in Funding state")]
    NotFunding,
    #[msg("Campaign deadline has passed")]
    DeadlinePassed,
    #[msg("Contribution would exceed hardCap")]
    HardCapExceeded,
    #[msg("Campaign is not finalized")]
    NotFinalized,
    #[msg("Campaign did not succeed")]
    NotSuccessful,
    #[msg("Campaign did not fail")]
    NotFailed,
    #[msg("All milestones already withdrawn")]
    AllMilestonesWithdrawn,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("No contribution to refund")]
    NothingToRefund,
    #[msg("Campaign already finalized")]
    AlreadyFinalized,
    #[msg("Deadline has not yet passed")]
    DeadlineNotPassed,
}
