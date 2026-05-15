import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { config } from "@/utils/config";
import { normalizeProjectOrigin } from "@/utils/project-id";

const REGISTRY_VERSION = 1;
const JSON_INDENT = 2;

export interface ProjectRegistryRecord {
  readonly projectId: string;
  readonly origin?: string;
  readonly aliases: readonly string[];
  readonly worktrees: readonly string[];
  readonly updatedAt: number;
}

export interface ProjectRegistry {
  load(): Promise<readonly ProjectRegistryRecord[]>;
  upsert(record: ProjectRegistryRecord): Promise<void>;
  findByAlias(alias: string): Promise<readonly ProjectRegistryRecord[]>;
  findByOrigin(origin: string): Promise<readonly ProjectRegistryRecord[]>;
  findByWorktree(path: string): Promise<readonly ProjectRegistryRecord[]>;
}

interface RegistryFile {
  readonly version: number;
  readonly records: readonly ProjectRegistryRecord[];
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function registryRecordFromUnknown(value: unknown): ProjectRegistryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.projectId !== "string" || typeof record.updatedAt !== "number") return null;

  return normalizeRegistryRecord({
    projectId: record.projectId,
    origin: typeof record.origin === "string" ? record.origin : undefined,
    aliases: stringArray(record.aliases),
    worktrees: stringArray(record.worktrees),
    updatedAt: record.updatedAt,
  });
}

export function normalizeRegistryRecord(input: ProjectRegistryRecord): ProjectRegistryRecord {
  return {
    projectId: input.projectId,
    origin: input.origin ? normalizeProjectOrigin(input.origin) : undefined,
    aliases: normalizeAliases(input.aliases),
    worktrees: normalizeWorktrees(input.worktrees),
    updatedAt: input.updatedAt,
  };
}

function normalizeAliases(aliases: readonly string[]): readonly string[] {
  return unique(aliases.map((alias) => alias.trim().toLowerCase()).filter((alias) => alias.length > 0));
}

function normalizeWorktrees(worktrees: readonly string[]): readonly string[] {
  return unique(worktrees.map((worktree) => resolve(worktree)));
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function parseRegistryFile(text: string): readonly ProjectRegistryRecord[] {
  const parsed = JSON.parse(text) as Partial<RegistryFile>;
  if (parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.records)) return [];
  return parsed.records
    .map((record: unknown) => registryRecordFromUnknown(record))
    .filter((record): record is ProjectRegistryRecord => record !== null);
}

function writeRegistryFile(filePath: string, records: readonly ProjectRegistryRecord[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload: RegistryFile = { version: REGISTRY_VERSION, records };
  writeFileSync(tempPath, `${JSON.stringify(payload, null, JSON_INDENT)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function createProjectRegistry(options: { readonly filePath?: string } = {}): ProjectRegistry {
  const filePath = options.filePath ?? config.projectMemory.registryFile;

  async function load(): Promise<readonly ProjectRegistryRecord[]> {
    if (!existsSync(filePath)) return [];
    return parseRegistryFile(readFileSync(filePath, "utf8"));
  }

  return {
    load,

    async upsert(record: ProjectRegistryRecord): Promise<void> {
      const normalized = normalizeRegistryRecord(record);
      const records = await load();
      const next = [...records.filter((current) => current.projectId !== normalized.projectId), normalized];
      writeRegistryFile(filePath, next);
    },

    async findByAlias(alias: string): Promise<readonly ProjectRegistryRecord[]> {
      const normalized = alias.trim().toLowerCase();
      if (normalized.length === 0) return [];
      return (await load()).filter((record) => record.aliases.includes(normalized));
    },

    async findByOrigin(origin: string): Promise<readonly ProjectRegistryRecord[]> {
      const normalized = normalizeProjectOrigin(origin);
      return (await load()).filter((record) => record.origin === normalized);
    },

    async findByWorktree(path: string): Promise<readonly ProjectRegistryRecord[]> {
      const normalized = resolve(path);
      return (await load()).filter((record) => record.worktrees.includes(normalized));
    },
  };
}
