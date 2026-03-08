using System.Text.Json;
using CrowdfundingClient.Models;

namespace CrowdfundingClient.Helpers;

public static class OutputHelper
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static void Print(TxOutput output)
    {
        Console.WriteLine(JsonSerializer.Serialize(output, JsonOptions));
    }

    public static void PrintError(string operation, Exception ex)
    {
        var output = new TxOutput
        {
            Chain = "evm",
            Operation = operation,
            Status = "reverted",
            Timestamp = DateTime.UtcNow.ToString("o"),
            Data = new Dictionary<string, object?> { ["error"] = ex.Message }
        };
        Console.Error.WriteLine(JsonSerializer.Serialize(output, JsonOptions));
        Environment.Exit(1);
    }
}
