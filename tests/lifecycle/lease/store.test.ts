import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLeaseStore } from "@/lifecycle/lease/store";

const ISSUE = 10;
const TTL = 60_000;

const baseInput = {
  issueNumber: ISSUE,
  owner: "session-a",
  host: "host-1",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  ttlMs: TTL,
};

describe("lease store", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-lease-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns null when no lease exists", async () => {
    const store = createLeaseStore({ baseDir });
    await expect(store.load(ISSUE)).resolves.toBeNull();
  });

  it("acquires a fresh lease", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    const outcome = await store.acquire(baseInput);
    expect(outcome.kind).toBe("acquired");
    if (outcome.kind === "acquired") expect(outcome.lease.owner).toBe("session-a");
    clock += 5_000;
    const loaded = await store.load(ISSUE);
    expect(loaded?.heartbeatAt).toBe(1_000);
  });

  it("returns held when an unexpired lease is owned by someone else", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += 1_000;
    const second = await store.acquire({ ...baseInput, owner: "session-b" });
    expect(second.kind).toBe("held");
  });

  it("steals an expired lease", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += TTL * 2;
    const second = await store.acquire({ ...baseInput, owner: "session-b" });
    expect(second.kind).toBe("expired_stolen");
    if (second.kind === "expired_stolen") expect(second.lease.owner).toBe("session-b");
  });

  it("heartbeat refreshes heartbeatAt for the owner", async () => {
    let clock = 1_000;
    const store = createLeaseStore({ baseDir, now: () => clock });
    await store.acquire(baseInput);
    clock += 5_000;
    const refreshed = await store.heartbeat(ISSUE, "session-a");
    expect(refreshed?.heartbeatAt).toBe(6_000);
  });

  it("heartbeat returns null when owner mismatches", async () => {
    const store = createLeaseStore({ baseDir });
    await store.acquire(baseInput);
    await expect(store.heartbeat(ISSUE, "intruder")).resolves.toBeNull();
  });

  it("release removes the lease only if owner matches", async () => {
    const store = createLeaseStore({ baseDir });
    await store.acquire(baseInput);
    await expect(store.release(ISSUE, "intruder")).resolves.toBe(false);
    await expect(store.release(ISSUE, "session-a")).resolves.toBe(true);
    await expect(store.load(ISSUE)).resolves.toBeNull();
  });
});
