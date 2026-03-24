namespace CrowdfundingClient.Configuration;

public record SolanaConfig(
    string RpcUrl,
    string KeypairPath,
    string ProgramId,
    string PaymentMint,
    string CampaignAddress,
    ulong CampaignId,
    string Variant = "V4"
)
{
    public static SolanaConfig FromEnvironment()
    {
        var variant = Env("VARIANT", "V4");
        return new(
            RpcUrl          : Env("SOLANA_RPC_URL", "http://127.0.0.1:8899"),
            KeypairPath     : ExpandPath(Env("SOLANA_KEYPAIR_PATH",
                                 Path.Combine("~", ".config", "solana", "id.json"))),
            ProgramId       : Env($"SOLANA_PROGRAM_ID_{variant}"),
            PaymentMint     : Env("SOLANA_PAYMENT_MINT"),
            CampaignAddress : Env("SOLANA_CAMPAIGN_ADDRESS"),
            CampaignId      : ulong.Parse(Env("SOLANA_CAMPAIGN_ID", "0")),
            Variant         : variant
        );
    }

    private static string Env(string n, string d = "") =>
        Environment.GetEnvironmentVariable(n) ?? d;

    private static string ExpandPath(string path) =>
        path.StartsWith("~")
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                           path[2..])
            : path;
}
