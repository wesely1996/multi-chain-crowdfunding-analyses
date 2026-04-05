"use client";

import { useCallback, useEffect, useState } from "react";
import { BenchmarkFile } from "@/lib/types";
import { formatGas, formatMs, formatTps, costPerTpsToRsd } from "@/lib/format";
import { MetricCard } from "@/components/MetricCard";
import FilterBar from "@/components/FilterBar";
import OperationsTable from "@/components/OperationsTable";
import CompareChart from "@/components/CompareChart";
import RunPanel from "@/components/RunPanel";

// Cost-to-performance ratio: average fee units per TPS.
// The core thesis metric — how much does each unit of throughput cost on each chain?
function deriveCostPerTps(result: BenchmarkFile): { raw: string; rsd: string } {
  // Throughput runs store avg cost directly; lifecycle runs don't — derive from operations.
  const gasAvg = result.throughput.per_tx_gas?.avg ?? null;
  const feeAvg = (result.throughput.per_tx_fee ?? result.throughput.per_tx_fee_lamports)?.avg ?? null;
  let costUnit = gasAvg ?? feeAvg;

  if (costUnit === null) {
    const contributes = result.operations.filter((op) => op.name === "contribute");
    if (contributes.length > 0) {
      const costs = contributes.map((op) =>
        result.platform === "EVM"
          ? (op.gas_used ?? parseInt(op.cost, 10))
          : parseInt(op.cost, 10)
      ).filter((v) => !isNaN(v));
      if (costs.length > 0) costUnit = costs.reduce((a, b) => a + b, 0) / costs.length;
    }
  }

  if (costUnit === null || result.throughput.tps === 0) return { raw: "—", rsd: "—" };
  const costPerTps = costUnit / result.throughput.tps;
  return {
    raw: costPerTps.toLocaleString("en-US", { maximumFractionDigits: 0 }),
    rsd: costPerTpsToRsd(costPerTps, result.platform, result.prices),
  };
}

function formatTimestamp(utcSeconds: number): string {
  return new Date(utcSeconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-10 text-center">
      <p className="text-gray-400 font-medium">No benchmark results found</p>
      <p className="text-sm text-gray-600 mt-1">
        Use the Run Benchmark panel to generate results, or verify that{" "}
        <code className="text-gray-500">benchmarks/results/</code> contains
        valid JSON files.
      </p>
    </div>
  );
}

interface ResultCardProps {
  result: BenchmarkFile;
  isSelected: boolean;
  onClick: () => void;
}

function ResultCard({ result, isSelected, onClick }: ResultCardProps) {
  const costTps = deriveCostPerTps(result);
  const platformBadge =
    result.platform === "EVM"
      ? "bg-blue-900/40 text-blue-400"
      : "bg-purple-900/40 text-purple-400";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-4 transition-colors ${
        isSelected
          ? "border-blue-500 bg-gray-800"
          : "border-gray-700 bg-gray-900 hover:border-gray-600"
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <span className="font-mono text-sm font-semibold text-white">
          {result.variant} · {result.client}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded font-mono ${platformBadge}`}
        >
          {result.platform}
        </span>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {result.environment} - {formatTimestamp(result.timestamp_utc)}
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">TPS</span>
          <span className="font-mono text-green-400">
            {formatTps(result.throughput.tps)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Ops</span>
          <span className="font-mono text-gray-300">
            {result.operations.length}
          </span>
        </div>
        <div className="flex justify-between col-span-2">
          <span className="text-gray-500">Cost/TPS</span>
          <span className="font-mono text-yellow-400">{costTps.raw}</span>
        </div>
        <div className="flex justify-between col-span-2">
          <span className="text-gray-500">≈ RSD</span>
          <span className="font-mono text-yellow-300/70">{costTps.rsd}</span>
        </div>
      </div>
    </button>
  );
}

interface ResultDetailProps {
  result: BenchmarkFile;
}

function ResultDetail({ result }: ResultDetailProps) {
  const costTps = deriveCostPerTps(result);
  const isEvm = result.platform === "EVM";

  const avgFeeLabel = isEvm ? "Avg Gas/Tx" : "Avg Fee/Tx";
  const avgFeeValue = isEvm
    ? formatGas(result.throughput.per_tx_gas?.avg ?? null)
    : (result.throughput.per_tx_fee ?? result.throughput.per_tx_fee_lamports)
      ? ((result.throughput.per_tx_fee ?? result.throughput.per_tx_fee_lamports)!.avg.toLocaleString("en-US") + " lam")
      : "—";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xs uppercase tracking-widest text-gray-500">
          Detail — {result.variant} / {result.client} / {result.environment}
        </h2>
        <span className="text-xs text-gray-600">
          {formatTimestamp(result.timestamp_utc)}
        </span>
      </div>

      {/* Key metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Throughput"
          value={result.throughput.tps.toFixed(2)}
          unit="TPS"
          variant={result.variant}
        />
        <MetricCard
          label="Total Time"
          value={formatMs(result.throughput.total_time_ms)}
          variant={result.variant}
        />
        <MetricCard
          label="Contributions"
          value={String(result.throughput.num_contributions)}
          variant={result.variant}
        />
        <MetricCard
          label={avgFeeLabel}
          value={avgFeeValue}
          variant={result.variant}
        />
      </div>

      {/* Cost-to-performance highlight — the thesis' primary comparison metric */}
      <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/10 px-4 py-3 flex items-center gap-4">
        <div>
          <p className="text-xs text-yellow-500 font-medium uppercase tracking-wide">
            Cost-to-Performance Ratio
          </p>
          <p className="text-xs text-yellow-300/60 mt-0.5">
            Avg fee units ÷ TPS — lower = more efficient per unit of throughput
          </p>
          {result.prices && (
            <p className="text-xs text-yellow-300/40 mt-0.5">
              Prices at run time — ETH ${result.prices.eth_usd.toLocaleString()} · SOL ${result.prices.sol_usd} · 1 USD = {result.prices.usd_rsd} RSD
            </p>
          )}
        </div>
        <div className="ml-auto text-right">
          <span className="font-mono text-xl font-bold text-yellow-400">
            {costTps.raw}
          </span>
          <p className="font-mono text-sm text-yellow-300/70 mt-0.5">
            ≈ {costTps.rsd}
          </p>
        </div>
      </div>

      {/* Limitations */}
      {result.limitations.length > 0 && (
        <div className="rounded border border-orange-900 bg-orange-900/10 px-4 py-3">
          <p className="text-xs text-orange-400 font-medium mb-1">
            Limitations
          </p>
          <ul className="space-y-0.5">
            {result.limitations.map((note, i) => (
              <li key={i} className="text-xs text-orange-300/70">
                • {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Per-operation breakdown */}
      <div>
        <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">
          Operations
        </h3>
        <OperationsTable
          operations={result.operations}
          platform={result.platform}
        />
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [results, setResults] = useState<BenchmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [variant, setVariant] = useState("all");
  const [client, setClient] = useState("all");
  const [environment, setEnvironment] = useState("all");

  const [selected, setSelected] = useState<BenchmarkFile | null>(null);

  const fetchResults = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch("/api/benchmarks");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: BenchmarkFile[] = await res.json();
      setResults(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const filtered = results.filter((r) => {
    if (variant !== "all" && r.variant !== variant) return false;
    if (client !== "all" && r.client !== client) return false;
    if (environment !== "all" && r.environment !== environment) return false;
    return true;
  });

  // Deduplicated view for result cards — latest per (variant, client, environment, kind).
  const latestFiltered = (() => {
    const seen = new Map<string, BenchmarkFile>();
    for (const r of filtered) {
      const key = `${r.variant}_${r.client}_${r.environment}_${r.kind}`;
      const existing = seen.get(key);
      if (!existing || r.timestamp_utc > existing.timestamp_utc)
        seen.set(key, r);
    }
    return Array.from(seen.values()).sort(
      (a, b) => b.timestamp_utc - a.timestamp_utc,
    );
  })();

  // Keep the selected result valid after filter or data changes
  useEffect(() => {
    if (!selected || !filtered.includes(selected)) {
      setSelected(filtered[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, client, environment, results]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-bold font-mono text-white tracking-tight">
          Multi-Chain Crowdfunding Benchmark Dashboard
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          EVM (Sepolia) vs Solana (Devnet) — gas · latency · throughput · cost
          efficiency
        </p>
      </header>

      <div className="flex flex-col xl:flex-row min-h-[calc(100vh-65px)]">
        {/* ── Main content ── */}
        <main className="flex-1 p-6 space-y-6 min-w-0">
          <FilterBar
            results={results}
            variant={variant}
            setVariant={setVariant}
            client={client}
            setClient={setClient}
            environment={environment}
            setEnvironment={setEnvironment}
            onRefresh={fetchResults}
          />

          {loading && (
            <p className="text-sm text-gray-500 animate-pulse">
              Loading results…
            </p>
          )}

          {fetchError && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-4 py-2">
              Failed to load results: {fetchError}
            </p>
          )}

          {!loading && !fetchError && filtered.length === 0 && <EmptyState />}

          {filtered.length > 0 && (
            <>
              {/* Clickable result cards — latest run per (variant, client, environment, kind) */}
              <section>
                <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-3">
                  Results ({latestFiltered.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[340px] overflow-y-auto pr-1">
                  {latestFiltered.map((r) => (
                    <ResultCard
                      key={r.timestamp_utc}
                      result={r}
                      isSelected={selected === r}
                      onClick={() => setSelected(r)}
                    />
                  ))}
                </div>
              </section>

              {/* Comparative Analysis — all runs passed so average mode uses full history */}
              {latestFiltered.length > 1 && <CompareChart results={filtered} />}

              {/* Full detail for the selected result */}
              {selected && <ResultDetail result={selected} />}
            </>
          )}
        </main>

        {/* ── Run sidebar ── */}
        <aside className="xl:w-80 shrink-0 border-t xl:border-t-0 xl:border-l border-gray-800">
          <RunPanel onRunComplete={fetchResults} />
        </aside>
      </div>
    </div>
  );
}
