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
import { formatGas, formatFee } from "@/lib/format";
import {
  VARIANT_COLORS,
  VARIANT_LABELS,
  TOOLTIP_STYLE,
  OPERATION_ORDER,
  comboKey,
  deduplicateByKey,
} from "@/lib/chart-constants";

interface GasChartProps {
  results: BenchmarkFile[];
  operation?: string;
}

export function GasChart({ results, operation }: GasChartProps) {
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

  // Build per-result lookup: resultKey → opName → record
  const resultOpMap = new Map<
    string,
    Map<string, BenchmarkFile["operations"][number]>
  >();
  for (const r of results) {
    const rKey = comboKey(r);
    const opMap = new Map<string, BenchmarkFile["operations"][number]>();
    for (const op of r.operations) {
      opMap.set(op.name, op);
    }
    resultOpMap.set(rKey, opMap);
  }

  // Build one row per operation name
  const data = opNames.map((opName) => {
    const row: Record<string, string | number> = { opName };
    for (const r of results) {
      const key = comboKey(r);
      const rec = resultOpMap.get(key)?.get(opName);
      if (rec) {
        row[key] =
          r.platform === "EVM"
            ? (rec.gas_used ?? 0)
            : parseInt(rec.cost, 10) || 0;
      }
    }
    return row;
  });

  // Unique combos for bars
  const uniqueCombos = deduplicateByKey(
    results.map((r) => ({
      key: comboKey(r),
      variant: r.variant,
      variant_label: r.variant_label,
      client_label: r.client_label,
      platform: r.platform,
    })),
  );

  const formatValue = (value: number, seriesKey: string): string => {
    const combo = uniqueCombos.find((c) => c.key === seriesKey);
    if (!combo) return String(value);
    return combo.platform === "EVM" ? formatGas(value) : formatFee(value);
  };

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
              value: "Gas / Fee",
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
            formatter={(value, name, item) => [
              formatValue(Number(value), String(item.dataKey)),
              String(name),
            ]}
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
