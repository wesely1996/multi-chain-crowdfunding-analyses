using System.Text;
using Solnet.Wallet;

namespace CrowdfundingClient.Solana;

public static class PdaHelper
{
    public static PublicKey CampaignPda(PublicKey creator, ulong campaignId, PublicKey programId)
    {
        var idBytes = BitConverter.GetBytes(campaignId); // LE
        PublicKey.TryFindProgramAddress(
            new[] { Encoding.UTF8.GetBytes("campaign"), creator.KeyBytes, idBytes },
            programId, out var pda, out _);
        return pda;
    }

    public static PublicKey VaultPda(PublicKey campaign, PublicKey programId)
    {
        PublicKey.TryFindProgramAddress(
            new[] { Encoding.UTF8.GetBytes("vault"), campaign.KeyBytes },
            programId, out var pda, out _);
        return pda;
    }

    public static PublicKey ReceiptMintPda(PublicKey campaign, PublicKey programId)
    {
        PublicKey.TryFindProgramAddress(
            new[] { Encoding.UTF8.GetBytes("receipt_mint"), campaign.KeyBytes },
            programId, out var pda, out _);
        return pda;
    }

    public static PublicKey ContributorRecordPda(PublicKey campaign, PublicKey contributor, PublicKey programId)
    {
        PublicKey.TryFindProgramAddress(
            new[] { Encoding.UTF8.GetBytes("contributor"), campaign.KeyBytes, contributor.KeyBytes },
            programId, out var pda, out _);
        return pda;
    }

    public static PublicKey AssociatedTokenAddress(PublicKey owner, PublicKey mint, PublicKey? tokenProgram = null)
    {
        var ataProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
        var tokenProgramId = tokenProgram ?? new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        PublicKey.TryFindProgramAddress(
            new[] { owner.KeyBytes, tokenProgramId.KeyBytes, mint.KeyBytes },
            ataProgramId, out var pda, out _);
        return pda;
    }
}
