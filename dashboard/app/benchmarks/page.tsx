import Link from "next/link";
import { loadResults } from "@/lib/load-results";
import { ComparisonTable } from "@/components/ComparisonTable";
import { GasChart } from "@/components/GasChart";
import { LatencyChart } from "@/components/LatencyChart";
import { ThroughputChart } from "@/components/ThroughputChart";

export default async function BenchmarksPage() {
  const results = loadResults();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-gray-400 hover:text-white">
        ← Back to Home
      </Link>

      <div className="mt-6 mb-2">
        <h1 className="text-3xl font-bold text-white">Benchmark Results</h1>
        <p className="mt-1 text-sm text-gray-400">
          Comparison across variants, clients, and environments
        </p>
      </div>

      {results.length === 0 ? (
        <div className="mt-8 flex items-center justify-center rounded-lg bg-gray-900 border border-gray-700 p-12">
          <p className="text-gray-400 text-sm text-center">
            No benchmark results yet. Run a benchmark from the Run page.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <section className="rounded-lg bg-gray-900 border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Operation Comparison
            </h2>
            <ComparisonTable results={results} />
          </section>

          <section className="rounded-lg bg-gray-900 border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Gas &amp; Fee by Operation
            </h2>
            <GasChart results={results} />
          </section>

          <section className="rounded-lg bg-gray-900 border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Latency by Operation
            </h2>
            <LatencyChart results={results} />
          </section>

          <section className="rounded-lg bg-gray-900 border border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Throughput (TPS)
            </h2>
            <ThroughputChart results={results} />
          </section>
        </div>
      )}
    </div>
  );
}
