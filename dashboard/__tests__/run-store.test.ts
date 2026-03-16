import {
  createRun,
  getRun,
  appendOutput,
  completeRun,
  failRun,
  setStatus,
  allRuns,
  clearRun,
} from "../lib/run-store";

// Reset the global store between tests
beforeEach(() => {
  const g = globalThis as any;
  if (g.__runStore) g.__runStore.clear();
});

describe("createRun", () => {
  it("creates a run with status 'running'", () => {
    const run = createRun("r1");
    expect(run.id).toBe("r1");
    expect(run.status).toBe("running");
    expect(run.output).toBe("");
    expect(run.resultFile).toBeUndefined();
  });

  it("persists the run so getRun returns it", () => {
    createRun("r2");
    expect(getRun("r2")).toBeDefined();
  });

  it("sets startedAt to a recent timestamp", () => {
    const before = Date.now();
    const run = createRun("r3");
    expect(run.startedAt).toBeGreaterThanOrEqual(before);
    expect(run.startedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("getRun", () => {
  it("returns undefined for unknown id", () => {
    expect(getRun("unknown")).toBeUndefined();
  });

  it("returns the run for a known id", () => {
    createRun("r4");
    expect(getRun("r4")?.id).toBe("r4");
  });
});

describe("appendOutput", () => {
  it("appends chunks to run output", () => {
    createRun("r5");
    appendOutput("r5", "hello ");
    appendOutput("r5", "world");
    expect(getRun("r5")?.output).toBe("hello world");
  });

  it("is a no-op for unknown id", () => {
    expect(() => appendOutput("nope", "data")).not.toThrow();
  });
});

describe("completeRun", () => {
  it("sets status to 'success' and stores resultFile", () => {
    createRun("r6");
    completeRun("r6", "benchmarks/results/V1_python_hardhat-localnet_lifecycle.json");
    const run = getRun("r6");
    expect(run?.status).toBe("success");
    expect(run?.resultFile).toBe(
      "benchmarks/results/V1_python_hardhat-localnet_lifecycle.json"
    );
  });

  it("sets status to 'success' without resultFile", () => {
    createRun("r7");
    completeRun("r7");
    expect(getRun("r7")?.status).toBe("success");
    expect(getRun("r7")?.resultFile).toBeUndefined();
  });

  it("is a no-op for unknown id", () => {
    expect(() => completeRun("nope")).not.toThrow();
  });
});

describe("failRun", () => {
  it("sets status to 'error'", () => {
    createRun("r8");
    failRun("r8");
    expect(getRun("r8")?.status).toBe("error");
  });

  it("is a no-op for unknown id", () => {
    expect(() => failRun("nope")).not.toThrow();
  });
});

describe("setStatus", () => {
  it("updates status to any RunStatus", () => {
    createRun("r9");
    setStatus("r9", "error");
    expect(getRun("r9")?.status).toBe("error");
    setStatus("r9", "running");
    expect(getRun("r9")?.status).toBe("running");
  });

  it("is a no-op for unknown id", () => {
    expect(() => setStatus("nope", "success")).not.toThrow();
  });
});

describe("allRuns", () => {
  it("returns empty array when store is empty", () => {
    expect(allRuns()).toEqual([]);
  });

  it("returns all created runs", () => {
    createRun("a1");
    createRun("a2");
    const ids = allRuns().map((r) => r.id);
    expect(ids).toContain("a1");
    expect(ids).toContain("a2");
  });
});

describe("clearRun", () => {
  it("removes the run and returns true", () => {
    createRun("r10");
    expect(clearRun("r10")).toBe(true);
    expect(getRun("r10")).toBeUndefined();
  });

  it("returns false for unknown id", () => {
    expect(clearRun("nope")).toBe(false);
  });
});
