using System.Diagnostics;
using Solnet.Rpc;
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

    public SolanaCampaignService(SolanaConfig config)
    {
        _rpc = ClientFactory.GetClient(config.RpcUrl);
        var keypairJson = File.ReadAllText(config.KeypairPath);
        var bytes = System.Text.Json.JsonSerializer.Deserialize<byte[]>(keypairJson)!;
        _signer = new Account(bytes[..64], bytes[32..64]);
        _programId = new PublicKey(config.ProgramId);
        _paymentMint = new PublicKey(config.PaymentMint);
        _campaignAddress = string.IsNullOrEmpty(config.CampaignAddress) ? null : new PublicKey(config.CampaignAddress);
        _campaignId = config.CampaignId;
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
        long deadline, byte[] milestones, ulong? campaignIdOverride = null)
    {
        var campaignId = campaignIdOverride ?? (ulong)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() & 0xFFFFFFFF);
        var campaign = PdaHelper.CampaignPda(_signer.PublicKey, campaignId, _programId);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var receiptMint = PdaHelper.ReceiptMintPda(campaign, _programId);

        var ix = InstructionBuilder.InitializeCampaign(
            _programId, _signer.PublicKey, campaign, _paymentMint,
            vault, receiptMint, campaignId, softCap, hardCap, deadline, milestones);

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
        var contributorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint);
        var contributorReceiptAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, receiptMint);

        var ix = InstructionBuilder.Contribute(
            _programId, _signer.PublicKey, campaign, contributorRecord,
            contributorPaymentAta, vault, contributorReceiptAta,
            receiptMint, _paymentMint, amount);

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
                ["amount"] = amount.ToString(),
                ["campaignAddress"] = campaign.Key,
            }
        };
    }

    public async Task<TxOutput> Finalize(string? campaignAddr = null)
    {
        var campaign = ResolveCampaign(campaignAddr);

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
        var creatorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint);

        // Read state before for milestone index
        var before = await FetchCampaignState(campaign);
        var milestoneIndex = before?["currentMilestone"];

        var ix = InstructionBuilder.WithdrawMilestone(
            _programId, _signer.PublicKey, campaign, vault, creatorPaymentAta, _paymentMint);
        var result = await TransactionHelper.SendAndConfirm(_rpc, _signer, ix);

        var after = await FetchCampaignState(campaign);
        var beforeWithdrawn = ulong.Parse(before?["totalWithdrawn"]?.ToString() ?? "0");
        var afterWithdrawn = ulong.Parse(after?["totalWithdrawn"]?.ToString() ?? "0");
        var amount = afterWithdrawn - beforeWithdrawn;

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
                ["milestoneIndex"] = milestoneIndex,
                ["amount"] = amount.ToString(),
                ["campaignAddress"] = campaign.Key,
            }
        };
    }

    public async Task<TxOutput> Refund(string? campaignAddr = null)
    {
        var campaign = ResolveCampaign(campaignAddr);
        var vault = PdaHelper.VaultPda(campaign, _programId);
        var receiptMint = PdaHelper.ReceiptMintPda(campaign, _programId);
        var contributorRecord = PdaHelper.ContributorRecordPda(campaign, _signer.PublicKey, _programId);
        var contributorPaymentAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, _paymentMint);
        var contributorReceiptAta = PdaHelper.AssociatedTokenAddress(_signer.PublicKey, receiptMint);

        var ix = InstructionBuilder.Refund(
            _programId, _signer.PublicKey, campaign, contributorRecord,
            contributorPaymentAta, contributorReceiptAta, vault, receiptMint);

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
            var recordInfo = await _rpc.GetAccountInfoAsync(recordPda.Key);
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
        var accountInfo = await _rpc.GetAccountInfoAsync(campaign.Key);
        if (accountInfo.Result?.Value?.Data?[0] == null)
            return null;

        var bytes = Convert.FromBase64String(accountInfo.Result.Value.Data[0]);
        if (bytes.Length < 8 + 169)
            return null;

        // Skip 8-byte Anchor discriminator
        int offset = 8;
        var creator = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var paymentMint = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var receiptMint = new PublicKey(bytes[offset..(offset + 32)]); offset += 32;
        var softCap = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var hardCap = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var deadline = BitConverter.ToInt64(bytes, offset); offset += 8;
        var totalRaised = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var finalized = bytes[offset] != 0; offset += 1;
        var successful = bytes[offset] != 0; offset += 1;
        var currentMilestone = bytes[offset]; offset += 1;
        var totalWithdrawn = BitConverter.ToUInt64(bytes, offset); offset += 8;
        var milestoneCount = bytes[offset]; offset += 1;
        var milestones = bytes[offset..(offset + milestoneCount)]; offset += 10;
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
}
