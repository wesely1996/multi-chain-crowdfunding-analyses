export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { createRun, appendOutput, completeRun, failRun } from "@/lib/run-store";
import type { PriceSnapshot } from "@/lib/types";

const REPO_ROOT = path.resolve(process.cwd(), "..");

/** Resolve the Python interpreter: prefer repo-root .venv, fall back to system python. */
function resolvePython(): string {
  const winVenv = path.join(REPO_ROOT, "clients", "python", ".venv", "Scripts", "python.exe");
  const unixVenv = path.join(REPO_ROOT, "clients", "python", ".venv", "bin", "python");
  if (existsSync(winVenv)) return winVenv;
  if (existsSync(unixVenv)) return unixVenv;
  return "python";
}

const PYTHON = resolvePython();

const RESULTS_DIR = path.join(REPO_ROOT, "benchmarks", "results");

async function fetchPriceSnapshot(): Promise<PriceSnapshot | null> {
  try {
    const [coinRes, fxRes] = await Promise.all([
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd"),
      fetch("https://open.er-api.com/v6/latest/USD"),
    ]);
    if (!coinRes.ok || !fxRes.ok) return null;
    const coin = await coinRes.json() as { ethereum: { usd: number }; solana: { usd: number } };
    const fx   = await fxRes.json()  as { rates: Record<string, number> };
    return {
      eth_usd:        coin.ethereum.usd,
      sol_usd:        coin.solana.usd,
      usd_rsd:        fx.rates.RSD,
      gas_price_gwei: 1,
      fetched_at_utc: Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

async function embedPricesInResult(variant: string, clientLabel: string, env: string, kind: string): Promise<void> {
  const prices = await fetchPriceSnapshot();
  if (!prices) return;

  const prefix = `${variant}_${clientLabel}_${env}_${kind}_`;
  let files: { path: string; mtime: number }[];
  try {
    files = readdirSync(RESULTS_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        const p = path.join(RESULTS_DIR, f);
        return { path: p, mtime: statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }
  if (files.length === 0) return;

  try {
    const data = JSON.parse(readFileSync(files[0].path, "utf-8"));
    data.prices = prices;
    writeFileSync(files[0].path, JSON.stringify(data, null, 2));
  } catch {
    // non-fatal — result file still usable without prices
  }
}

type Platform = "evm" | "solana";
type Variant = "V1" | "V2" | "V3" | "V4" | "V5";
type Client = "python" | "test-script" | "ts" | "dotnet";
type Kind = "lifecycle" | "throughput";

const VARIANT_PLATFORM: Record<Variant, Platform> = {
  V1: "evm",
  V2: "evm",
  V3: "evm",
  V4: "solana",
  V5: "solana",
};

const VALID_CLIENTS = new Set<Client>(["python", "test-script", "ts", "dotnet"]);
const VALID_VARIANTS = new Set<Variant>(["V1", "V2", "V3", "V4", "V5"]);
const VALID_KINDS = new Set<Kind>(["lifecycle", "throughput"]);
const VALID_EVM_ENVS = new Set(["hardhat-localnet", "sepolia"]);
const VALID_SOLANA_ENVS = new Set(["solana-localnet", "solana-devnet"]);

interface RunRequest {
  variant: Variant;
  client: Client;
  kind: Kind;
  environment: string;
}

export async function POST(req: NextRequest) {
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { variant, client, kind, environment } = body;

  if (!VALID_VARIANTS.has(variant)) {
    return NextResponse.json({ error: `Invalid variant: ${variant}` }, { status: 400 });
  }
  if (!VALID_CLIENTS.has(client)) {
    return NextResponse.json({ error: `Invalid client: ${client}` }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: `Invalid kind: ${kind}` }, { status: 400 });
  }

  const platform = VARIANT_PLATFORM[variant];
  const validEnvs = platform === "evm" ? VALID_EVM_ENVS : VALID_SOLANA_ENVS;
  if (!environment || !validEnvs.has(environment)) {
    return NextResponse.json(
      { error: `Invalid environment '${environment}' for platform ${platform}` },
      { status: 400 }
    );
  }
  const env = environment;

  // Map ts client to the correct label for the benchmark script.
  // test-script uses "python" as the result-file client label (run_tests.py output convention).
  const clientLabel =
    client === "test-script" ? "python" :
    client === "ts" ? (platform === "solana" ? "ts-solana" : "ts") :
    client;

  // Select script and args based on client type:
  //   test-script -> benchmarks/run_tests.py (Python harness, all operations in-process)
  //   python      -> benchmarks/run_client_benchmark.py --client python (clients/python/ subprocess)
  //   ts/dotnet   -> benchmarks/run_client_benchmark.py or run_throughput_client.py
  const script =
    client === "test-script"
      ? "benchmarks/run_tests.py"
      : kind === "throughput"
      ? "benchmarks/run_throughput_client.py"
      : "benchmarks/run_client_benchmark.py";

  const args =
    client === "test-script"
      ? ["--platform", platform, kind === "throughput" ? "--throughput" : "--lifecycle"]
      : ["--platform", platform, "--client", clientLabel, "--variant", variant, "--env", env];

  const id = randomUUID();
  createRun(id, { variant, client, environment: env, kind });

  const child = spawn(
    PYTHON,
    [script, ...args],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        VARIANT: variant,
        CLIENT: clientLabel,
        BENCHMARK_ENV: env,
        PYTHONUNBUFFERED: "1",
      },
    }
  );

  child.stdout.on("data", (chunk: Buffer) => {
    appendOutput(id, chunk.toString());
  });

  child.stderr.on("data", (chunk: Buffer) => {
    appendOutput(id, chunk.toString());
  });

  child.on("close", (code: number | null) => {
    if (code === 0) {
      // Result files include a runtime timestamp in the name; the dashboard
      // discovers them by scanning the results directory rather than by path.
      embedPricesInResult(variant, clientLabel, env, kind).finally(() => completeRun(id));
    } else {
      failRun(id);
    }
  });

  child.on("error", () => {
    failRun(id);
  });

  return NextResponse.json({ id, status: "running" }, { status: 202 });
}
