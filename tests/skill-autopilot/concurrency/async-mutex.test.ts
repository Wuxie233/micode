import { describe, expect, it } from "bun:test";

import { createAsyncMutex } from "@/skill-autopilot/concurrency/async-mutex";

describe("createAsyncMutex", () => {
  it("serializes concurrent acquirers per key", async () => {
    const mu = createAsyncMutex();
    const order: string[] = [];
    const a = mu.run("k", async () => {
      order.push("a-start");
      await Bun.sleep(20);
      order.push("a-end");
    });
    const b = mu.run("k", async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("does not block different keys", async () => {
    const mu = createAsyncMutex();
    const order: string[] = [];
    const a = mu.run("k1", async () => {
      order.push("a-start");
      await Bun.sleep(30);
      order.push("a-end");
    });
    const b = mu.run("k2", async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([a, b]);
    expect(order[0]).toBe("a-start");
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });

  it("releases the mutex on caller exception", async () => {
    const mu = createAsyncMutex();
    await expect(
      mu.run("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(mu.run("k", async () => 1)).resolves.toBe(1);
  });
});
