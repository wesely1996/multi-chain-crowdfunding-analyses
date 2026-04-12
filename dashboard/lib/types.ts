export interface OperationRecord {
    name: string;
    scenario: string;
    gas_used: number | null;
    cost: string;
    latency_ms: number;
    process_elapsed_ms: number | null;
    tx_hash: string | null;
}

export interface ThroughputRecord {
    num_contributions: number;
    total_time_ms: number;
    tps: number;
    per_tx_gas?: {
        avg: number;
        min: number;
        max: number;
        stdev: number;
    };
    per_tx_fee?: {
        avg: number;
        min: number;
        max: number;
        stdev?: number;
    };
    per_tx_fee_lamports?: {
        avg: number;
        min: number;
        max: number;
        stdev?: number;
    };
}

export interface PriceSnapshot {
    eth_usd: number;
    sol_usd: number;
    usd_rsd: number;
    gas_price_gwei: number;
    fetched_at_utc: number;
}

export interface BenchmarkFile {
    schema_version: "2";
    variant: "V1" | "V2" | "V3" | "V4" | "V5";
    variant_label: string;
    client: "python" | "ts" | "dotnet";
    client_label: string;
    environment:
        | "hardhat-localnet"
        | "sepolia"
        | "solana-localnet"
        | "solana-devnet";
    platform: "EVM" | "Solana";
    chain_id?: number;
    timestamp_utc: number;
    limitations: string[];
    operations: OperationRecord[];
    throughput: ThroughputRecord;
    prices?: PriceSnapshot;
    /** Populated at load time from the filename; not present in the JSON file itself. */
    kind?: string;
}

export type RunStatus = "idle" | "running" | "success" | "error";

export interface RunState {
    id: string;
    status: RunStatus;
    output: string;
    resultFile?: string;
    startedAt: number;
    variant?: string;
    client?: string;
    environment?: string;
    kind?: string;
}
