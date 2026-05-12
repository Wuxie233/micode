import { describe, expect, it } from "bun:test";

import { createDefaultScheduler, type Scheduler } from "../../../src/octto/auto-resume/scheduler";

describe("default scheduler", () => {
  it("invokes the callback after the requested delay", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = false;

    const handle = scheduler.schedule(() => {
      fired = true;
    }, 10);

    expect(typeof handle.cancel).toBe("function");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(true);
  });

  it("cancel prevents a pending callback from firing", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = false;

    const handle = scheduler.schedule(() => {
      fired = true;
    }, 10);
    handle.cancel();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(false);
  });

  it("cancel after fire is a no-op", async () => {
    const scheduler: Scheduler = createDefaultScheduler();
    let fired = 0;

    const handle = scheduler.schedule(() => {
      fired += 1;
    }, 5);

    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.cancel();
    expect(fired).toBe(1);
  });
});
