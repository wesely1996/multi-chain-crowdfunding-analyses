using System.Numerics;
using dotenv.net;
using CrowdfundingClient.Helpers;
using CrowdfundingClient.Services;

DotEnv.Load();

var rpcUrl = Env("RPC_URL", "http://127.0.0.1:8545");
var chainId = int.Parse(Env("CHAIN_ID", "31337"));
var privateKey = Env("PRIVATE_KEY");
var factoryAddress = Env("FACTORY_ADDRESS");
var campaignAddress = Env("CAMPAIGN_ADDRESS");
var paymentTokenAddress = Env("PAYMENT_TOKEN_ADDRESS");

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: dotnet run -- <command> [options]");
    Console.Error.WriteLine("Commands: create-campaign, contribute, finalize, withdraw, refund, status");
    Environment.Exit(1);
}

var command = args[0];
var service = new EvmCampaignService(rpcUrl, privateKey, chainId,
    factoryAddress, campaignAddress, paymentTokenAddress);

try
{
    var result = command switch
    {
        "create-campaign" => await service.CreateCampaign(
            ParseBigInt(args, "--soft-cap", "100000000"),
            ParseBigInt(args, "--hard-cap", "500000000"),
            BigInteger.Parse(
                (DateTimeOffset.UtcNow.ToUnixTimeSeconds() +
                 long.Parse(ParseArg(args, "--deadline-days", "30")) * 86400).ToString()),
            ParseMilestones(args, "--milestones", "30,30,40"),
            ParseArg(args, "--token-name", "Campaign Receipt Token"),
            ParseArg(args, "--token-symbol", "CRT")),

        "contribute" => await service.Contribute(
            ParseBigInt(args, "--amount", "10000000")),

        "finalize" => await service.Finalize(),
        "withdraw" => await service.Withdraw(),
        "refund" => await service.Refund(),

        "status" => await service.GetStatus(
            ParseArgOrNull(args, "--contributor")),

        _ => throw new ArgumentException($"Unknown command: {command}")
    };

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
