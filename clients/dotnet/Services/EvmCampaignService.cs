using System.Diagnostics;
using System.Numerics;
using Nethereum.Web3;
using Nethereum.Web3.Accounts;
using Nethereum.Contracts;
using Nethereum.RPC.Eth.DTOs;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Hex.HexTypes;
using Nethereum.RPC.TransactionManagers;
using CrowdfundingClient.Configuration;
using CrowdfundingClient.Contracts;
using CrowdfundingClient.Models;

namespace CrowdfundingClient.Services;

// ── Event DTOs ──────────────────────────────────────────────────────────────

[Event("CampaignCreated")]
public class CampaignCreatedEvent : IEventDTO
{
    [Parameter("address", "campaign", 1, true)]
    public string Campaign { get; set; } = "";

    [Parameter("address", "creator", 2, true)]
    public string Creator { get; set; } = "";

    [Parameter("address", "paymentToken", 3, true)]
    public string PaymentToken { get; set; } = "";
}

[Event("Contributed")]
public class ContributedEvent : IEventDTO
{
    [Parameter("address", "contributor", 1, true)]
    public string Contributor { get; set; } = "";

    [Parameter("uint256", "amount", 2, false)]
    public BigInteger Amount { get; set; }

    [Parameter("uint256", "totalRaised", 3, false)]
    public BigInteger TotalRaised { get; set; }
}

[Event("Finalized")]
public class FinalizedEvent : IEventDTO
{
    [Parameter("bool", "successful", 1, false)]
    public bool Successful { get; set; }

    [Parameter("uint256", "totalRaised", 2, false)]
    public BigInteger TotalRaised { get; set; }
}

[Event("MilestoneWithdrawn")]
public class MilestoneWithdrawnEvent : IEventDTO
{
    [Parameter("uint256", "milestoneIndex", 1, true)]
    public BigInteger MilestoneIndex { get; set; }

    [Parameter("uint256", "amount", 2, false)]
    public BigInteger Amount { get; set; }

    [Parameter("address", "recipient", 3, false)]
    public string Recipient { get; set; } = "";
}

[Event("Refunded")]
public class RefundedEvent : IEventDTO
{
    [Parameter("address", "contributor", 1, true)]
    public string Contributor { get; set; } = "";

    [Parameter("uint256", "amount", 2, false)]
    public BigInteger Amount { get; set; }
}

// ── Service ─────────────────────────────────────────────────────────────────

public class EvmCampaignService
{
    private readonly Web3 _web3;
    private readonly string _factoryAddress;
    private readonly string _campaignAddress;
    private readonly string _paymentTokenAddress;
    private readonly EvmConfig _config;

    public EvmCampaignService(EvmConfig config)
    {
        _config = config;
        var account = new Account(config.PrivateKey, config.ChainId);
        _web3 = new Web3(account, config.RpcUrl);
        _factoryAddress = config.FactoryAddress;
        _campaignAddress = config.CampaignAddress;
        _paymentTokenAddress = config.PaymentTokenAddress;
    }

    private string GetFactoryAbi() => _config.Variant switch
    {
        "V2" => CrowdfundingFactory4626Abi.ABI,
        "V3" => CrowdfundingFactory1155Abi.ABI,
        _ => CrowdfundingFactoryAbi.ABI,
    };

    private string GetCampaignAbi() => _config.Variant switch
    {
        "V2" => CrowdfundingCampaign4626Abi.ABI,
        "V3" => CrowdfundingCampaign1155Abi.ABI,
        _ => CrowdfundingCampaignAbi.ABI,
    };

    public async Task<TxOutput> CreateCampaign(BigInteger softCap, BigInteger hardCap,
        BigInteger deadline, List<byte> milestones, string tokenName, string tokenSymbol,
        BigInteger[]? tierPrices = null, string[]? tierNames = null, string? tokenUri = null)
    {
        var sw = Stopwatch.StartNew();
        var contract = _web3.Eth.GetContract(GetFactoryAbi(), _factoryAddress);
        var function = contract.GetFunction("createCampaign");

        string txHash;
        if (_config.Variant == "V3")
        {
            var tp = tierPrices ?? new[] { new BigInteger(10_000_000), new BigInteger(10_000_000), new BigInteger(10_000_000) };
            var tn = tierNames ?? new[] { "A", "B", "C" };
            var tu = tokenUri ?? "";
            txHash = await function.SendTransactionAsync(
                _web3.TransactionManager.Account.Address,
                new HexBigInteger(_config.GasCreateCampaign),
                null,
                _paymentTokenAddress, softCap, hardCap, deadline, milestones, tp, tn, tu);
        }
        else
        {
            txHash = await function.SendTransactionAsync(
                _web3.TransactionManager.Account.Address,
                new HexBigInteger(_config.GasCreateCampaign),
                null,
                _paymentTokenAddress, softCap, hardCap, deadline, milestones, tokenName, tokenSymbol);
        }
        var receipt = await WaitForReceipt(txHash);
        sw.Stop();

        // Parse CampaignCreated event
        var events = receipt.DecodeAllEvents<CampaignCreatedEvent>();
        var campaignAddress = events.Count > 0 ? events[0].Event.Campaign : "";

        // Read receipt/tier token from the new campaign
        var receiptToken = "";
        if (!string.IsNullOrEmpty(campaignAddress))
        {
            var campaign = _web3.Eth.GetContract(GetCampaignAbi(), campaignAddress);
            if (_config.Variant == "V3")
                receiptToken = await campaign.GetFunction("tierToken").CallAsync<string>();
            else if (_config.Variant == "V2")
                receiptToken = campaignAddress; // V2: campaign IS the ERC-4626 vault
            else
                receiptToken = await campaign.GetFunction("receiptToken").CallAsync<string>();
        }

        return new TxOutput
        {
            Operation = "create-campaign",
            TxHash = receipt.TransactionHash,
            BlockNumber = (long)receipt.BlockNumber.Value,
            GasUsed = (long)receipt.GasUsed.Value,
            Status = receipt.Status.Value == 1 ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["campaignAddress"] = campaignAddress,
                ["receiptTokenAddress"] = receiptToken,
                ["softCap"] = softCap.ToString(),
                ["hardCap"] = hardCap.ToString(),
                ["deadline"] = deadline.ToString(),
            }
        };
    }

    public async Task<TxOutput> Contribute(BigInteger amount, BigInteger? tierId = null)
    {
        var sw = Stopwatch.StartNew();
        var sender = _web3.TransactionManager.Account.Address;

        // Step 1: approve
        var token = _web3.Eth.GetContract(MockERC20Abi.ABI, _paymentTokenAddress);
        var approveTxHash = await token.GetFunction("approve")
            .SendTransactionAsync(sender, new HexBigInteger(_config.GasApprove), null,
                _campaignAddress, amount);
        var approveReceipt = await WaitForReceipt(approveTxHash);

        // Step 2: contribute (V3 uses tierId, others use amount)
        var campaign = _web3.Eth.GetContract(GetCampaignAbi(), _campaignAddress);
        string contributeTxHash;
        if (_config.Variant == "V3")
        {
            var tid = tierId ?? BigInteger.Zero;
            contributeTxHash = await campaign.GetFunction("contribute")
                .SendTransactionAsync(sender, new HexBigInteger(_config.GasContribute), null, tid);
        }
        else
        {
            contributeTxHash = await campaign.GetFunction("contribute")
                .SendTransactionAsync(sender, new HexBigInteger(_config.GasContribute), null, amount);
        }
        var receipt = await WaitForReceipt(contributeTxHash);
        sw.Stop();

        var events = receipt.DecodeAllEvents<ContributedEvent>();
        var totalRaised = events.Count > 0 ? events[0].Event.TotalRaised.ToString() : "";

        var gasUsed = (long)approveReceipt.GasUsed.Value + (long)receipt.GasUsed.Value;

        return new TxOutput
        {
            Operation = "contribute",
            TxHash = receipt.TransactionHash,
            BlockNumber = (long)receipt.BlockNumber.Value,
            GasUsed = gasUsed,
            Status = receipt.Status.Value == 1 ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["amount"] = amount.ToString(),
                ["approveTxHash"] = approveReceipt.TransactionHash,
                ["contributeTxHash"] = receipt.TransactionHash,
                ["approveGasUsed"] = (long)approveReceipt.GasUsed.Value,
                ["contributeGasUsed"] = (long)receipt.GasUsed.Value,
                ["totalRaised"] = totalRaised,
            }
        };
    }

    public async Task<TxOutput> Finalize()
    {
        var sw = Stopwatch.StartNew();
        var campaign = _web3.Eth.GetContract(GetCampaignAbi(), _campaignAddress);
        var txHash = await campaign.GetFunction("finalize")
            .SendTransactionAsync(_web3.TransactionManager.Account.Address,
                new HexBigInteger(_config.GasFinalize), null);
        var receipt = await WaitForReceipt(txHash);
        sw.Stop();

        var events = receipt.DecodeAllEvents<FinalizedEvent>();
        var successful = events.Count > 0 ? (object)events[0].Event.Successful : null;
        var totalRaised = events.Count > 0 ? events[0].Event.TotalRaised.ToString() : "";

        return new TxOutput
        {
            Operation = "finalize",
            TxHash = receipt.TransactionHash,
            BlockNumber = (long)receipt.BlockNumber.Value,
            GasUsed = (long)receipt.GasUsed.Value,
            Status = receipt.Status.Value == 1 ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["successful"] = successful,
                ["totalRaised"] = totalRaised,
            }
        };
    }

    public async Task<TxOutput> Withdraw()
    {
        var sw = Stopwatch.StartNew();
        var campaign = _web3.Eth.GetContract(GetCampaignAbi(), _campaignAddress);
        var txHash = await campaign.GetFunction("withdrawMilestone")
            .SendTransactionAsync(_web3.TransactionManager.Account.Address,
                new HexBigInteger(_config.GasWithdraw), null);
        var receipt = await WaitForReceipt(txHash);
        sw.Stop();

        var events = receipt.DecodeAllEvents<MilestoneWithdrawnEvent>();
        var milestoneIndex = events.Count > 0 ? (object)(long)events[0].Event.MilestoneIndex : null;
        var amount = events.Count > 0 ? events[0].Event.Amount.ToString() : "";

        return new TxOutput
        {
            Operation = "withdraw",
            TxHash = receipt.TransactionHash,
            BlockNumber = (long)receipt.BlockNumber.Value,
            GasUsed = (long)receipt.GasUsed.Value,
            Status = receipt.Status.Value == 1 ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["milestoneIndex"] = milestoneIndex,
                ["amount"] = amount,
            }
        };
    }

    public async Task<TxOutput> Refund(BigInteger? tierId = null)
    {
        var sw = Stopwatch.StartNew();
        var campaign = _web3.Eth.GetContract(GetCampaignAbi(), _campaignAddress);
        string txHash;
        if (_config.Variant == "V3")
        {
            var tid = tierId ?? BigInteger.Zero;
            txHash = await campaign.GetFunction("refund")
                .SendTransactionAsync(_web3.TransactionManager.Account.Address,
                    new HexBigInteger(_config.GasRefund), null, tid);
        }
        else
        {
            txHash = await campaign.GetFunction("refund")
                .SendTransactionAsync(_web3.TransactionManager.Account.Address,
                    new HexBigInteger(_config.GasRefund), null);
        }
        var receipt = await WaitForReceipt(txHash);
        sw.Stop();

        var events = receipt.DecodeAllEvents<RefundedEvent>();
        var contributor = events.Count > 0 ? events[0].Event.Contributor : "";
        var amount = events.Count > 0 ? events[0].Event.Amount.ToString() : "";

        return new TxOutput
        {
            Operation = "refund",
            TxHash = receipt.TransactionHash,
            BlockNumber = (long)receipt.BlockNumber.Value,
            GasUsed = (long)receipt.GasUsed.Value,
            Status = receipt.Status.Value == 1 ? "success" : "reverted",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = new()
            {
                ["contributor"] = contributor,
                ["amount"] = amount,
            }
        };
    }

    public async Task<TxOutput> GetStatus(string? contributorAddress = null)
    {
        var sw = Stopwatch.StartNew();
        var campaign = _web3.Eth.GetContract(GetCampaignAbi(), _campaignAddress);

        var creator = await campaign.GetFunction("creator").CallAsync<string>();
        var softCap = await campaign.GetFunction("softCap").CallAsync<BigInteger>();
        var hardCap = await campaign.GetFunction("hardCap").CallAsync<BigInteger>();
        var deadline = await campaign.GetFunction("deadline").CallAsync<BigInteger>();
        var totalRaised = await campaign.GetFunction("totalRaised").CallAsync<BigInteger>();
        var totalWithdrawn = await campaign.GetFunction("totalWithdrawn").CallAsync<BigInteger>();
        var finalized = await campaign.GetFunction("finalized").CallAsync<bool>();
        var successful = await campaign.GetFunction("successful").CallAsync<bool>();
        var currentMilestone = await campaign.GetFunction("currentMilestone").CallAsync<byte>();
        var milestoneCount = await campaign.GetFunction("getMilestoneCount").CallAsync<BigInteger>();
        var milestonePercentages = await campaign.GetFunction("getMilestonePercentages").CallAsync<List<byte>>();
        var paymentToken = await campaign.GetFunction("paymentToken").CallAsync<string>();
        var receiptToken = await campaign.GetFunction("receiptToken").CallAsync<string>();

        var data = new Dictionary<string, object?>
        {
            ["creator"] = creator,
            ["softCap"] = softCap.ToString(),
            ["hardCap"] = hardCap.ToString(),
            ["deadline"] = deadline.ToString(),
            ["totalRaised"] = totalRaised.ToString(),
            ["totalWithdrawn"] = totalWithdrawn.ToString(),
            ["finalized"] = finalized,
            ["successful"] = successful,
            ["currentMilestone"] = (int)currentMilestone,
            ["milestoneCount"] = milestoneCount.ToString(),
            ["milestonePercentages"] = milestonePercentages.Select(b => (int)b).ToList(),
            ["paymentToken"] = paymentToken,
            ["receiptToken"] = receiptToken,
        };

        if (!string.IsNullOrEmpty(contributorAddress))
        {
            var contribution = await campaign.GetFunction("contributions")
                .CallAsync<BigInteger>(contributorAddress);
            data["contribution"] = contribution.ToString();
            data["contributorAddress"] = contributorAddress;
        }

        sw.Stop();

        return new TxOutput
        {
            Operation = "status",
            Status = "success",
            ElapsedMs = sw.ElapsedMilliseconds,
            Data = data,
        };
    }

    private async Task<TransactionReceipt> WaitForReceipt(string txHash, int maxAttempts = 60)
    {
        TransactionReceipt? receipt = null;
        int attempts = 0;
        while (receipt == null)
        {
            receipt = await _web3.Eth.Transactions.GetTransactionReceipt
                .SendRequestAsync(txHash);
            if (receipt == null)
            {
                if (++attempts >= maxAttempts)
                    throw new TimeoutException(
                        $"Receipt not found after {maxAttempts} attempts for {txHash}");
                await Task.Delay(100);
            }
        }
        return receipt;
    }
}
