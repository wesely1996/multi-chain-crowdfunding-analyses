namespace CrowdfundingClient.Configuration;

public record EvmConfig(
    string RpcUrl,
    string PrivateKey,
    int ChainId,
    string FactoryAddress,
    string CampaignAddress,
    string PaymentTokenAddress,
    string Variant = "V1",
    // Gas limits — tunable without recompilation
    long GasCreateCampaign = 3_000_000,
    long GasContribute     = 300_000,
    long GasApprove        = 200_000,
    long GasFinalize       = 200_000,
    long GasWithdraw       = 300_000,
    long GasRefund         = 300_000
)
{
    public static EvmConfig FromEnvironment()
    {
        var variant = Env("VARIANT", "V1");
        return new(
            RpcUrl              : Env("RPC_URL", "http://127.0.0.1:8545"),
            PrivateKey          : Env("PRIVATE_KEY"),
            ChainId             : int.Parse(Env("CHAIN_ID", "31337")),
            FactoryAddress      : Env($"FACTORY_ADDRESS_{variant}"),
            CampaignAddress     : Env($"CAMPAIGN_ADDRESS_{variant}"),
            PaymentTokenAddress : Env("PAYMENT_TOKEN_ADDRESS"),
            Variant             : variant
        );
    }

    private static string Env(string n, string d = "") =>
        Environment.GetEnvironmentVariable(n) ?? d;
}
