namespace CrowdfundingClient.Contracts;

public static class CrowdfundingCampaignAbi
{
    public const string ABI = @"[
        {
            ""anonymous"": false,
            ""inputs"": [
                { ""indexed"": true, ""name"": ""contributor"", ""type"": ""address"" },
                { ""indexed"": false, ""name"": ""amount"", ""type"": ""uint256"" },
                { ""indexed"": false, ""name"": ""totalRaised"", ""type"": ""uint256"" }
            ],
            ""name"": ""Contributed"",
            ""type"": ""event""
        },
        {
            ""anonymous"": false,
            ""inputs"": [
                { ""indexed"": false, ""name"": ""successful"", ""type"": ""bool"" },
                { ""indexed"": false, ""name"": ""totalRaised"", ""type"": ""uint256"" }
            ],
            ""name"": ""Finalized"",
            ""type"": ""event""
        },
        {
            ""anonymous"": false,
            ""inputs"": [
                { ""indexed"": true, ""name"": ""milestoneIndex"", ""type"": ""uint256"" },
                { ""indexed"": false, ""name"": ""amount"", ""type"": ""uint256"" },
                { ""indexed"": false, ""name"": ""recipient"", ""type"": ""address"" }
            ],
            ""name"": ""MilestoneWithdrawn"",
            ""type"": ""event""
        },
        {
            ""anonymous"": false,
            ""inputs"": [
                { ""indexed"": true, ""name"": ""contributor"", ""type"": ""address"" },
                { ""indexed"": false, ""name"": ""amount"", ""type"": ""uint256"" }
            ],
            ""name"": ""Refunded"",
            ""type"": ""event""
        },
        {
            ""inputs"": [{ ""name"": ""amount"", ""type"": ""uint256"" }],
            ""name"": ""contribute"",
            ""outputs"": [],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        },
        {
            ""inputs"": [{ ""name"": """", ""type"": ""address"" }],
            ""name"": ""contributions"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""creator"",
            ""outputs"": [{ ""name"": """", ""type"": ""address"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""currentMilestone"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint8"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""deadline"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""finalize"",
            ""outputs"": [],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""finalized"",
            ""outputs"": [{ ""name"": """", ""type"": ""bool"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""getMilestoneCount"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""getMilestonePercentages"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint8[]"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""hardCap"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""paymentToken"",
            ""outputs"": [{ ""name"": """", ""type"": ""address"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""receiptToken"",
            ""outputs"": [{ ""name"": """", ""type"": ""address"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""refund"",
            ""outputs"": [],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""softCap"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""successful"",
            ""outputs"": [{ ""name"": """", ""type"": ""bool"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""totalRaised"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""totalWithdrawn"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""withdrawMilestone"",
            ""outputs"": [],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        }
    ]";
}
