export function formatGas(gas: number | null): string {
    if (gas === null) return "—";
    return gas.toLocaleString("en-US") + " gas";
}

export function formatFee(lamports: string | number): string {
    const val =
        typeof lamports === "string" ? parseInt(lamports, 10) : lamports;
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

export function formatUsd(
    gas: number | null,
    gweiPerGas = 1,
    ethUsd = 3000,
): string {
    if (gas === null) return "—";
    const eth = gas * gweiPerGas * 1e-9;
    const usd = eth * ethUsd;
    if (usd < 0.0001) return "< $0.0001";
    return "$" + usd.toFixed(4);
}

/** Fiat conversion assumptions — update as needed for thesis snapshots. */
export const FIAT = {
    /** Gas price assumed for EVM localnet / Sepolia estimates (gwei). */
    GAS_PRICE_GWEI: 1,
    ETH_USD: 3_000,
    SOL_USD: 170,
    /** 1 USD in RSD (Serbian Dinar). */
    USD_RSD: 108,
} as const;

/**
 * Convert a raw cost-per-TPS value to RSD.
 * @param costPerTps  raw units/TPS — gas units for EVM, lamports for Solana
 * @param platform    "EVM" | "Solana"
 * @param prices      stored price snapshot (falls back to FIAT constants if absent)
 */
export function costPerTpsToRsd(
    costPerTps: number,
    platform: "EVM" | "Solana",
    prices?: { eth_usd?: number; sol_usd?: number; usd_rsd?: number; gas_price_gwei?: number },
): string {
    const gasPriceGwei = prices?.gas_price_gwei ?? FIAT.GAS_PRICE_GWEI;
    const ethUsd       = prices?.eth_usd        ?? FIAT.ETH_USD;
    const solUsd       = prices?.sol_usd        ?? FIAT.SOL_USD;
    const usdRsd       = prices?.usd_rsd        ?? FIAT.USD_RSD;

    let rsd: number;
    if (platform === "EVM") {
        // gas → ETH → USD → RSD
        const eth = costPerTps * gasPriceGwei * 1e-9;
        rsd = eth * ethUsd * usdRsd;
    } else {
        // lamports → SOL → USD → RSD
        const sol = costPerTps * 1e-9;
        rsd = sol * solUsd * usdRsd;
    }
    if (rsd < 0.01) return "< 0.01 RSD";
    return rsd.toLocaleString("sr-RS", { maximumFractionDigits: 2 }) + " RSD";
}
