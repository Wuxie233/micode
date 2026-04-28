import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("lifecycle journal/lease config", () => {
  it("exposes journal and lease suffix defaults", () => {
    expect(config.lifecycle.journalSuffix).toBe(".journal.jsonl");
    expect(config.lifecycle.leaseSuffix).toBe(".lease.json");
  });

  it("exposes lease ttl and heartbeat defaults", () => {
    expect(config.lifecycle.leaseTtlMs).toBe(600_000);
    expect(config.lifecycle.leaseHeartbeatMs).toBe(60_000);
  });

  it("preserves existing lifecycle keys", () => {
    expect(config.lifecycle.lifecycleDir).toBe("thoughts/lifecycle");
    expect(config.lifecycle.autoPush).toBe(true);
  });
});
