"use client";

import { BenchmarkFile } from "@/lib/types";
import { ALL_VARIANTS, ALL_CLIENTS, VARIANT_LABELS } from "@/lib/chart-constants";

interface FilterBarProps {
  results: BenchmarkFile[];
  variant: string;
  setVariant: (v: string) => void;
  client: string;
  setClient: (v: string) => void;
  environment: string;
  setEnvironment: (v: string) => void;
  kind: string;
  setKind: (v: string) => void;
  onRefresh: () => void;
}

const SELECT_CLASS =
  "bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 " +
  "focus:outline-none focus:border-blue-500 cursor-pointer";

export default function FilterBar({
  results,
  variant,
  setVariant,
  client,
  setClient,
  environment,
  setEnvironment,
  kind,
  setKind,
  onRefresh,
}: FilterBarProps) {
  const environments = Array.from(
    new Set(results.map((r) => r.environment)),
  ).sort();

  const kinds = ["lifecycle", "throughput"] as const;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={variant}
        onChange={(e) => setVariant(e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filter by variant"
      >
        <option value="all">All variants</option>
        {ALL_VARIANTS.map((v) => (
          <option key={v} value={v}>
            {VARIANT_LABELS[v] ?? v}
          </option>
        ))}
      </select>

      <select
        value={client}
        onChange={(e) => setClient(e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filter by client"
      >
        <option value="all">All clients</option>
        {ALL_CLIENTS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={environment}
        onChange={(e) => setEnvironment(e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filter by environment"
      >
        <option value="all">All environments</option>
        {environments.map((env) => (
          <option key={env} value={env}>
            {env}
          </option>
        ))}
      </select>

      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className={SELECT_CLASS}
        aria-label="Filter by run kind"
      >
        <option value="all">All kinds</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      <button
        onClick={onRefresh}
        className="ml-auto border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        aria-label="Refresh results"
      >
        ↻ Refresh
      </button>
    </div>
  );
}
