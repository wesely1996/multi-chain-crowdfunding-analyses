"use client";

import { useState } from "react";
import { BenchmarkFile } from "@/lib/types";
import { formatGas, formatFee, formatMs } from "@/lib/format";
import { OPERATION_ORDER } from "@/lib/chart-constants";

interface ComparisonTableProps {
  results: BenchmarkFile[];
}

interface ColKey {
  variant: BenchmarkFile["variant"];
  client: BenchmarkFile["client"];
  platform: BenchmarkFile["platform"];
  label: string; // e.g. "python"
}

interface CellData {
  cost: string;
  gas_used: number | null;
  latency_ms: number;
  platform: "EVM" | "Solana";
}

type SortState = { colKey: string; dir: "asc" | "desc" } | null;

/** Returns a numeric value used for sorting a cell (lower = cheaper / faster). */
function sortValue(cell: CellData | undefined): number {
  if (!cell) return Infinity;
  if (cell.platform === "EVM") {
    return cell.gas_used ?? Infinity;
  }
  const parsed = parseInt(cell.cost, 10);
  return isNaN(parsed) ? Infinity : parsed;
}

function colKeyStr(variant: string, client: string): string {
  return `${variant}__${client}`;
}

export function ComparisonTable({ results }: ComparisonTableProps) {
  const [sort, setSort] = useState<SortState>(null);

  if (results.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No benchmark results available for comparison.
      </p>
    );
  }

  // ── 1. Collect unique (variant, client) columns, preserving insertion order ──
  const colMap = new Map<string, ColKey>();
  for (const r of results) {
    const key = colKeyStr(r.variant, r.client);
    if (!colMap.has(key)) {
      colMap.set(key, {
        variant: r.variant,
        client: r.client,
        platform: r.platform,
        label: r.client_label,
      });
    }
  }
  const columns: (ColKey & { key: string })[] = Array.from(
    colMap.entries()
  ).map(([key, col]) => ({ key, ...col }));

  // ── 2. Collect unique operation names ────────────────────────────────────────
  const opSet = new Set<string>();
  for (const r of results) {
    for (const op of r.operations) {
      opSet.add(op.name);
    }
  }
  // Sort by canonical order first, then alphabetically for any extras
  const operations: string[] = [
    ...OPERATION_ORDER.filter((o) => opSet.has(o)),
    ...Array.from(opSet).filter((o) => !OPERATION_ORDER.includes(o)).sort(),
  ];

  // ── 3. Build lookup: opName → colKey → CellData ──────────────────────────────
  const lookup = new Map<string, Map<string, CellData>>();
  for (const r of results) {
    const key = colKeyStr(r.variant, r.client);
    for (const op of r.operations) {
      if (!lookup.has(op.name)) lookup.set(op.name, new Map());
      lookup.get(op.name)!.set(key, {
        cost: op.cost,
        gas_used: op.gas_used,
        latency_ms: op.latency_ms,
        platform: r.platform,
      });
    }
  }

  // ── 4. Sort rows ──────────────────────────────────────────────────────────────
  const sortedOps = [...operations].sort((a, b) => {
    if (!sort) return 0;
    const va = sortValue(lookup.get(a)?.get(sort.colKey));
    const vb = sortValue(lookup.get(b)?.get(sort.colKey));
    const diff = va - vb;
    return sort.dir === "asc" ? diff : -diff;
  });

  // ── 5. Group columns by variant for the group-header row ─────────────────────
  const variantGroups: { variant: string; count: number }[] = [];
  for (const col of columns) {
    const last = variantGroups[variantGroups.length - 1];
    if (last && last.variant === col.variant) {
      last.count += 1;
    } else {
      variantGroups.push({ variant: col.variant, count: 1 });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function handleSort(colKey: string) {
    setSort((prev) => {
      if (!prev || prev.colKey !== colKey) return { colKey, dir: "asc" };
      if (prev.dir === "asc") return { colKey, dir: "desc" };
      return null; // third click clears sort
    });
  }

  function sortIndicator(colKey: string): string {
    if (!sort || sort.colKey !== colKey) return " ↕";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  function renderCell(cell: CellData | undefined): React.ReactNode {
    if (!cell) {
      return <span className="text-gray-600">—</span>;
    }
    let primary: string;
    let primaryClass: string;
    if (cell.platform === "EVM") {
      primary = formatGas(cell.gas_used);
      primaryClass = "text-orange-400";
    } else {
      primary = formatFee(cell.cost);
      primaryClass = "text-purple-400";
    }
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className={`font-mono text-xs ${primaryClass}`}>{primary}</span>
        <span className="font-mono text-xs text-blue-400">
          {formatMs(cell.latency_ms)}
        </span>
      </span>
    );
  }

  return (
    <div className="max-w-[90%] overflow-x-auto rounded-lg border border-gray-700">
      <table className="min-w-max text-sm bg-gray-900 border-collapse">
        {/* ── Variant group headers ── */}
        <thead>
          <tr className="bg-gray-800 border-b border-gray-700">
            {/* sticky operation column placeholder */}
            <th className="sticky left-0 z-20 bg-gray-800 px-4 py-2 text-left text-xs uppercase tracking-wider text-gray-500 border-r border-gray-700" />
            {variantGroups.map((grp) => (
              <th
                key={grp.variant}
                colSpan={grp.count}
                className="px-4 py-2 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider border-r border-gray-700 last:border-r-0"
              >
                {grp.variant}
              </th>
            ))}
          </tr>

          {/* ── Client sub-headers ── */}
          <tr className="bg-gray-800 border-b border-gray-700">
            <th className="sticky left-0 z-20 bg-gray-800 px-4 py-2 text-left text-xs uppercase tracking-wider text-gray-500 border-r border-gray-700">
              Operation
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-right text-xs text-gray-400 font-medium whitespace-nowrap border-r border-gray-700 last:border-r-0 cursor-pointer select-none hover:text-white hover:bg-gray-700/40 transition-colors"
                onClick={() => handleSort(col.key)}
                title={`Sort by ${col.variant} / ${col.label}`}
              >
                {col.label}
                <span className="text-gray-500">{sortIndicator(col.key)}</span>
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody className="divide-y divide-gray-800">
          {sortedOps.map((opName, i) => {
            const rowBg =
              i % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50";
            return (
              <tr
                key={opName}
                className={`${rowBg} hover:bg-gray-700/30 transition-colors`}
              >
                <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5 font-mono text-xs text-gray-200 whitespace-nowrap border-r border-gray-700">
                  {opName}
                </td>
                {columns.map((col) => {
                  const cell = lookup.get(opName)?.get(col.key);
                  const isActive = sort?.colKey === col.key;
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 text-right border-r border-gray-700 last:border-r-0 ${
                        isActive ? "bg-gray-800/60" : ""
                      }`}
                    >
                      {renderCell(cell)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
