import { readFileSync, readdirSync } from "fs";
import path from "path";
import { BenchmarkFile } from "./types";

export const RESULTS_DIR = path.resolve(process.cwd(), "../benchmarks/results");

/** Extract the kind segment ("lifecycle" | "throughput") from a result filename.
 *  Handles both old ({VARIANT}_{CLIENT}_{ENV}_{kind}.json) and
 *  new ({VARIANT}_{CLIENT}_{ENV}_{kind}_{timestamp}.json) naming schemes.
 */
export function kindFromFilename(filename: string): string {
    const base = path.basename(filename, ".json");
    const parts = base.split("_");
    // If the last segment is all digits it's a timestamp; kind is second-to-last
    const last = parts[parts.length - 1];
    return /^\d+$/.test(last) ? parts[parts.length - 2] : last;
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

    return parsed
        .map(({ file, kind }) => ({ ...file, kind }))
        .sort((a, b) => b.timestamp_utc - a.timestamp_utc);
}
