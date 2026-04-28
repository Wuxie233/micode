import {
  getDefaultStore,
  type ProjectMemoryStore,
  resetDefaultProjectMemoryStoreForTest,
  setDefaultProjectMemoryStoreForTest,
} from "@/project-memory";
import { type ProjectIdentity, resolveProjectId } from "@/utils/project-id";

export async function getStore(): Promise<ProjectMemoryStore> {
  return getDefaultStore();
}

export async function getIdentity(directory: string): Promise<ProjectIdentity> {
  return resolveProjectId(directory);
}

export function setProjectMemoryStoreForTest(memory: ProjectMemoryStore | null): void {
  setDefaultProjectMemoryStoreForTest(memory);
}

export async function resetProjectMemoryRuntimeForTest(): Promise<void> {
  await resetDefaultProjectMemoryStoreForTest();
}
