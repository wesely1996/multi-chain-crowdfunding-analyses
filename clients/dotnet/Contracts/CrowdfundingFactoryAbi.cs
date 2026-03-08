namespace CrowdfundingClient.Contracts;

public static class CrowdfundingFactoryAbi
{
    public const string ABI = @"[
        {
            ""anonymous"": false,
            ""inputs"": [
                { ""indexed"": true, ""name"": ""campaign"", ""type"": ""address"" },
                { ""indexed"": true, ""name"": ""creator"", ""type"": ""address"" },
                { ""indexed"": true, ""name"": ""paymentToken"", ""type"": ""address"" }
            ],
            ""name"": ""CampaignCreated"",
            ""type"": ""event""
        },
        {
            ""inputs"": [
                { ""name"": ""paymentToken"", ""type"": ""address"" },
                { ""name"": ""softCap"", ""type"": ""uint256"" },
                { ""name"": ""hardCap"", ""type"": ""uint256"" },
                { ""name"": ""deadline"", ""type"": ""uint256"" },
                { ""name"": ""milestonePercentages"", ""type"": ""uint8[]"" },
                { ""name"": ""tokenName"", ""type"": ""string"" },
                { ""name"": ""tokenSymbol"", ""type"": ""string"" }
            ],
            ""name"": ""createCampaign"",
            ""outputs"": [
                { ""name"": ""campaign"", ""type"": ""address"" }
            ],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""getCampaignCount"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        }
    ]";
}
