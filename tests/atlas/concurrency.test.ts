import { describe, expect, it } from "bun:test";

import { createSemaphore } from "@/atlas/concurrency";

describe("semaphore", () => {
  it("limits parallel acquires to the configured cap", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let max = 0;
    const wait = async (): Promise<void> => {
      await sem.acquire();
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      sem.release();
    };
    await Promise.all([wait(), wait(), wait(), wait(), wait()]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it("rejects non-positive cap", () => {
    expect(() => createSemaphore(0)).toThrow();
  });
});
