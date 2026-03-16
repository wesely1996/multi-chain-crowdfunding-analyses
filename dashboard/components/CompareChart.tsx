"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { BenchmarkFile } from "@/lib/types";
import { VARIANT_COLORS, TOOLTIP_STYLE } from "@/lib/chart-constants";

interface Props {
  results: BenchmarkFile[];
}

// Cost-to-performance: fee paid per transaction divided by TPS.
// Lower is better — measures how efficiently the network delivers throughput per fee unit.
function costPerTps(r: BenchmarkFile): number | null {
  const gasAvg = r.throughput.per_tx_gas?.avg ?? null;
  const feeAvg = r.throughput.per_tx_fee?.avg ?? null;
  const cost = gasAvg ?? feeAvg;
  if (cost === null || r.throughput.tps === 0) return null;
  return parseFloat((cost / r.throughput.tps).toFixed(2));
}

function buildLabel(r: BenchmarkFile): string {
  return `${r.variant}/${r.client}`;
}

export default function CompareChart({ results }: Props) {
  const tpsData = results.map((r) => ({
    name: buildLabel(r),
    tps: parseFloat(r.throughput.tps.toFixed(2)),
    variant: r.variant,
  }));

  const costData = results
    .map((r) => ({ name: buildLabel(r), cost: costPerTps(r), variant: r.variant }))
    .filter((d) => d.cost !== null);

  return (
    <section className="space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-gray-500">
        Comparative Analysis
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TPS chart */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-400 mb-3 font-medium">Throughput (TPS)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={tpsData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} unit=" TPS" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: "#e5e7eb" }}
                itemStyle={{ color: "#9ca3af" }}
                formatter={(v) => [`${v} TPS`, "Throughput"]}
              />
              <Bar dataKey="tps" radius={[3, 3, 0, 0]}>
                {tpsData.map((entry, i) => (
                  <Cell key={i} fill={VARIANT_COLORS[entry.variant] ?? "#6b7280"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost-per-TPS chart — only rendered when fee data is available */}
        {costData.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-400 mb-1 font-medium">
              Cost-per-TPS (fee units / TPS)
            </p>
            <p className="text-xs text-gray-600 mb-3">Lower = more cost-efficient</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={costData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "#e5e7eb" }}
                  itemStyle={{ color: "#9ca3af" }}
                  formatter={(v) => [Number(v).toLocaleString(), "fee units / TPS"]}
                />
                <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
                  {costData.map((entry, i) => (
                    <Cell key={i} fill={VARIANT_COLORS[entry.variant] ?? "#6b7280"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
