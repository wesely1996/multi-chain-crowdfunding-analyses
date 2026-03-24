using System.Diagnostics;
using Solnet.Rpc;
using Solnet.Rpc.Builders;
using Solnet.Rpc.Models;
using Solnet.Wallet;

namespace CrowdfundingClient.Solana;

public record TxResult(string Signature, long Slot, ulong Fee, long ElapsedMs, bool Success, string? ErrorCode = null);

public static class TransactionHelper
{
    public static Task<TxResult> SendAndConfirm(
        IRpcClient rpc, Account signer, TransactionInstruction instruction)
        => SendAndConfirm(rpc, signer, new[] { instruction }, Array.Empty<Account>());

    public static Task<TxResult> SendAndConfirm(
        IRpcClient rpc, Account signer, TransactionInstruction instruction, Account[] extraSigners)
        => SendAndConfirm(rpc, signer, new[] { instruction }, extraSigners);

    public static async Task<TxResult> SendAndConfirm(
        IRpcClient rpc, Account signer, IEnumerable<TransactionInstruction> instructions, Account[] extraSigners)
    {
        var recentHash = await rpc.GetLatestBlockHashAsync();

        var builder = new TransactionBuilder()
            .SetRecentBlockHash(recentHash.Result.Value.Blockhash)
            .SetFeePayer(signer);
        foreach (var ix in instructions)
            builder.AddInstruction(ix);
        var allSigners = new[] { signer }.Concat(extraSigners).ToArray();
        var tx = builder.Build(allSigners);

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
        var txInfo = await rpc.GetTransactionAsync(sig, Solnet.Rpc.Types.Commitment.Confirmed);

        var fee = txInfo?.Result?.Meta?.Fee ?? 0;
        var slot = txInfo?.Result?.Slot ?? 0;
        var metaError = txInfo?.Result?.Meta?.Error;
        var success = metaError == null;

        string? errorCode = null;
        if (!success)
        {
            // Surface program error to stderr for easier debugging
            errorCode = metaError?.ToString();
            var logs = txInfo?.Result?.Meta?.LogMessages;
            if (logs != null)
            {
                foreach (var line in logs)
                    Console.Error.WriteLine($"  [log] {line}");
            }
        }

        return new TxResult(sig, (long)slot, fee, sw.ElapsedMilliseconds, success, errorCode);
    }
}
