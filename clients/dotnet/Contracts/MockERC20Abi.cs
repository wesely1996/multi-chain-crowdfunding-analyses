namespace CrowdfundingClient.Contracts;

public static class MockERC20Abi
{
    public const string ABI = @"[
        {
            ""inputs"": [
                { ""name"": ""spender"", ""type"": ""address"" },
                { ""name"": ""value"", ""type"": ""uint256"" }
            ],
            ""name"": ""approve"",
            ""outputs"": [{ ""name"": """", ""type"": ""bool"" }],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        },
        {
            ""inputs"": [{ ""name"": ""account"", ""type"": ""address"" }],
            ""name"": ""balanceOf"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"",
            ""type"": ""function""
        },
        {
            ""inputs"": [],
            ""name"": ""decimals"",
            ""outputs"": [{ ""name"": """", ""type"": ""uint8"" }],
            ""stateMutability"": ""pure"",
            ""type"": ""function""
        },
        {
            ""inputs"": [
                { ""name"": ""to"", ""type"": ""address"" },
                { ""name"": ""amount"", ""type"": ""uint256"" }
            ],
            ""name"": ""mint"",
            ""outputs"": [],
            ""stateMutability"": ""nonpayable"",
            ""type"": ""function""
        }
    ]";
}
