export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import { createRun, appendOutput, completeRun, failRun } from "@/lib/run-store";

const REPO_ROOT = path.resolve(process.cwd(), "..");

type Platform = "evm" | "solana";
type Variant = "V1" | "V2" | "V3" | "V4" | "V5";
type Client = "python" | "ts" | "dotnet";
type Kind = "lifecycle" | "throughput";

const VARIANT_PLATFORM: Record<Variant, Platform> = {
  V1: "evm",
  V2: "evm",
  V3: "evm",
  V4: "solana",
  V5: "solana",
};

const VARIANT_ENV: Record<Variant, string> = {
  V1: "sepolia",
  V2: "sepolia",
  V3: "sepolia",
  V4: "solana-devnet",
  V5: "solana-devnet",
};

const VALID_CLIENTS = new Set<Client>(["python", "ts", "dotnet"]);
const VALID_VARIANTS = new Set<Variant>(["V1", "V2", "V3", "V4", "V5"]);
const VALID_KINDS = new Set<Kind>(["lifecycle", "throughput"]);

interface RunRequest {
  variant: Variant;
  client: Client;
  kind: Kind;
}

export async function POST(req: NextRequest) {
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { variant, client, kind } = body;

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
  const env = VARIANT_ENV[variant];

  // Map ts client to the correct label for the benchmark script
  const clientLabel = client === "ts"
    ? platform === "solana" ? "ts-solana" : "ts"
    : client;

  const scriptArg = kind === "throughput" ? "--throughput" : "--lifecycle";

  const id = randomUUID();
  createRun(id);

  const child = spawn(
    "python",
    ["benchmarks/run_tests.py", "--platform", platform, scriptArg],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        VARIANT: variant,
        CLIENT: clientLabel,
        BENCHMARK_ENV: env,
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
      const resultFile = `benchmarks/results/${variant}_${clientLabel}_${env}_${kind}.json`;
      completeRun(id, resultFile);
    } else {
      failRun(id);
    }
  });

  child.on("error", () => {
    failRun(id);
  });

  return NextResponse.json({ id, status: "running" }, { status: 202 });
}
