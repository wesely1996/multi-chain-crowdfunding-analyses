import { BenchmarkFile } from "@/lib/types";

export const ALL_VARIANTS = ["V1", "V2", "V3", "V4", "V5"] as const;
export const ALL_CLIENTS = ["dotnet", "python", "ts"] as const;

export const VARIANT_COLORS: Record<string, string> = {
  V1: "#3b82f6",
  V2: "#a855f7",
  V3: "#eab308",
  V4: "#22c55e",
  V5: "#ec4899",
};

export const TOOLTIP_STYLE = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "6px",
  fontSize: "12px",
};

export const OPERATION_ORDER = [
  "contribute",
  "finalize",
  "withdrawMilestone_0",
  "withdrawMilestone_1",
  "withdrawMilestone_2",
  "refund",
];

export function comboKey(r: BenchmarkFile): string {
  return `${r.variant} / ${r.client_label}`;
}

export function deduplicateByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}
