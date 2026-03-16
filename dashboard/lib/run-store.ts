import { RunState, RunStatus } from "./types";

// Server-side singleton — survives hot-reload in dev via globalThis
const globalStore = globalThis as typeof globalThis & {
  __runStore?: Map<string, RunState>;
};

if (!globalStore.__runStore) {
  globalStore.__runStore = new Map<string, RunState>();
}

const store: Map<string, RunState> = globalStore.__runStore;

export function createRun(id: string): RunState {
  const state: RunState = {
    id,
    status: "running",
    output: "",
    startedAt: Date.now(),
  };
  store.set(id, state);
  return state;
}

export function getRun(id: string): RunState | undefined {
  return store.get(id);
}

export function appendOutput(id: string, chunk: string): void {
  const run = store.get(id);
  if (!run) return;
  run.output += chunk;
}

export function completeRun(id: string, resultFile?: string): void {
  const run = store.get(id);
  if (!run) return;
  run.status = "success";
  run.resultFile = resultFile;
}

export function failRun(id: string): void {
  const run = store.get(id);
  if (!run) return;
  run.status = "error";
}

export function setStatus(id: string, status: RunStatus): void {
  const run = store.get(id);
  if (!run) return;
  run.status = status;
}

export function allRuns(): RunState[] {
  return Array.from(store.values());
}

export function clearRun(id: string): boolean {
  return store.delete(id);
}
