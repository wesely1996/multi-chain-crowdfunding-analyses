"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import type { RunStatus } from "@/lib/types";

type Variant = "V1" | "V2" | "V3" | "V4" | "V5";
type Client = "python" | "ts" | "dotnet";
type Kind = "lifecycle" | "throughput";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "V1", label: "V1 — ERC-20 (EVM)" },
  { value: "V2", label: "V2 — ERC-4626 (EVM)" },
  { value: "V3", label: "V3 — ERC-1155 (EVM)" },
  { value: "V4", label: "V4 — SPL Token (Solana)" },
  { value: "V5", label: "V5 — Token-2022 (Solana)" },
];

const CLIENTS: Client[] = ["python", "ts", "dotnet"];
const KINDS: Kind[] = ["lifecycle", "throughput"];

const POLL_INTERVAL_MS = 2000;

function deriveEnvironment(variant: Variant): string {
  if (variant === "V4" || variant === "V5") return "solana-devnet";
  return "sepolia";
}

const SELECT_CLASS =
  "w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 " +
  "focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const LABEL_CLASS = "block text-xs text-gray-400 mb-1";

export function RunForm() {
  const [variant, setVariant] = useState<Variant>("V1");
  const [client, setClient] = useState<Client>("python");
  const [kind, setKind] = useState<Kind>("lifecycle");

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState("");
  const [resultFile, setResultFile] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const logRef = useRef<HTMLPreElement>(null);

  const environment = deriveEnvironment(variant);
  const isRunning = status === "running";

  // Auto-scroll output to bottom when it updates
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  // Poll while a run is active
  useEffect(() => {
    if (!runId || status !== "running") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/run/${runId}`);
        if (!res.ok) return;
        const data: { status: RunStatus; output?: string; resultFile?: string } =
          await res.json();
        setOutput(data.output ?? "");
        setResultFile(data.resultFile);
        setStatus(data.status);
      } catch {
        // ignore transient fetch errors; keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runId, status]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setOutput("");
    setResultFile(undefined);
    setRunId(null);
    setStatus("running");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, client, kind }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start run");
      setRunId(data.id ?? null);
    } catch (err) {
      setStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-white">Run Benchmark</h2>
        {status !== "idle" && <StatusBadge status={status} />}
      </div>

      {/* Note */}
      <p className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded px-3 py-2">
        Note: V2 and V3 benchmarks require contract artifacts to be configured in{" "}
        <span className="font-mono">benchmarks/config.py</span> before running.
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Variant */}
        <div>
          <label htmlFor="run-variant" className={LABEL_CLASS}>
            Variant
          </label>
          <select
            id="run-variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value as Variant)}
            className={SELECT_CLASS}
            disabled={isRunning}
          >
            {VARIANTS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Client */}
        <div>
          <label htmlFor="run-client" className={LABEL_CLASS}>
            Client
          </label>
          <select
            id="run-client"
            value={client}
            onChange={(e) => setClient(e.target.value as Client)}
            className={SELECT_CLASS}
            disabled={isRunning}
          >
            {CLIENTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Kind */}
        <div>
          <span className={LABEL_CLASS}>Kind</span>
          <div className="flex gap-4">
            {KINDS.map((k) => (
              <label
                key={k}
                className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer"
              >
                <input
                  type="radio"
                  name="run-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  disabled={isRunning}
                  className="accent-blue-500"
                />
                {k}
              </label>
            ))}
          </div>
        </div>

        {/* Environment (derived, read-only) */}
        <div>
          <span className={LABEL_CLASS}>Environment (derived)</span>
          <div className="px-3 py-1.5 text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded font-mono">
            {environment}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isRunning}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {isRunning ? "Running…" : "Start Run"}
        </button>
      </form>

      {/* Submit error */}
      {submitError && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {submitError}
        </p>
      )}

      {/* Live output */}
      {output && (
        <pre
          ref={logRef}
          className="max-h-64 overflow-y-auto bg-black text-green-400 text-xs font-mono p-3 rounded whitespace-pre-wrap"
        >
          {output}
        </pre>
      )}

      {/* Success link */}
      {status === "success" && (
        <div className="space-y-1">
          <p className="text-sm">
            <Link href="/benchmarks" className="text-green-400 hover:text-green-300 underline">
              View Results →
            </Link>
          </p>
          {resultFile && (
            <p className="text-xs text-gray-500 font-mono">Result file: {resultFile}</p>
          )}
        </div>
      )}

      {/* Error message */}
      {status === "error" && !submitError && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          The run finished with an error. See the output above for details.
        </p>
      )}
    </div>
  );
}
