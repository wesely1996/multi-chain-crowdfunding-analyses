using System.Diagnostics;
using Solnet.Rpc;
using Solnet.Rpc.Builders;
using Solnet.Rpc.Models;
using Solnet.Wallet;

namespace CrowdfundingClient.Solana;

public record TxResult(string Signature, long Slot, ulong Fee, long ElapsedMs, bool Success);

public static class TransactionHelper
{
    public static async Task<TxResult> SendAndConfirm(
        IRpcClient rpc, Account signer, TransactionInstruction instruction)
    {
        var recentHash = await rpc.GetLatestBlockHashAsync();

        var tx = new TransactionBuilder()
            .SetRecentBlockHash(recentHash.Result.Value.Blockhash)
            .SetFeePayer(signer)
            .AddInstruction(instruction)
            .Build(signer);

        var sw = Stopwatch.StartNew();
        var sendResult = await rpc.SendTransactionAsync(tx, skipPreflight: true);
        sw.Stop();

        if (!sendResult.WasSuccessful)
            throw new Exception($"Send failed: {sendResult.Reason}");

        var sig = sendResult.Result;

        // Poll for confirmation
        for (int i = 0; i < 30; i++)
        {
            var status = await rpc.GetSignatureStatusesAsync(new List<string> { sig });
            if (status.Result?.Value?[0] != null)
            {
                var s = status.Result.Value[0];
                if (s.ConfirmationStatus == "confirmed" || s.ConfirmationStatus == "finalized")
                    break;
            }
            await Task.Delay(500);
        }

        // Get transaction details for fee and slot
        await Task.Delay(500); // brief delay for indexing
        var txInfo = await rpc.GetTransactionAsync(sig);

        var fee = txInfo?.Result?.Meta?.Fee ?? 0;
        var slot = txInfo?.Result?.Slot ?? 0;
        var success = txInfo?.Result?.Meta?.Error == null;

        return new TxResult(sig, (long)slot, fee, sw.ElapsedMilliseconds, success);
    }
}
