using System.Numerics;
using dotenv.net;
using CrowdfundingClient.Configuration;
using CrowdfundingClient.Helpers;
using CrowdfundingClient.Models;
using CrowdfundingClient.Services;

DotEnv.Load(options: new DotEnvOptions(envFilePaths: new[] { "../../.env" }, overwriteExistingVars: false));

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: dotnet run -- <command> [options]");
    Console.Error.WriteLine("EVM:    create-campaign, contribute, finalize, withdraw, refund, status");
    Console.Error.WriteLine("Solana: sol:create-campaign, sol:contribute, sol:finalize, sol:withdraw, sol:refund, sol:status");
    Environment.Exit(1);
}

const long USDC = 1_000_000; // 6 decimals

var command = args[0];

try
{
    TxOutput result;

    if (command.StartsWith("sol:"))
    {
        var solService = new SolanaCampaignService(SolanaConfig.FromEnvironment());

        result = command switch
        {
            "sol:create-mint" => await solService.CreateMint(),

            "sol:create-campaign" => await solService.CreateCampaign(
                (ulong)(double.Parse(ArgParser.ParseArg(args, "--soft-cap", "100")) * USDC),
                (ulong)(double.Parse(ArgParser.ParseArg(args, "--hard-cap", "500")) * USDC),
                long.Parse(ArgParser.ParseArg(args, "--deadline-seconds", "1800")),
                ArgParser.ParseMilestoneBytes(args, "--milestones", "30,30,40"),
                ArgParser.ParseULongOrNull(args, "--campaign-id")),

            "sol:contribute" => await solService.Contribute(
                (ulong)(double.Parse(ArgParser.ParseArg(args, "--amount", "10")) * USDC),
                ArgParser.ParseArgOrNull(args, "--campaign")),

            "sol:finalize" => await solService.Finalize(
                ArgParser.ParseArgOrNull(args, "--campaign"),
                args.Contains("--advance-time")),

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

        // Use node's block timestamp — Hardhat time drifts after evm_increaseTime calls
        var nodeNow = command == "create-campaign" ? await evmService.GetNodeTimestamp() : 0;

        result = command switch
        {
            "create-campaign" => await evmService.CreateCampaign(
                new BigInteger((long)(double.Parse(ArgParser.ParseArg(args, "--soft-cap", "100")) * USDC)),
                new BigInteger((long)(double.Parse(ArgParser.ParseArg(args, "--hard-cap", "500")) * USDC)),
                BigInteger.Parse(
                    (nodeNow +
                     long.Parse(ArgParser.ParseArg(args, "--deadline-days", "30")) * 86400).ToString()),
                ArgParser.ParseMilestones(args, "--milestones", "30,30,40"),
                ArgParser.ParseArg(args, "--token-name", "Campaign Receipt Token"),
                ArgParser.ParseArg(args, "--token-symbol", "CRT")),

            "contribute" => await evmService.Contribute(
                new BigInteger((long)(double.Parse(ArgParser.ParseArg(args, "--amount", "10")) * USDC)),
                ArgParser.ParseBigIntOrNull(args, "--tier-id")),

            "finalize" => await evmService.Finalize(args.Contains("--advance-time")),
            "withdraw" => await evmService.Withdraw(),
            "refund" => await evmService.Refund(
                ArgParser.ParseBigIntOrNull(args, "--tier-id")),

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
