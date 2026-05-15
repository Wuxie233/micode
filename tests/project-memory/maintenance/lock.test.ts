import { describe, expect, it } from "bun:test";

import { acquireMaintenanceLock } from "@/project-memory/maintenance/lock";

const PROJECT_ONE = "project-lock-one";
const PROJECT_TWO = "project-lock-two";

describe("project-memory maintenance lock", () => {
  it("returns null for the same project until the lock is released", async () => {
    const lock = await acquireMaintenanceLock(PROJECT_ONE);

    expect(lock).not.toBeNull();
    expect(lock?.projectId).toBe(PROJECT_ONE);
    expect(await acquireMaintenanceLock(PROJECT_ONE)).toBeNull();

    await lock?.release();

    const reacquired = await acquireMaintenanceLock(PROJECT_ONE);
    expect(reacquired).not.toBeNull();
    await reacquired?.release();
  });

  it("allows different projects to hold locks concurrently", async () => {
    const first = await acquireMaintenanceLock(PROJECT_ONE);
    const second = await acquireMaintenanceLock(PROJECT_TWO);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.projectId).toBe(PROJECT_ONE);
    expect(second?.projectId).toBe(PROJECT_TWO);

    await first?.release();
    await second?.release();
  });

  it("allows expired locks to be reacquired without waiting", async () => {
    const expired = await acquireMaintenanceLock(PROJECT_ONE, { ttlMs: 0 });
    const reacquired = await acquireMaintenanceLock(PROJECT_ONE);

    expect(expired).not.toBeNull();
    expect(reacquired).not.toBeNull();
    expect(reacquired).not.toBe(expired);

    await expired?.release();
    expect(await acquireMaintenanceLock(PROJECT_ONE)).toBeNull();

    await reacquired?.release();
  });
});
