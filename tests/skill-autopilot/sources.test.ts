import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedgerTexts, readLifecycleRecord } from "@/skill-autopilot/sources";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sa-sources-"));
});

afterEach(() => {
  // best-effort
});

describe("sources", () => {
  it("reads lifecycle record by issue number", async () => {
    mkdirSync(join(tmp, "thoughts/lifecycle"), { recursive: true });
    writeFileSync(join(tmp, "thoughts/lifecycle/27.md"), "# 27\n");
    const out = await readLifecycleRecord({ cwd: tmp, issueNumber: 27 });
    expect(out).toBe("# 27\n");
  });

  it("returns null when lifecycle record missing", async () => {
    expect(await readLifecycleRecord({ cwd: tmp, issueNumber: 999 })).toBeNull();
  });

  it("reads ledger files matching the CONTINUITY_ pattern", async () => {
    mkdirSync(join(tmp, "thoughts/ledgers"), { recursive: true });
    writeFileSync(join(tmp, "thoughts/ledgers/CONTINUITY_a.md"), "a");
    writeFileSync(join(tmp, "thoughts/ledgers/notes.md"), "skip");
    const out = await readLedgerTexts({ cwd: tmp });
    expect(out.length).toBe(1);
    expect(out[0]?.text).toBe("a");
  });
});
