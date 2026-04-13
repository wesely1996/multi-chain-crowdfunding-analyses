"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { RunState, RunStatus } from "@/lib/types";
import { VARIANT_LABELS } from "@/lib/chart-constants";

const VARIANTS = ["V1", "V2", "V3", "V4", "V5"] as const;
const CLIENTS = ["python", "ts", "dotnet"] as const;
const KINDS = ["lifecycle", "throughput"] as const;

const EVM_ENVS = ["hardhat-localnet", "sepolia"] as const;
const SOLANA_ENVS = ["solana-localnet", "solana-devnet"] as const;

function defaultEnv(variant: string): string {
  return ["V4", "V5"].includes(variant)
    ? "solana-localnet"
    : "hardhat-localnet";
}

function envsForVariant(variant: string): readonly string[] {
  return ["V4", "V5"].includes(variant) ? SOLANA_ENVS : EVM_ENVS;
}

const POLL_INTERVAL_MS = 1500;

interface Props {
  onRunComplete: () => void;
}

const SELECT_CLASS =
  "w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 " +
  "focus:outline-none focus:border-blue-500 cursor-pointer";

const LABEL_CLASS = "block text-xs text-gray-400 mb-1";

export default function RunPanel({ onRunComplete }: Props) {
  const [variant, setVariant] = useState("V1");
  const [client, setClient] = useState("python");
  const [kind, setKind] = useState("lifecycle");
  const [environment, setEnvironment] = useState(defaultEnv("V1"));

  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunState[]>([]);

  const logRef = useRef<HTMLPreElement>(null);

  const fetchHistory = useCallback(async () => {
    const res = await fetch("/api/runs");
    if (res.ok) setHistory(await res.json());
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-scroll log output to bottom
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  // Poll run status until terminal state
  const pollRun = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/run/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setOutput(data.output ?? "");
      setStatus(data.status);
      if (data.status === "success" || data.status === "error") {
        fetchHistory();
        if (data.status === "success") onRunComplete();
        try {
          const ctx = new AudioContext();
          await ctx.resume();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
        } catch {
          // audio not available
        }
      }
    },
    [onRunComplete, fetchHistory],
  );

  useEffect(() => {
    if (!runId || status !== "running") return;
    const timer = setInterval(() => pollRun(runId), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runId, status, pollRun]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setOutput("");
    setStatus("running");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, client, kind, environment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start run");
      setRunId(data.id);
    } catch (err) {
      setStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  const isRunning = status === "running";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white">Run Benchmark</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Trigger a live run against testnet
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="run-variant" className={LABEL_CLASS}>
            Variant
          </label>
          <select
            id="run-variant"
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value);
              setEnvironment(defaultEnv(e.target.value));
            }}
            className={SELECT_CLASS}
            disabled={isRunning}
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {VARIANT_LABELS[v] ?? v}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="run-client" className={LABEL_CLASS}>
            Client
          </label>
          <select
            id="run-client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
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

        <div>
          <label htmlFor="run-env" className={LABEL_CLASS}>
            Environment
          </label>
          <select
            id="run-env"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className={SELECT_CLASS}
            disabled={isRunning}
          >
            {envsForVariant(variant).map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="run-kind" className={LABEL_CLASS}>
            Benchmark type
          </label>
          <select
            id="run-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={SELECT_CLASS}
            disabled={isRunning}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting || isRunning}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {isRunning ? "Running…" : "Start Run"}
        </button>
      </form>

      {submitError && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {submitError}
        </p>
      )}

      {status !== "idle" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {runId && (
              <span className="text-xs text-gray-600 font-mono">
                {runId.slice(0, 8)}
              </span>
            )}
          </div>

          <pre
            ref={logRef}
            className="h-64 overflow-auto rounded border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 font-mono whitespace-pre-wrap"
          >
            {output || <span className="text-gray-600">Waiting for output…</span>}
          </pre>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Run History
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {history.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={run.status} />
                  <span className="text-gray-300 font-mono truncate">
                    {[(run.variant ? VARIANT_LABELS[run.variant] ?? run.variant : undefined), run.client, run.environment, run.kind]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <span className="text-gray-600 shrink-0 ml-2">
                  {new Date(run.startedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
