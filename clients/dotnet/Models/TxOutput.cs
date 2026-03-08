using System.Text.Json;
using System.Text.Json.Serialization;

namespace CrowdfundingClient.Models;

public class TxOutput
{
    [JsonPropertyName("chain")]
    public string Chain { get; set; } = "evm";

    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";

    [JsonPropertyName("txHash")]
    public string? TxHash { get; set; }

    [JsonPropertyName("blockNumber")]
    public long? BlockNumber { get; set; }

    [JsonPropertyName("gasUsed")]
    public long? GasUsed { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "success";

    [JsonPropertyName("timestamp")]
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");

    [JsonPropertyName("elapsedMs")]
    public long ElapsedMs { get; set; }

    [JsonPropertyName("data")]
    public Dictionary<string, object?> Data { get; set; } = new();
}
