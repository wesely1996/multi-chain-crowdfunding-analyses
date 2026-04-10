export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import path from "path";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { createRun, appendOutput, completeRun, failRun } from "@/lib/run-store";
import type { PriceSnapshot } from "@/lib/types";

const REPO_ROOT = path.resolve(process.cwd(), "..");

const VENV_PYTHON =
  process.platform === "win32"
    ? path.join(REPO_ROOT, "clients", "python", ".venv", "Scripts", "python.exe")
    : path.join(REPO_ROOT, "clients", "python", ".venv", "bin", "python");

const RESULTS_DIR = path.join(REPO_ROOT, "benchmarks", "results");

// ── Python resolution ─────────────────────────────────────────────────────────

/**
 * Find a Python 3.12 interpreter on the host system.
 * Returns { cmd, extraArgs } so callers can do spawn(cmd, [...extraArgs, script]).
 */
function findSystemPython(): { cmd: string; extraArgs: string[] } | null {
  const candidates: { cmd: string; extraArgs: string[] }[] =
    process.platform === "win32"
      ? [
          { cmd: "py",         extraArgs: ["-3.12"] },
          { cmd: "python3.12", extraArgs: [] },
          { cmd: "python3",    extraArgs: [] },
          { cmd: "python",     extraArgs: [] },
        ]
      : [
          { cmd: "python3.12", extraArgs: [] },
          { cmd: "python3",    extraArgs: [] },
          { cmd: "python",     extraArgs: [] },
        ];

  for (const { cmd, extraArgs } of candidates) {
    try {
      const result = spawnSync(cmd, [...extraArgs, "--version"], { timeout: 5000 });
      const output = (result.stdout ?? result.stderr ?? "").toString();
      if (result.status === 0 && /Python 3\.(1[2-9]|[2-9]\d)/.test(output)) {
        return { cmd, extraArgs };
      }
    } catch {
      // binary not on PATH — try next
    }
  }
  return null;
}

/** Resolve the Python interpreter to use for benchmark scripts. */
function resolvePython(): string {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python"; // placeholder — replaced after ensureVenv()
}

// ── Venv bootstrap ────────────────────────────────────────────────────────────

// Singleton promise so concurrent requests don't double-bootstrap.
let venvReady: Promise<void> | null = null;

function runStage(
  cmd: string,
  args: string[],
  cwd: string,
  onOutput: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Ensure the Python venv exists with all required packages.
 * Creates and populates it on first call; subsequent calls are no-ops.
 * Output is forwarded to onOutput so the dashboard live-log shows progress.
 */
function ensureVenv(onOutput: (line: string) => void): Promise<void> {
  if (existsSync(VENV_PYTHON)) return Promise.resolve();

  if (!venvReady) {
    venvReady = (async () => {
      const sys = findSystemPython();
      if (!sys) {
        throw new Error(
          "Python 3.12+ not found. Install Python 3.12 and retry.\n" +
          "Windows: winget install Python.Python.3.12\n" +
          "Linux/WSL: sudo apt install python3.12 python3.12-venv",
        );
      }

      onOutput(`[setup] Found system Python: ${sys.cmd} ${sys.extraArgs.join(" ")}\n`);
      onOutput(`[setup] Creating venv at clients/python/.venv …\n`);

      const venvDir = path.dirname(path.dirname(VENV_PYTHON)); // clients/python/.venv

      await runStage(
        sys.cmd,
        [...sys.extraArgs, "-m", "venv", venvDir],
        REPO_ROOT,
        onOutput,
      );

      // Resolve pip inside the newly created venv
      const pip =
        process.platform === "win32"
          ? path.join(venvDir, "Scripts", "pip.exe")
          : path.join(venvDir, "bin", "pip");

      onOutput("[setup] Upgrading pip…\n");
      await runStage(pip, ["install", "--upgrade", "pip", "--quiet"], REPO_ROOT, onOutput);

      // Stage 1: web3 without deps (bypasses lru-dict<1.3.0 pin)
      onOutput("[setup] Stage 1/4: web3==6.20.3 (no-deps)…\n");
      await runStage(pip, ["install", "--no-deps", "web3==6.20.3"], REPO_ROOT, onOutput);

      // Stage 2: lru-dict — 1.3.0 has prebuilt wheels on all platforms
      onOutput("[setup] Stage 2/4: lru-dict==1.3.0…\n");
      await runStage(pip, ["install", "lru-dict==1.3.0"], REPO_ROOT, onOutput);

      // Stage 3: Solana stack
      onOutput("[setup] Stage 3/4: solana + anchorpy…\n");
      await runStage(
        pip,
        ["install",
          "solana==0.36.6",
          "solders==0.26.0",
          "anchorpy==0.21.0",
          "tabulate==0.9.0",
        ],
        REPO_ROOT,
        onOutput,
      );

      // Stage 4: web3 transitive dependencies
      onOutput("[setup] Stage 4/4: web3 transitive deps…\n");
      await runStage(
        pip,
        ["install",
          "eth-abi>=4.0.0",
          "eth-account>=0.8.0,<0.13",
          "eth-typing>=3.0.0,<5",
          "eth-utils>=2.1.0,<5",
          "hexbytes>=0.1.0,<0.4.0",
          "eth-hash[pycryptodome]>=0.5.1",
          "jsonschema>=4.0.0",
          "protobuf>=4.21.6",
          "aiohttp",
          "requests",
          "pyunormalize",
          "rlp",
          "websockets>=10.0,<16.0",
          "typing-extensions",
          "toolz>=0.11.2,<0.12.0",
        ],
        REPO_ROOT,
        onOutput,
      );

      onOutput("[setup] Python environment ready.\n\n");
    })();

    // Clear the singleton on failure so a retry can re-attempt
    venvReady.catch(() => { venvReady = null; });
  }

  return venvReady;
}

// ── Price snapshot ────────────────────────────────────────────────────────────

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

// ── Request types ─────────────────────────────────────────────────────────────

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

// ── POST /api/run ─────────────────────────────────────────────────────────────

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

  const clientLabel =
    client === "test-script" ? "python" :
    client === "ts" ? (platform === "solana" ? "ts-solana" : "ts") :
    client;

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

  // Bootstrap the venv in the background, then launch the benchmark.
  // Output from the setup stage is prepended to the run's live log.
  (async () => {
    try {
      await ensureVenv((chunk) => appendOutput(id, chunk));
    } catch (err) {
      appendOutput(id, `\n[setup error] ${err instanceof Error ? err.message : String(err)}\n`);
      failRun(id);
      return;
    }

    // Resolve python after venv is guaranteed to exist
    const python = resolvePython();

    const child = spawn(
      python,
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

    child.stdout.on("data", (chunk: Buffer) => appendOutput(id, chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => appendOutput(id, chunk.toString()));

    child.on("close", (code: number | null) => {
      if (code === 0) {
        embedPricesInResult(variant, clientLabel, env, kind).finally(() => completeRun(id));
      } else {
        failRun(id);
      }
    });

    child.on("error", () => failRun(id));
  })();

  return NextResponse.json({ id, status: "running" }, { status: 202 });
}
