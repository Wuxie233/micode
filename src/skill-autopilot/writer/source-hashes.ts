import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const HASH_ALGORITHM = "sha256";
const HASH_ENCODING = "hex";

export type SourceHashMap = Readonly<Record<string, string>>;

function hashFile(path: string): string {
  return createHash(HASH_ALGORITHM).update(readFileSync(path)).digest(HASH_ENCODING);
}

export async function computeSourceHashes(paths: readonly string[]): Promise<SourceHashMap> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    hashes[path] = hashFile(path);
  }
  return hashes;
}

export async function isStale(captured: SourceHashMap): Promise<boolean> {
  for (const [path, hash] of Object.entries(captured)) {
    if (!existsSync(path)) return true;
    if (hashFile(path) !== hash) return true;
  }
  return false;
}
