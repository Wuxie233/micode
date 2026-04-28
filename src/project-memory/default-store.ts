import { createProjectMemoryStore, type ProjectMemoryStore } from "./store";

let memory: ProjectMemoryStore | null = null;
let initialized: Promise<void> | null = null;
let injected: ProjectMemoryStore | null = null;

function active(): ProjectMemoryStore {
  if (injected) return injected;
  if (!memory) memory = createProjectMemoryStore();
  return memory;
}

export async function getDefaultStore(): Promise<ProjectMemoryStore> {
  const current = active();
  if (!initialized) initialized = current.initialize();
  await initialized;
  return current;
}

export function setDefaultProjectMemoryStoreForTest(store: ProjectMemoryStore | null): void {
  injected = store;
  initialized = null;
}

export async function resetDefaultProjectMemoryStoreForTest(): Promise<void> {
  const current = memory;
  const test = injected;
  memory = null;
  injected = null;
  initialized = null;

  const closers: Promise<void>[] = [];
  if (current) closers.push(current.close());
  if (test && test !== current) closers.push(test.close());
  await Promise.all(closers);
}
