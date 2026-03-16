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
  Cell,
} from "recharts";
import { BenchmarkFile } from "@/lib/types";
import { formatTps, formatMs } from "@/lib/format";
import { VARIANT_COLORS, TOOLTIP_STYLE } from "@/lib/chart-constants";

interface ThroughputChartProps {
  results: BenchmarkFile[];
}

export function ThroughputChart({ results }: ThroughputChartProps) {
  const data = results.map((r) => ({
    name: `${r.variant_label} / ${r.client_label}`,
    tps: parseFloat(r.throughput.tps.toFixed(4)),
    variant: r.variant,
    num_contributions: r.throughput.num_contributions,
    total_time_ms: r.throughput.total_time_ms,
  }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#9ca3af", fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            label={{
              value: "TPS",
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
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const entry = payload[0].payload as typeof data[number];
              return (
                <div
                  style={TOOLTIP_STYLE}
                  className="px-3 py-2"
                >
                  <p style={{ color: "#e5e7eb", marginBottom: 4 }}>{label}</p>
                  <p style={{ color: "#9ca3af" }}>
                    TPS: {formatTps(entry.tps)}
                  </p>
                  <p style={{ color: "#9ca3af" }}>
                    Contributions: {entry.num_contributions}
                  </p>
                  <p style={{ color: "#9ca3af" }}>
                    Total time: {formatMs(entry.total_time_ms)}
                  </p>
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ color: "#9ca3af", fontSize: 11, paddingTop: 8 }}
          />
          <Bar dataKey="tps" name="TPS" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={VARIANT_COLORS[entry.variant] ?? "#6b7280"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
