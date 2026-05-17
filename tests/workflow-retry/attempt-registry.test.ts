import { describe, expect, it } from "bun:test";

import { createAttemptRegistry } from "../../src/workflow-retry/attempt-registry";

const MAX_ATTEMPTS = 20;
const DEFAULT_EXPIRY_MS = 60_000;
const SHORT_EXPIRY_MS = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("createAttemptRegistry", () => {
  it("first record returns attempt = 1", () => {
    const reg = createAttemptRegistry({ maxAttempts: MAX_ATTEMPTS, expiryMs: DEFAULT_EXPIRY_MS });

    expect(reg.record("k1")).toEqual({ attempt: 1, exhausted: false });
  });

  it("increments per record until maxAttempts", () => {
    const reg = createAttemptRegistry({ maxAttempts: 3, expiryMs: DEFAULT_EXPIRY_MS });

    expect(reg.record("k1")).toEqual({ attempt: 1, exhausted: false });
    expect(reg.record("k1")).toEqual({ attempt: 2, exhausted: false });
    expect(reg.record("k1")).toEqual({ attempt: 3, exhausted: true });
    expect(reg.record("k1")).toEqual({ attempt: 3, exhausted: true });
  });

  it("isProcessing dedup window prevents concurrent triggers", () => {
    const reg = createAttemptRegistry({ maxAttempts: MAX_ATTEMPTS, expiryMs: DEFAULT_EXPIRY_MS });

    expect(reg.beginProcessing("k1")).toBe(true);
    expect(reg.beginProcessing("k1")).toBe(false);
    reg.endProcessing("k1");
    expect(reg.beginProcessing("k1")).toBe(true);
  });

  it("processing key auto-expires after expiryMs", async () => {
    const reg = createAttemptRegistry({ maxAttempts: MAX_ATTEMPTS, expiryMs: SHORT_EXPIRY_MS });

    expect(reg.beginProcessing("k1")).toBe(true);
    await sleep(SHORT_EXPIRY_MS + 5);
    expect(reg.beginProcessing("k1")).toBe(true);
  });

  it("clearSession removes all keys with sessionId prefix", () => {
    const reg = createAttemptRegistry({ maxAttempts: MAX_ATTEMPTS, expiryMs: DEFAULT_EXPIRY_MS });

    reg.record("ses_a:upstream_error");
    reg.record("ses_a:other");
    reg.record("ses_b:upstream_error");
    expect(reg.beginProcessing("ses_a:upstream_error")).toBe(true);
    reg.clearSession("ses_a");

    expect(reg.record("ses_a:upstream_error")).toEqual({ attempt: 1, exhausted: false });
    expect(reg.beginProcessing("ses_a:upstream_error")).toBe(true);
    expect(reg.record("ses_b:upstream_error")).toEqual({ attempt: 2, exhausted: false });
  });

  it("reset clears all", () => {
    const reg = createAttemptRegistry({ maxAttempts: MAX_ATTEMPTS, expiryMs: DEFAULT_EXPIRY_MS });

    reg.record("k1");
    reg.record("k2");
    expect(reg.beginProcessing("k1")).toBe(true);
    reg.reset();

    expect(reg.record("k1")).toEqual({ attempt: 1, exhausted: false });
    expect(reg.beginProcessing("k1")).toBe(true);
  });
});
