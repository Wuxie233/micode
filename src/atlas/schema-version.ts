import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DECIMAL_RADIX = 10;
const MISSING_VERSION = 0;

export function readSchemaVersion(file: string): number {
  if (!existsSync(file)) return MISSING_VERSION;
  const raw = readFileSync(file, "utf8").trim();
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (!Number.isFinite(parsed)) return MISSING_VERSION;
  return parsed;
}

export function writeSchemaVersion(file: string, version: number): void {
  writeFileSync(file, `${version}\n`, "utf8");
}
