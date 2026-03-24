"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BenchmarkFile } from "@/lib/types";
import { formatMs } from "@/lib/format";
import {
  VARIANT_COLORS,
  VARIANT_LABELS,
  TOOLTIP_STYLE,
  OPERATION_ORDER,
  comboKey,
  deduplicateByKey,
} from "@/lib/chart-constants";

interface LatencyChartProps {
  results: BenchmarkFile[];
  operation?: string;
}

export function LatencyChart({ results, operation }: LatencyChartProps) {
  // Determine which operation names to show
  const allOpNames = Array.from(
    new Set(results.flatMap((r) => r.operations.map((op) => op.name))),
  ).sort((a, b) => {
    const ai = OPERATION_ORDER.indexOf(a);
    const bi = OPERATION_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const opNames = operation
    ? allOpNames.filter((n) => n === operation)
    : allOpNames;

  // Build per-result lookup: resultKey → opName → latency_ms
  const resultOpMap = new Map<string, Map<string, number>>();
  for (const r of results) {
    const rKey = comboKey(r);
    const opMap = new Map<string, number>();
    for (const op of r.operations) {
      opMap.set(op.name, op.latency_ms);
    }
    resultOpMap.set(rKey, opMap);
  }

  // Build one row per operation name
  const data = opNames.map((opName) => {
    const row: Record<string, string | number> = { opName };
    for (const r of results) {
      const key = comboKey(r);
      const latency = resultOpMap.get(key)?.get(opName);
      if (latency !== undefined) {
        row[key] = latency;
      }
    }
    return row;
  });

  // Unique combos for bars
  const uniqueCombos = deduplicateByKey(
    results.map((r) => ({
      key: comboKey(r),
      variant: r.variant,
      client_label: r.client_label,
    })),
  );

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#374151"
            vertical={false}
          />
          <XAxis dataKey="opName" tick={{ fill: "#9ca3af", fontSize: 11 }} />
          <YAxis
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            label={{
              value: "Latency (ms)",
              angle: -90,
              position: "insideLeft",
              fill: "#9ca3af",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#e5e7eb" }}
            itemStyle={{ color: "#9ca3af" }}
            formatter={(value, name) => [formatMs(Number(value)), String(name)]}
          />
          <Legend
            wrapperStyle={{ color: "#9ca3af", fontSize: 11, paddingTop: 8 }}
          />
          {uniqueCombos.map((combo) => (
            <Bar
              key={combo.key}
              dataKey={combo.key}
              name={`${VARIANT_LABELS[combo.variant] ?? combo.variant} / ${combo.client_label}`}
              fill={VARIANT_COLORS[combo.variant] ?? "#6b7280"}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
