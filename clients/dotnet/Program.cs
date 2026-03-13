using System.Numerics;
using dotenv.net;
using CrowdfundingClient.Configuration;
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
        var solService = new SolanaCampaignService(SolanaConfig.FromEnvironment());

        result = command switch
        {
            "sol:create-campaign" => await solService.CreateCampaign(
                ulong.Parse(ArgParser.ParseArg(args, "--soft-cap", "100000000")),
                ulong.Parse(ArgParser.ParseArg(args, "--hard-cap", "500000000")),
                DateTimeOffset.UtcNow.ToUnixTimeSeconds() +
                    long.Parse(ArgParser.ParseArg(args, "--deadline-seconds", "1800")),
                ArgParser.ParseMilestoneBytes(args, "--milestones", "30,30,40"),
                ArgParser.ParseULongOrNull(args, "--campaign-id")),

            "sol:contribute" => await solService.Contribute(
                ulong.Parse(ArgParser.ParseArg(args, "--amount", "10000000")),
                ArgParser.ParseArgOrNull(args, "--campaign")),

            "sol:finalize" => await solService.Finalize(
                ArgParser.ParseArgOrNull(args, "--campaign")),

            "sol:withdraw" => await solService.Withdraw(
                ArgParser.ParseArgOrNull(args, "--campaign")),

            "sol:refund" => await solService.Refund(
                ArgParser.ParseArgOrNull(args, "--campaign")),

            "sol:status" => await solService.GetStatus(
                ArgParser.ParseArgOrNull(args, "--campaign"),
                ArgParser.ParseArgOrNull(args, "--contributor")),

            _ => throw new ArgumentException($"Unknown command: {command}")
        };
    }
    else
    {
        var evmService = new EvmCampaignService(EvmConfig.FromEnvironment());

        result = command switch
        {
            "create-campaign" => await evmService.CreateCampaign(
                ArgParser.ParseBigInt(args, "--soft-cap", "100000000"),
                ArgParser.ParseBigInt(args, "--hard-cap", "500000000"),
                BigInteger.Parse(
                    (DateTimeOffset.UtcNow.ToUnixTimeSeconds() +
                     long.Parse(ArgParser.ParseArg(args, "--deadline-days", "30")) * 86400).ToString()),
                ArgParser.ParseMilestones(args, "--milestones", "30,30,40"),
                ArgParser.ParseArg(args, "--token-name", "Campaign Receipt Token"),
                ArgParser.ParseArg(args, "--token-symbol", "CRT")),

            "contribute" => await evmService.Contribute(
                ArgParser.ParseBigInt(args, "--amount", "10000000")),

            "finalize" => await evmService.Finalize(),
            "withdraw" => await evmService.Withdraw(),
            "refund" => await evmService.Refund(),

            "status" => await evmService.GetStatus(
                ArgParser.ParseArgOrNull(args, "--contributor")),

            _ => throw new ArgumentException($"Unknown command: {command}")
        };
    }

    OutputHelper.Print(result);
}
catch (Exception ex)
{
    var chain = command.StartsWith("sol:") ? "solana" : "evm";
    OutputHelper.PrintError(command, ex, chain);
}
