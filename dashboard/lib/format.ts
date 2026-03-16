export function formatGas(gas: number | null): string {
  if (gas === null) return "—";
  return gas.toLocaleString("en-US") + " gas";
}

export function formatFee(lamports: string | number): string {
  const val = typeof lamports === "string" ? parseInt(lamports, 10) : lamports;
  if (isNaN(val)) return "—";
  return val.toLocaleString("en-US") + " lam";
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + " s";
  return ms.toFixed(0) + " ms";
}

export function formatTps(tps: number): string {
  return tps.toFixed(2) + " TPS";
}

export function formatUsd(gas: number | null, gweiPerGas = 1, ethUsd = 3000): string {
  if (gas === null) return "—";
  const eth = (gas * gweiPerGas * 1e-9);
  const usd = eth * ethUsd;
  if (usd < 0.0001) return "< $0.0001";
  return "$" + usd.toFixed(4);
}
