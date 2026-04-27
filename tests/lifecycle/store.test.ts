import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore } from "@/lifecycle/store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const PREFIX = "micode-lifecycle-store-";
const ISSUE_ONE = 1;
const ISSUE_TWO = 2;
const ISSUE_THREE = 3;
const MISSING_ISSUE = 404;
const INVALID_ISSUE = 0;
const UPDATED_AT = 1_776_000_000_000;
const MALFORMED_JSON = "{";

const createRecord = (issueNumber = ISSUE_ONE): LifecycleRecord => ({
  issueNumber,
  issueUrl: `https://github.com/Wuxie233/micode/issues/${issueNumber}`,
  branch: `issue/${issueNumber}-lifecycle`,
  worktree: `/tmp/micode-issue-${issueNumber}`,
  state: LIFECYCLE_STATES.PROPOSED,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: UPDATED_AT,
});

describe("lifecycle store", () => {
  let baseDir: string;
  let warning: ReturnType<typeof spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    warning = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warning.mockRestore();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("round trips lifecycle records", async () => {
    const store = createLifecycleStore({ baseDir });
    const record = createRecord();

    await store.save(record);

    await expect(store.load(record.issueNumber)).resolves.toEqual(record);
  });

  it("returns null for missing lifecycle records", async () => {
    const store = createLifecycleStore({ baseDir });

    await expect(store.load(MISSING_ISSUE)).resolves.toBeNull();
  });

  it("returns null and warns for malformed JSON", async () => {
    const store = createLifecycleStore({ baseDir });
    writeFileSync(join(baseDir, `${ISSUE_ONE}.json`), MALFORMED_JSON);

    await expect(store.load(ISSUE_ONE)).resolves.toBeNull();
    expect(warning).toHaveBeenCalled();
  });

  it("returns null and warns for schema-invalid JSON", async () => {
    const store = createLifecycleStore({ baseDir });
    writeFileSync(join(baseDir, `${ISSUE_ONE}.json`), JSON.stringify({ ...createRecord(), state: "unknown" }));

    await expect(store.load(ISSUE_ONE)).resolves.toBeNull();
    expect(warning).toHaveBeenCalled();
  });

  it("lists issue numbers sorted ascending", async () => {
    const store = createLifecycleStore({ baseDir });

    await store.save(createRecord(ISSUE_THREE));
    await store.save(createRecord(ISSUE_ONE));
    await store.save(createRecord(ISSUE_TWO));
    writeFileSync(join(baseDir, "ignored.txt"), "ignored");

    await expect(store.list()).resolves.toEqual([ISSUE_ONE, ISSUE_TWO, ISSUE_THREE]);
  });

  it("deletes lifecycle records", async () => {
    const store = createLifecycleStore({ baseDir });
    const record = createRecord();

    await store.save(record);
    await store.delete(record.issueNumber);

    await expect(store.load(record.issueNumber)).resolves.toBeNull();
  });

  it("rejects invalid issue numbers", async () => {
    const store = createLifecycleStore({ baseDir });

    await expect(store.load(INVALID_ISSUE)).rejects.toThrow("Invalid issue number");
  });
});
