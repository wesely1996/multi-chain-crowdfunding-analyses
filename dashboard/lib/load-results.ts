import { readFileSync, readdirSync } from "fs";
import path from "path";
import { BenchmarkFile } from "./types";

export const RESULTS_DIR = path.resolve(process.cwd(), "../benchmarks/results");

/** Extract the kind segment ("lifecycle" | "throughput") from a result filename. */
export function kindFromFilename(filename: string): string {
  // filename pattern: {VARIANT}_{CLIENT}_{ENV}_{kind}.json
  const base = path.basename(filename, ".json");
  const parts = base.split("_");
  // ENV may contain hyphens but not underscores; kind is always the last segment
  return parts[parts.length - 1];
}

/** Build the grouping key for a file. */
export function groupKey(file: BenchmarkFile, kind: string): string {
  return `${file.variant}_${file.client}_${file.environment}_${kind}`;
}

/**
 * Parse a single JSON file. Returns null if the file is not a valid BenchmarkFile
 * (wrong schema_version or parse error).
 */
export function parseResultFile(filePath: string): BenchmarkFile | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as BenchmarkFile;
    if (data.schema_version !== "2") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Load all *.json files from RESULTS_DIR, group by (variant, client, environment, kind),
 * and return the latest file per group sorted by timestamp_utc descending.
 */
export function loadResults(resultsDir = RESULTS_DIR): BenchmarkFile[] {
  let entries: string[];
  try {
    entries = readdirSync(resultsDir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  const parsed: Array<{ file: BenchmarkFile; kind: string }> = [];
  for (const filename of jsonFiles) {
    const filePath = path.join(resultsDir, filename);
    const file = parseResultFile(filePath);
    if (file) {
      parsed.push({ file, kind: kindFromFilename(filename) });
    }
  }

  // Group by key, keep latest per group
  const groups = new Map<string, BenchmarkFile>();
  for (const { file, kind } of parsed) {
    const key = groupKey(file, kind);
    const existing = groups.get(key);
    if (!existing || file.timestamp_utc > existing.timestamp_utc) {
      groups.set(key, file);
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.timestamp_utc - a.timestamp_utc
  );
}
