import path from "path";
import { BenchmarkFile } from "../lib/types";
import {
  kindFromFilename,
  groupKey,
  parseResultFile,
  loadResults,
} from "../lib/load-results";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<BenchmarkFile> = {}): BenchmarkFile {
  return {
    schema_version: "2",
    variant: "V1",
    variant_label: "ERC-20",
    client: "python",
    client_label: "Python / web3.py",
    environment: "hardhat-localnet",
    platform: "EVM",
    timestamp_utc: 1700000000,
    limitations: [],
    operations: [],
    throughput: { num_contributions: 50, total_time_ms: 5000, tps: 10 },
    ...overrides,
  };
}

// ─── kindFromFilename ────────────────────────────────────────────────────────

describe("kindFromFilename", () => {
  it("extracts 'lifecycle' from a standard filename", () => {
    expect(kindFromFilename("V1_python_hardhat-localnet_lifecycle.json")).toBe("lifecycle");
  });

  it("extracts 'throughput' from a throughput filename", () => {
    expect(kindFromFilename("V4_python_solana-localnet_throughput.json")).toBe("throughput");
  });

  it("works when given only the basename", () => {
    expect(kindFromFilename("V2_ts_sepolia_lifecycle.json")).toBe("lifecycle");
  });

  it("works with a full absolute path", () => {
    expect(
      kindFromFilename("/some/path/V3_dotnet_hardhat-localnet_throughput.json")
    ).toBe("throughput");
  });
});

// ─── groupKey ────────────────────────────────────────────────────────────────

describe("groupKey", () => {
  it("produces the expected underscore-delimited key", () => {
    const file = makeFile();
    expect(groupKey(file, "lifecycle")).toBe(
      "V1_python_hardhat-localnet_lifecycle"
    );
  });

  it("differentiates variants", () => {
    const v4 = makeFile({ variant: "V4", client: "python", environment: "solana-localnet" });
    expect(groupKey(v4, "lifecycle")).toBe("V4_python_solana-localnet_lifecycle");
  });

  it("differentiates kind", () => {
    const file = makeFile();
    expect(groupKey(file, "lifecycle")).not.toBe(groupKey(file, "throughput"));
  });
});

// ─── parseResultFile ─────────────────────────────────────────────────────────

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(),
}));

import { readFileSync } from "fs";
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe("parseResultFile", () => {
  afterEach(() => jest.resetAllMocks());

  it("parses a valid schema_version '2' file", () => {
    const file = makeFile();
    mockReadFileSync.mockReturnValue(JSON.stringify(file) as any);
    expect(parseResultFile("/fake/path.json")).toEqual(file);
  });

  it("returns null for wrong schema_version", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ schema_version: "1" }) as any);
    expect(parseResultFile("/fake/path.json")).toBeNull();
  });

  it("returns null when readFileSync throws", () => {
    mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(parseResultFile("/fake/path.json")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mockReadFileSync.mockReturnValue("not json" as any);
    expect(parseResultFile("/fake/path.json")).toBeNull();
  });
});

// ─── loadResults ─────────────────────────────────────────────────────────────

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

import { readdirSync } from "fs";
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;

describe("loadResults", () => {
  const dir = "/fake/results";

  afterEach(() => jest.resetAllMocks());

  it("returns [] when the directory cannot be read", () => {
    mockReaddirSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(loadResults(dir)).toEqual([]);
  });

  it("returns [] when directory is empty", () => {
    mockReaddirSync.mockReturnValue([] as any);
    expect(loadResults(dir)).toEqual([]);
  });

  it("skips non-JSON files", () => {
    mockReaddirSync.mockReturnValue(["README.md", "notes.txt"] as any);
    expect(loadResults(dir)).toEqual([]);
  });

  it("returns a single parsed file", () => {
    const file = makeFile({ timestamp_utc: 1700000001 });
    mockReaddirSync.mockReturnValue(["V1_python_hardhat-localnet_lifecycle.json"] as any);
    mockReadFileSync.mockReturnValue(JSON.stringify(file) as any);
    const results = loadResults(dir);
    expect(results).toHaveLength(1);
    expect(results[0].variant).toBe("V1");
  });

  it("keeps only the latest file per group", () => {
    const older = makeFile({ timestamp_utc: 1700000000 });
    const newer = makeFile({ timestamp_utc: 1700000999 });
    mockReaddirSync.mockReturnValue([
      "V1_python_hardhat-localnet_lifecycle.json",
      "V1_python_hardhat-localnet_lifecycle.json", // same key, different content via mock
    ] as any);
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(older) as any)
      .mockReturnValueOnce(JSON.stringify(newer) as any);
    const results = loadResults(dir);
    expect(results).toHaveLength(1);
    expect(results[0].timestamp_utc).toBe(1700000999);
  });

  it("returns multiple files for different groups", () => {
    const v1 = makeFile({ variant: "V1", timestamp_utc: 1700000001 });
    const v4 = makeFile({ variant: "V4", client: "python", environment: "solana-localnet", platform: "Solana", timestamp_utc: 1700000002 });
    mockReaddirSync.mockReturnValue([
      "V1_python_hardhat-localnet_lifecycle.json",
      "V4_python_solana-localnet_lifecycle.json",
    ] as any);
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(v1) as any)
      .mockReturnValueOnce(JSON.stringify(v4) as any);
    const results = loadResults(dir);
    expect(results).toHaveLength(2);
  });

  it("sorts results by timestamp_utc descending", () => {
    const v1 = makeFile({ variant: "V1", timestamp_utc: 1700000001 });
    const v4 = makeFile({ variant: "V4", client: "python", environment: "solana-localnet", platform: "Solana", timestamp_utc: 1700000999 });
    mockReaddirSync.mockReturnValue([
      "V1_python_hardhat-localnet_lifecycle.json",
      "V4_python_solana-localnet_lifecycle.json",
    ] as any);
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(v1) as any)
      .mockReturnValueOnce(JSON.stringify(v4) as any);
    const results = loadResults(dir);
    expect(results[0].timestamp_utc).toBeGreaterThan(results[1].timestamp_utc);
  });

  it("skips files with invalid JSON silently", () => {
    const file = makeFile();
    mockReaddirSync.mockReturnValue([
      "V1_python_hardhat-localnet_lifecycle.json",
      "corrupt.json",
    ] as any);
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(file) as any)
      .mockReturnValueOnce("bad json" as any);
    expect(loadResults(dir)).toHaveLength(1);
  });
});
