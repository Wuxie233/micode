// tests/hooks/ledger-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ledger-loader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ledger-test-${Date.now()}`);
    mkdirSync(join(testDir, "thoughts", "ledgers"), { recursive: true });
  });

  it("should find ledger files in thoughts/ledgers/", async () => {
    const ledgerPath = join(testDir, "thoughts", "ledgers", "CONTINUITY_test-session.md");
    writeFileSync(ledgerPath, "# Session: test-session\n\n## Goal\nTest goal");

    const { findCurrentLedger } = await import("../../src/hooks/ledger-loader");
    const result = await findCurrentLedger(testDir);

    expect(result).not.toBeNull();
    expect(result?.sessionName).toBe("test-session");
  });

  it("should return null when no ledger exists", async () => {
    const { findCurrentLedger } = await import("../../src/hooks/ledger-loader");
    const result = await findCurrentLedger(testDir);

    expect(result).toBeNull();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
});
