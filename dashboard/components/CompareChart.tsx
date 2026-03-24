"use client";

import { useState } from "react";
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
import { VARIANT_COLORS, VARIANT_LABELS, TOOLTIP_STYLE } from "@/lib/chart-constants";

interface Props {
  results: BenchmarkFile[];
}

type Mode = "latest" | "average";
type Kind = "lifecycle" | "throughput";

function buildLabel(r: BenchmarkFile): string {
  const variantName = VARIANT_LABELS[r.variant] ?? r.variant;
  return `${variantName}/${r.client}`;
}

function costPerTps(tps: number, gasAvg: number | null, feeAvg: number | null): number | null {
  const cost = gasAvg ?? feeAvg;
  if (cost === null || tps === 0) return null;
  return parseFloat((cost / tps).toFixed(2));
}

interface ChartPoint {
  name: string;
  variant: string;
  tps: number;
  cost: number | null;
  n?: number;
}

/** Group results by variant+client for a given kind. */
function groupByKind(results: BenchmarkFile[], kind: Kind): Map<string, BenchmarkFile[]> {
  const groups = new Map<string, BenchmarkFile[]>();
  for (const r of results.filter((r) => r.kind === kind)) {
    const key = `${r.variant}_${r.client}`;
    const existing = groups.get(key) ?? [];
    existing.push(r);
    groups.set(key, existing);
  }
  return groups;
}

function buildLatest(results: BenchmarkFile[], kind: Kind): ChartPoint[] {
  const groups = groupByKind(results, kind);
  return Array.from(groups.values()).map((runs) => {
    const r = runs.reduce((a, b) => (b.timestamp_utc > a.timestamp_utc ? b : a));
    return {
      name: buildLabel(r),
      variant: r.variant,
      tps: parseFloat(r.throughput.tps.toFixed(2)),
      cost: costPerTps(
        r.throughput.tps,
        r.throughput.per_tx_gas?.avg ?? null,
        r.throughput.per_tx_fee?.avg ?? null,
      ),
    };
  });
}

function buildAverage(results: BenchmarkFile[], kind: Kind): ChartPoint[] {
  const groups = groupByKind(results, kind);
  return Array.from(groups.entries()).map(([, runs]) => {
    const r0 = runs[0];
    const n = runs.length;
    const avgTps = runs.reduce((s, r) => s + r.throughput.tps, 0) / n;
    const gasValues = runs.map((r) => r.throughput.per_tx_gas?.avg ?? null).filter((v): v is number => v !== null);
    const feeValues = runs.map((r) => r.throughput.per_tx_fee?.avg ?? null).filter((v): v is number => v !== null);
    const avgGas = gasValues.length > 0 ? gasValues.reduce((s, v) => s + v, 0) / gasValues.length : null;
    const avgFee = feeValues.length > 0 ? feeValues.reduce((s, v) => s + v, 0) / feeValues.length : null;
    return {
      name: buildLabel(r0),
      variant: r0.variant,
      tps: parseFloat(avgTps.toFixed(2)),
      cost: costPerTps(avgTps, avgGas, avgFee),
      n,
    };
  });
}

const BTN_BASE = "px-3 py-1 text-xs rounded transition-colors";
const BTN_ACTIVE = `${BTN_BASE} bg-gray-700 text-white`;
const BTN_INACTIVE = `${BTN_BASE} text-gray-500 hover:text-gray-300`;

export default function CompareChart({ results }: Props) {
  const [mode, setMode] = useState<Mode>("latest");
  const [kind, setKind] = useState<Kind>("lifecycle");

  const chartData = mode === "latest" ? buildLatest(results, kind) : buildAverage(results, kind);
  const costData = chartData.filter((d) => d.cost !== null);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-gray-500">
          Comparative Analysis
        </h2>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded p-0.5">
            <button className={kind === "lifecycle" ? BTN_ACTIVE : BTN_INACTIVE} onClick={() => setKind("lifecycle")}>
              Lifecycle
            </button>
            <button className={kind === "throughput" ? BTN_ACTIVE : BTN_INACTIVE} onClick={() => setKind("throughput")}>
              Throughput
            </button>
          </div>
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded p-0.5">
            <button className={mode === "latest" ? BTN_ACTIVE : BTN_INACTIVE} onClick={() => setMode("latest")}>
              Latest
            </button>
            <button className={mode === "average" ? BTN_ACTIVE : BTN_INACTIVE} onClick={() => setMode("average")}>
              Average
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
        {/* TPS chart */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-400 mb-3 font-medium">
            {(() => {
              const maxN = mode === "average" ? Math.max(...chartData.map((d) => d.n ?? 1)) : 0;
              return maxN > 1 ? `Throughput (TPS) — avg over up to ${maxN} runs` : "Throughput (TPS)";
            })()}
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} unit=" TPS" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: "#e5e7eb" }}
                itemStyle={{ color: "#9ca3af" }}
                formatter={(v, _name, entry) => {
                  const n = (entry?.payload as ChartPoint)?.n;
                  const label = mode === "average" && n ? `${v} TPS (n=${n})` : `${v} TPS`;
                  return [label, "Throughput"];
                }}
              />
              <Bar dataKey="tps" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={VARIANT_COLORS[entry.variant] ?? "#6b7280"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost-per-TPS chart */}
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
                  formatter={(v, _name, entry) => {
                    const n = (entry?.payload as ChartPoint)?.n;
                    const label = mode === "average" && n
                      ? `${Number(v).toLocaleString()} (n=${n})`
                      : Number(v).toLocaleString();
                    return [label, "fee units / TPS"];
                  }}
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
