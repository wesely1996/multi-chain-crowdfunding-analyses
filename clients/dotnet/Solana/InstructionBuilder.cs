using System.Security.Cryptography;
using System.Text;
using Solnet.Rpc.Models;
using Solnet.Wallet;

namespace CrowdfundingClient.Solana;

public static class InstructionBuilder
{
    public static readonly PublicKey DefaultTokenProgram = new("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    public static readonly PublicKey Token2022Program = new("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    private static readonly PublicKey TokenProgram = DefaultTokenProgram;
    private static readonly PublicKey AssociatedTokenProgram = new("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    private static readonly PublicKey SystemProgram = new("11111111111111111111111111111111");
    private static readonly PublicKey RentSysvar = new("SysvarRent111111111111111111111111111111111");

    private static byte[] AnchorDiscriminator(string instructionName)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"global:{instructionName}"));
        return hash[..8];
    }

    public static TransactionInstruction InitializeCampaign(
        PublicKey programId, PublicKey creator, PublicKey campaign,
        PublicKey paymentMint, PublicKey vault, PublicKey receiptMint,
        ulong campaignId, ulong softCap, ulong hardCap, long deadline, byte[] milestones,
        PublicKey? tokenProgramOverride = null)
    {
        var tokenProg = tokenProgramOverride ?? TokenProgram;
        var data = new List<byte>();
        data.AddRange(AnchorDiscriminator("initialize_campaign"));
        data.AddRange(BitConverter.GetBytes(campaignId));
        data.AddRange(BitConverter.GetBytes(softCap));
        data.AddRange(BitConverter.GetBytes(hardCap));
        data.AddRange(BitConverter.GetBytes(deadline));
        // Borsh bytes = u32 length prefix + raw bytes
        data.AddRange(BitConverter.GetBytes((uint)milestones.Length));
        data.AddRange(milestones);

        return new TransactionInstruction
        {
            ProgramId = programId.KeyBytes,
            Keys = new List<AccountMeta>
            {
                AccountMeta.Writable(creator, true),
                AccountMeta.Writable(campaign, false),
                AccountMeta.ReadOnly(paymentMint, false),
                AccountMeta.Writable(vault, false),
                AccountMeta.Writable(receiptMint, false),
                AccountMeta.ReadOnly(tokenProg, false),
                AccountMeta.ReadOnly(SystemProgram, false),
                AccountMeta.ReadOnly(RentSysvar, false),
            },
            Data = data.ToArray(),
        };
    }

    public static TransactionInstruction Contribute(
        PublicKey programId, PublicKey contributor, PublicKey campaign,
        PublicKey contributorRecord, PublicKey contributorPaymentAta,
        PublicKey vault, PublicKey contributorReceiptAta,
        PublicKey receiptMint, PublicKey paymentMint, ulong amount,
        PublicKey? tokenProgramOverride = null)
    {
        var tokenProg = tokenProgramOverride ?? TokenProgram;
        var data = new List<byte>();
        data.AddRange(AnchorDiscriminator("contribute"));
        data.AddRange(BitConverter.GetBytes(amount));

        return new TransactionInstruction
        {
            ProgramId = programId.KeyBytes,
            Keys = new List<AccountMeta>
            {
                AccountMeta.Writable(contributor, true),
                AccountMeta.Writable(campaign, false),
                AccountMeta.Writable(contributorRecord, false),
                AccountMeta.Writable(contributorPaymentAta, false),
                AccountMeta.Writable(vault, false),
                AccountMeta.Writable(contributorReceiptAta, false),
                AccountMeta.Writable(receiptMint, false),
                AccountMeta.ReadOnly(paymentMint, false),
                AccountMeta.ReadOnly(tokenProg, false),
                AccountMeta.ReadOnly(AssociatedTokenProgram, false),
                AccountMeta.ReadOnly(SystemProgram, false),
                AccountMeta.ReadOnly(RentSysvar, false),
            },
            Data = data.ToArray(),
        };
    }

    public static TransactionInstruction Finalize(
        PublicKey programId, PublicKey caller, PublicKey campaign)
    {
        return new TransactionInstruction
        {
            ProgramId = programId.KeyBytes,
            Keys = new List<AccountMeta>
            {
                AccountMeta.ReadOnly(caller, true),
                AccountMeta.Writable(campaign, false),
            },
            Data = AnchorDiscriminator("finalize"),
        };
    }

    public static TransactionInstruction WithdrawMilestone(
        PublicKey programId, PublicKey creator, PublicKey campaign,
        PublicKey vault, PublicKey creatorPaymentAta, PublicKey paymentMint,
        PublicKey? tokenProgramOverride = null)
    {
        var tokenProg = tokenProgramOverride ?? TokenProgram;
        return new TransactionInstruction
        {
            ProgramId = programId.KeyBytes,
            Keys = new List<AccountMeta>
            {
                AccountMeta.Writable(creator, true),
                AccountMeta.Writable(campaign, false),
                AccountMeta.Writable(vault, false),
                AccountMeta.Writable(creatorPaymentAta, false),
                AccountMeta.ReadOnly(paymentMint, false),
                AccountMeta.ReadOnly(tokenProg, false),
            },
            Data = AnchorDiscriminator("withdraw_milestone"),
        };
    }

    public static TransactionInstruction Refund(
        PublicKey programId, PublicKey contributor, PublicKey campaign,
        PublicKey contributorRecord, PublicKey contributorPaymentAta,
        PublicKey contributorReceiptAta, PublicKey vault,
        PublicKey receiptMint, PublicKey? tokenProgramOverride = null)
    {
        var tokenProg = tokenProgramOverride ?? TokenProgram;
        return new TransactionInstruction
        {
            ProgramId = programId.KeyBytes,
            Keys = new List<AccountMeta>
            {
                AccountMeta.Writable(contributor, true),
                AccountMeta.Writable(campaign, false),
                AccountMeta.Writable(contributorRecord, false),
                AccountMeta.Writable(contributorPaymentAta, false),
                AccountMeta.Writable(contributorReceiptAta, false),
                AccountMeta.Writable(vault, false),
                AccountMeta.Writable(receiptMint, false),
                AccountMeta.ReadOnly(tokenProg, false),
                AccountMeta.ReadOnly(SystemProgram, false),
            },
            Data = AnchorDiscriminator("refund"),
        };
    }
}
