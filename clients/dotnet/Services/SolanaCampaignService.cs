using System.Diagnostics;
using System.Linq;
using Solnet.Programs; // SystemProgram.CreateAccount, TokenProgram.MintAccountDataSize
using Solnet.Rpc;
using Solnet.Rpc.Types;
using Solnet.Wallet;
using CrowdfundingClient.Configuration;
using CrowdfundingClient.Models;
using CrowdfundingClient.Solana;

namespace CrowdfundingClient.Services;

public class SolanaCampaignService
{
    private readonly IRpcClient _rpc;
    private readonly Account _signer;
    private readonly PublicKey _programId;
    private readonly PublicKey _paymentMint;
    private readonly PublicKey? _campaignAddress;
    private readonly ulong _campaignId;

    private readonly PublicKey _tokenProgram;

    public SolanaCampaignService(SolanaConfig config)
    {
        _rpc = ClientFactory.GetClient(config.RpcUrl);
        var keypairJson = File.ReadAllText(config.KeypairPath);
        // Solana keypair files are JSON arrays of integers, not base64
        var ints = System.Text.Json.JsonSerializer.Deserialize<int[]>(keypairJson)!;
        var bytes = ints.Select(i => (byte)i).ToArray();
        _signer = new Account(bytes[..64], bytes[32..64]);
        if (string.IsNullOrEmpty(config.ProgramId))
            throw new InvalidOperationException($"SOLANA_PROGRAM_ID_{config.Variant} is not set.");
        if (string.IsNullOrEmpty(config.PaymentMint))
            throw new InvalidOperationException("SOLANA_PAYMENT_MINT is not set.");
        _programId = new PublicKey(config.ProgramId);
        _paymentMint = new PublicKey(config.PaymentMint);
        _campaignAddress = string.IsNullOrEmpty(config.CampaignAddress) ? null : new PublicKey(config.CampaignAddress);
        _campaignId = config.CampaignId;
        _tokenProgram = config.Variant == "V5"
            ? InstructionBuilder.Token2022Program
            : InstructionBuilder.DefaultTokenProgram;
    }

    private PublicKey ResolveCampaign(string? explicitAddress = null)
    {
        if (!string.IsNullOrEmpty(explicitAddress))
            return new PublicKey(explicitAddress);
        if (_campaignAddress != null)
            return _campaignAddress;
        return PdaHelper.CampaignPda(_signer.PublicKey, _campaignId, _programId);
    }

    public async Task<TxOutput> CreateCampaign(ulong softCap, ulong hardCap,
        long deadlineSeconds, byte[] milestones, ulong? campaignIdOverride = null)
    {
        // Derive deadline from Solana block time to stay consistent with the on-chain clock.
        var slotResp = await _rpc.GetSlotAsync();
        var blockTimeResp = await _rpc.GetBlockTimeAsync(slotResp.Result);
        var solanaNow = blockTimeResp.Result > 0 ? (long)blockTimeResp.Result : DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var deadline = solanaNow + deadlineSeconds;

        var campaignId = campaignIdOverride ?? (ulong)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() & 0xFFFFFFFF);
        var campaign = PdaHelper.CampaignPda(_signer.PublicKey, campaignId, _programId);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var receiptMint = PdaHelper.ReceiptMintPda(campaign, _programId);

        var ix = InstructionBuilder.InitializeCampaign(
            _programId, _signer.PublicKey, campaign, _paymentMint,
            vault, receiptMint, campaignId, softCap, hardCap, deadline, milestones,
            _tokenProgram);

        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        return new TxOutput
        {
            Chain = "solana",
            Operation = "create-campaign",
            TxHash = result.Signature,
            BlockNumber = result.Slot,
            GasUsed = (long)result.Fee,
            Status = result.Success ? "success" : "reverted",
            ElapsedMs = result.ElapsedMs,
            Data = new()
            {
                ["error"] = result.ErrorCode,
                ["campaignAddress"] = campaign.Key,
                ["vaultAddress"] = vault.Key,
                ["receiptMintAddress"] = receiptMint.Key,
                ["campaignId"] = campaignId.ToString(),
                ["softCap"] = softCap.ToString(),
                ["hardCap"] = hardCap.ToString(),
                ["deadline"] = deadline.ToString(),
                ["milestones"] = milestones.Select(b => (int)b).ToList(),
            }
        };
    }

    public async Task<TxOutput> Contribute(ulong amount, string? campaignAddr = null)
    {
        var campaign = ResolveCampaign(campaignAddr);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var receiptMint = PdaHelper.ReceiptMintPda(campaign, _programId);
        var contributorRecord = PdaHelper.ContributorRecordPda(campaign, _signer.PublicKey, _programId);
        var contributorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint, _tokenProgram);
        var contributorReceiptAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, receiptMint, _tokenProgram);

        var ix = InstructionBuilder.Contribute(
            _programId, _signer.PublicKey, campaign, contributorRecord,
            contributorPaymentAta, vault, contributorReceiptAta,
            receiptMint, _paymentMint, amount, _tokenProgram);

        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        return new TxOutput
        {
            Chain = "solana",
            Operation = "contribute",
            TxHash = result.Signature,
            BlockNumber = result.Slot,
            GasUsed = (long)result.Fee,
            Status = result.Success ? "success" : "reverted",
            ElapsedMs = result.ElapsedMs,
            Data = new()
            {
                ["error"] = result.ErrorCode,
                ["amount"] = amount.ToString(),
                ["campaignAddress"] = campaign.Key,
            }
        };
    }

    public async Task<TxOutput> Finalize(string? campaignAddr = null, bool advanceTime = false)
    {
        var campaign = ResolveCampaign(campaignAddr);

        if (advanceTime)
        {
            // Solana localnet clock cannot be advanced via RPC (unlike Hardhat's evm_increaseTime).
            // Strategy: if the deadline is close, sleep until it passes; otherwise, error.
            var pre = await FetchCampaignState(campaign);
            if (pre != null)
            {
                var deadline = long.Parse(pre["deadline"]?.ToString() ?? "0");
                // Use Solana block time, not wall clock — the program validates against
                // Clock::get()?.unix_timestamp which can lag behind real time.
                var slotResp = await _rpc.GetSlotAsync();
                var blockTimeResp = await _rpc.GetBlockTimeAsync(slotResp.Result);
                var solanaNow = blockTimeResp.Result > 0 ? (long)blockTimeResp.Result : DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var remaining = deadline - solanaNow;
                if (remaining > 0)
                {
                    const int maxWaitSeconds = 300;
                    if (remaining > maxWaitSeconds)
                        throw new InvalidOperationException(
                            $"--advance-time: deadline is {remaining}s away — too long to sleep. " +
                            $"Re-create the campaign with --deadline-seconds 5 for instant finalization.");
                    Console.Error.WriteLine($"[sol] deadline in {remaining}s — sleeping until it passes...");
                    await Task.Delay((int)(remaining + 2) * 1000);
                }
            }
        }

        var ix = InstructionBuilder.Finalize(_programId, _signer.PublicKey, campaign);
        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        // Read campaign state after finalize
        var state = await FetchCampaignState(campaign);

        return new TxOutput
        {
            Chain = "solana",
            Operation = "finalize",
            TxHash = result.Signature,
            BlockNumber = result.Slot,
            GasUsed = (long)result.Fee,
            Status = result.Success ? "success" : "reverted",
            ElapsedMs = result.ElapsedMs,
            Data = new()
            {
                ["error"] = result.ErrorCode,
                ["successful"] = state?["successful"],
                ["totalRaised"] = state?["totalRaised"],
                ["campaignAddress"] = campaign.Key,
            }
        };
    }

    public async Task<TxOutput> Withdraw(string? campaignAddr = null)
    {
        var campaign = ResolveCampaign(campaignAddr);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var creatorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint, _tokenProgram);

        // Read pre-tx state: milestone index, percentages, and running totals
        var before         = await FetchCampaignState(campaign);
        var mIdx           = (int)(before?["currentMilestone"] ?? 0);
        var milestoneCount = (int)(before?["milestoneCount"] ?? 0);
        var totalRaised    = ulong.Parse(before?["totalRaised"]?.ToString()    ?? "0");
        var totalWithdrawn = ulong.Parse(before?["totalWithdrawn"]?.ToString() ?? "0");
        var milestones     = (before?["milestones"] as List<int>) ?? new List<int>();

        var ix = InstructionBuilder.WithdrawMilestone(
            _programId, _signer.PublicKey, campaign, vault, creatorPaymentAta, _paymentMint,
            _tokenProgram);
        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        // Mirror on-chain math: last milestone sweeps remainder, others take their percentage
        ulong amount = (mIdx >= milestoneCount - 1)
            ? totalRaised - totalWithdrawn
            : totalRaised * (ulong)milestones[mIdx] / 100;

        return new TxOutput
        {
            Chain = "solana",
            Operation = "withdraw",
            TxHash = result.Signature,
            BlockNumber = result.Slot,
            GasUsed = (long)result.Fee,
            Status = result.Success ? "success" : "reverted",
            ElapsedMs = result.ElapsedMs,
            Data = new()
            {
                ["error"]          = result.ErrorCode,
                ["milestoneIndex"] = mIdx,
                ["amount"]         = amount.ToString(),
                ["campaignAddress"]= campaign.Key,
            }
        };
    }

    public async Task<TxOutput> Refund(string? campaignAddr = null)
    {
        var campaign = ResolveCampaign(campaignAddr);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var receiptMint = PdaHelper.ReceiptMintPda(campaign, _programId);
        var contributorRecord = PdaHelper.ContributorRecordPda(campaign, _signer.PublicKey, _programId);
        var contributorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint, _tokenProgram);
        var contributorReceiptAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, receiptMint, _tokenProgram);

        var ix = InstructionBuilder.Refund(
            _programId, _signer.PublicKey, campaign, contributorRecord,
            contributorPaymentAta, contributorReceiptAta, vault, receiptMint, _tokenProgram);

        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        return new TxOutput
        {
            Chain = "solana",
            Operation = "refund",
            TxHash = result.Signature,
            BlockNumber = result.Slot,
            GasUsed = (long)result.Fee,
            Status = result.Success ? "success" : "reverted",
            ElapsedMs = result.ElapsedMs,
            Data = new()
            {
                ["error"] = result.ErrorCode,
                ["contributor"] = _signer.PublicKey.Key,
                ["campaignAddress"] = campaign.Key,
            }
        };
    }

    public async Task<TxOutput> GetStatus(string? campaignAddr = null, string? contributorAddr = null)
    {
        var sw = Stopwatch.StartNew();
        var campaign = ResolveCampaign(campaignAddr);

        var data = await FetchCampaignState(campaign);
        if (data == null)
            throw new Exception($"Campaign account not found: {campaign.Key}");

        // Read contributor record
        var contributor = contributorAddr ?? _signer.PublicKey.Key;
        try
        {
            var recordPda = PdaHelper.ContributorRecordPda(campaign, new PublicKey(contributor), _programId);
            var recordInfo = await _rpc.GetAccountInfoAsync(recordPda.Key, Commitment.Confirmed);
            if (recordInfo.Result?.Value?.Data?[0] != null)
            {
                var recordBytes = Convert.FromBase64String(recordInfo.Result.Value.Data[0]);
                if (recordBytes.Length >= 8 + 32 + 32 + 8)
                {
                    var amount = BitConverter.ToUInt64(recordBytes, 8 + 32 + 32);
                    data["contribution"] = amount.ToString();
                }
            }
            else
            {
                data["contribution"] = "0";
            }
        }
        catch
        {
            data["contribution"] = "0";
        }
        data["contributorAddress"] = contributor;

        sw.Stop();

        return new TxOutput
        {
            Chain = "solana",
            Operation = "status",
            Status = "success",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = data,
        };
    }

    private async Task<Dictionary<string, object?>?> FetchCampaignState(PublicKey campaign)
    {
        var accountInfo = await _rpc.GetAccountInfoAsync(campaign.Key, Commitment.Confirmed);
        if (accountInfo.Result?.Value?.Data?[0] == null)
            return null;

        var bytes = Convert.FromBase64String(accountInfo.Result.Value.Data[0]);
        // Campaign account: 8 discriminator + 161 fields = 169 bytes (256 allocated)
        if (bytes.Length < 169)
            return null;

        // Skip 8-byte Anchor discriminator
        int offset = 8;
        var creator     = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var paymentMint = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var receiptMint = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var softCap          = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var hardCap          = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var deadline         = BitConverter.ToInt64(bytes,  offset); offset += 8;
        var totalRaised      = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var finalized        = bytes[offset] != 0; offset += 1;
        var successful       = bytes[offset] != 0; offset += 1;
        var currentMilestone = bytes[offset];       offset += 1;
        var totalWithdrawn   = BitConverter.ToUInt64(bytes, offset); offset += 8;
        // milestones is [u8; 10] — a fixed array (not Vec), preceded by milestone_count: u8
        var milestoneCount = bytes[offset]; offset += 1;
        var milestones = bytes[offset..(offset + 10)]; offset += 10;
        var campaignId = BitConverter.ToUInt64(bytes, offset);

        return new Dictionary<string, object?>
        {
            ["campaignAddress"] = campaign.Key,
            ["creator"] = creator.Key,
            ["paymentMint"] = paymentMint.Key,
            ["receiptMint"] = receiptMint.Key,
            ["softCap"] = softCap.ToString(),
            ["hardCap"] = hardCap.ToString(),
            ["deadline"] = deadline.ToString(),
            ["totalRaised"] = totalRaised.ToString(),
            ["totalWithdrawn"] = totalWithdrawn.ToString(),
            ["finalized"] = finalized,
            ["successful"] = successful,
            ["currentMilestone"] = (int)currentMilestone,
            ["milestoneCount"] = (int)milestoneCount,
            ["milestones"] = milestones.Select(b => (int)b).ToList(),
            ["campaignId"] = campaignId.ToString(),
        };
    }

    /// <summary>
    /// Creates a new SPL token mint and mints tokens to the signer's ATA.
    /// Run this after solana-test-validator --reset to recreate the payment mint.
    /// Output includes the mint address to put in SOLANA_PAYMENT_MINT.
    /// </summary>
    public async Task<TxOutput> CreateMint(byte decimals = 6, ulong mintAmount = 10_000_000_000)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        // 1. Generate a new keypair for the mint account
        var mintKp = new Account();

        // 2. Get minimum rent-exempt balance for a Mint account (82 bytes)
        var rentResp = await _rpc.GetMinimumBalanceForRentExemptionAsync(82);
        var rentLamports = rentResp.Result;

        // 3. Create the mint account + initialize it in one transaction.
        // For V5 (Token-2022), _tokenProgram is Token-2022 so the account is owned by
        // that program and InitializeMint targets it. Format is identical to classic SPL.
        var createAccountIx = SystemProgram.CreateAccount(
            _signer.PublicKey, mintKp.PublicKey,
            rentLamports, TokenProgram.MintAccountDataSize,
            _tokenProgram);

        var initMintIx = InstructionBuilder.InitializeMint(
            mintKp.PublicKey, decimals, _signer.PublicKey, _signer.PublicKey, _tokenProgram);

        var r1 = await TransactionHelper.SendAndConfirm(
            _rpc, _signer,
            new[] { createAccountIx, initMintIx },
            new[] { mintKp });

        // 4. Create ATA for the signer (Token-2022 ATAs use Token-2022 program ID in seeds)
        var ata = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, mintKp.PublicKey, _tokenProgram);
        var createAtaIx = InstructionBuilder.CreateAta(
            _signer.PublicKey, _signer.PublicKey, mintKp.PublicKey, _tokenProgram);
        await TransactionHelper.SendAndConfirm(_rpc, _signer, createAtaIx);

        // 5. Mint tokens to the signer's ATA
        var mintToIx = InstructionBuilder.MintTo(
            mintKp.PublicKey, ata, mintAmount, _signer.PublicKey, _tokenProgram);
        await TransactionHelper.SendAndConfirm(_rpc, _signer, mintToIx);

        sw.Stop();
        Console.Error.WriteLine($"\nUpdate .env:");
        Console.Error.WriteLine($"  SOLANA_PAYMENT_MINT={mintKp.PublicKey.Key}");

        return new TxOutput
        {
            Chain = "solana",
            Operation = "create-mint",
            Status = r1.Success ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["mint"] = mintKp.PublicKey.Key,
                ["ata"] = ata.Key,
                ["decimals"] = (int)decimals,
                ["mintedAmount"] = mintAmount.ToString(),
            }
        };
    }
}
