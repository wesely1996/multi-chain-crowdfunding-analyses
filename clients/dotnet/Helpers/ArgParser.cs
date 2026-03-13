using System.Numerics;

namespace CrowdfundingClient.Helpers;

public static class ArgParser
{
    public static string Env(string name, string defaultValue = "")
        => Environment.GetEnvironmentVariable(name) ?? defaultValue;

    public static string ParseArg(string[] args, string name, string defaultValue)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name)
                return args[i + 1];
        }
        return defaultValue;
    }

    public static string? ParseArgOrNull(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name)
                return args[i + 1];
        }
        return null;
    }

    public static BigInteger ParseBigInt(string[] args, string name, string defaultValue)
        => BigInteger.Parse(ParseArg(args, name, defaultValue));

    public static List<byte> ParseMilestones(string[] args, string name, string defaultValue)
    {
        var raw = ParseArg(args, name, defaultValue);
        return raw.Split(',').Select(s => byte.Parse(s.Trim())).ToList();
    }

    public static byte[] ParseMilestoneBytes(string[] args, string name, string defaultValue)
    {
        var raw = ParseArg(args, name, defaultValue);
        return raw.Split(',').Select(s => byte.Parse(s.Trim())).ToArray();
    }

    public static ulong? ParseULongOrNull(string[] args, string name)
    {
        var val = ParseArgOrNull(args, name);
        return val != null ? ulong.Parse(val) : null;
    }

    public static string EnvOrNull(string name)
        => Environment.GetEnvironmentVariable(name) ?? "";
}
