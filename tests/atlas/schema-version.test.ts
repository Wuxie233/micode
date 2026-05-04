import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { readSchemaVersion, writeSchemaVersion } from "@/atlas/schema-version";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-schema-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("schema version codec", () => {
  it("returns 0 when file missing", () => {
    expect(readSchemaVersion(join(dir, "missing"))).toBe(0);
  });

  it("reads written version", () => {
    const file = join(dir, "schema-version");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "1\n", "utf8");
    expect(readSchemaVersion(file)).toBe(1);
  });

  it("writes the current schema version", () => {
    const file = join(dir, "schema-version");
    writeSchemaVersion(file, ATLAS_SCHEMA_VERSION);
    expect(readSchemaVersion(file)).toBe(ATLAS_SCHEMA_VERSION);
  });

  it("returns 0 on garbage content", () => {
    const file = join(dir, "schema-version");
    writeFileSync(file, "not-a-number", "utf8");
    expect(readSchemaVersion(file)).toBe(0);
  });
});
