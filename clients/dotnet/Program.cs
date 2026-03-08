using System.Numerics;
using dotenv.net;
using CrowdfundingClient.Helpers;
using CrowdfundingClient.Models;
using CrowdfundingClient.Services;

DotEnv.Load();

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: dotnet run -- <command> [options]");
    Console.Error.WriteLine("EVM:    create-campaign, contribute, finalize, withdraw, refund, status");
    Console.Error.WriteLine("Solana: sol:create-campaign, sol:contribute, sol:finalize, sol:withdraw, sol:refund, sol:status");
    Environment.Exit(1);
}

var command = args[0];

try
{
    TxOutput result;

    if (command.StartsWith("sol:"))
    {
        var solRpcUrl = Env("SOLANA_RPC_URL", "http://127.0.0.1:8899");
        var solKeypairPath = Env("SOLANA_KEYPAIR_PATH");
        var solProgramId = Env("SOLANA_PROGRAM_ID");
        var solPaymentMint = Env("SOLANA_PAYMENT_MINT");
        var solCampaignAddress = Env("SOLANA_CAMPAIGN_ADDRESS");
        var solCampaignId = ulong.Parse(Env("SOLANA_CAMPAIGN_ID", "0"));

        var solService = new SolanaCampaignService(solRpcUrl, solKeypairPath, solProgramId,
            solPaymentMint, solCampaignAddress, solCampaignId);

        result = command switch
        {
            "sol:create-campaign" => await solService.CreateCampaign(
                ulong.Parse(ParseArg(args, "--soft-cap", "100000000")),
                ulong.Parse(ParseArg(args, "--hard-cap", "500000000")),
                DateTimeOffset.UtcNow.ToUnixTimeSeconds() +
                    long.Parse(ParseArg(args, "--deadline-seconds", "1800")),
                ParseMilestoneBytes(args, "--milestones", "30,30,40"),
                ParseULongOrNull(args, "--campaign-id")),

            "sol:contribute" => await solService.Contribute(
                ulong.Parse(ParseArg(args, "--amount", "10000000")),
                ParseArgOrNull(args, "--campaign")),

            "sol:finalize" => await solService.Finalize(
                ParseArgOrNull(args, "--campaign")),

            "sol:withdraw" => await solService.Withdraw(
                ParseArgOrNull(args, "--campaign")),

            "sol:refund" => await solService.Refund(
                ParseArgOrNull(args, "--campaign")),

            "sol:status" => await solService.GetStatus(
                ParseArgOrNull(args, "--campaign"),
                ParseArgOrNull(args, "--contributor")),

            _ => throw new ArgumentException($"Unknown command: {command}")
        };
    }
    else
    {
        var rpcUrl = Env("RPC_URL", "http://127.0.0.1:8545");
        var chainId = int.Parse(Env("CHAIN_ID", "31337"));
        var privateKey = Env("PRIVATE_KEY");
        var factoryAddress = Env("FACTORY_ADDRESS");
        var campaignAddress = Env("CAMPAIGN_ADDRESS");
        var paymentTokenAddress = Env("PAYMENT_TOKEN_ADDRESS");

        var evmService = new EvmCampaignService(rpcUrl, privateKey, chainId,
            factoryAddress, campaignAddress, paymentTokenAddress);

        result = command switch
        {
            "create-campaign" => await evmService.CreateCampaign(
                ParseBigInt(args, "--soft-cap", "100000000"),
                ParseBigInt(args, "--hard-cap", "500000000"),
                BigInteger.Parse(
                    (DateTimeOffset.UtcNow.ToUnixTimeSeconds() +
                     long.Parse(ParseArg(args, "--deadline-days", "30")) * 86400).ToString()),
                ParseMilestones(args, "--milestones", "30,30,40"),
                ParseArg(args, "--token-name", "Campaign Receipt Token"),
                ParseArg(args, "--token-symbol", "CRT")),

            "contribute" => await evmService.Contribute(
                ParseBigInt(args, "--amount", "10000000")),

            "finalize" => await evmService.Finalize(),
            "withdraw" => await evmService.Withdraw(),
            "refund" => await evmService.Refund(),

            "status" => await evmService.GetStatus(
                ParseArgOrNull(args, "--contributor")),

            _ => throw new ArgumentException($"Unknown command: {command}")
        };
    }

    OutputHelper.Print(result);
}
catch (Exception ex)
{
    OutputHelper.PrintError(command, ex);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

static string Env(string name, string defaultValue = "")
{
    return Environment.GetEnvironmentVariable(name) ?? defaultValue;
}

static string ParseArg(string[] args, string name, string defaultValue)
{
    for (int i = 0; i < args.Length - 1; i++)
    {
        if (args[i] == name)
            return args[i + 1];
    }
    return defaultValue;
}

static string? ParseArgOrNull(string[] args, string name)
{
    for (int i = 0; i < args.Length - 1; i++)
    {
        if (args[i] == name)
            return args[i + 1];
    }
    return null;
}

static BigInteger ParseBigInt(string[] args, string name, string defaultValue)
{
    return BigInteger.Parse(ParseArg(args, name, defaultValue));
}

static List<byte> ParseMilestones(string[] args, string name, string defaultValue)
{
    var raw = ParseArg(args, name, defaultValue);
    return raw.Split(',').Select(s => byte.Parse(s.Trim())).ToList();
}

static byte[] ParseMilestoneBytes(string[] args, string name, string defaultValue)
{
    var raw = ParseArg(args, name, defaultValue);
    return raw.Split(',').Select(s => byte.Parse(s.Trim())).ToArray();
}

static ulong? ParseULongOrNull(string[] args, string name)
{
    var val = ParseArgOrNull(args, name);
    return val != null ? ulong.Parse(val) : null;
}
