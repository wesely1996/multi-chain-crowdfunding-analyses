export interface TxOutput {
  chain: "evm" | "solana";
  operation: string;
  txHash: string | null;
  blockNumber: number | null;
  gasUsed: number | null;
  status: "success" | "reverted";
  timestamp: string;
  elapsedMs: number;
  data: Record<string, unknown>;
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function printResult(output: TxOutput): void {
  console.log(JSON.stringify(output, bigIntReplacer, 2));
}

export function printError(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const output: TxOutput = {
    chain: "evm",
    operation,
    txHash: null,
    blockNumber: null,
    gasUsed: null,
    status: "reverted",
    timestamp: new Date().toISOString(),
    elapsedMs: 0,
    data: { error: message },
  };
  console.error(JSON.stringify(output, bigIntReplacer, 2));
  process.exit(1);
}
