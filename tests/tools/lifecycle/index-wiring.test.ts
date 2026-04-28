import { describe, expect, it } from "bun:test";

import type { LifecycleHandle } from "@/lifecycle";
import type { ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleTools } from "@/tools/lifecycle";

describe("createLifecycleTools wiring", () => {
  it("exposes lifecycle_recovery_decision among the returned tools", () => {
    const handle = {
      decideRecovery: async () => ({ kind: "clean_resume", nextBatchId: null, lastSeq: 0 }),
    } as unknown as LifecycleHandle;
    const resolver = {
      current: async () => ({ kind: "none" as const }),
      resume: async () => {
        throw new Error("noop");
      },
    } as unknown as Resolver;
    const progress = {
      log: async () => ({ issueNumber: 0, kind: "status", commentUrl: null }),
      context: async () => ({ issueNumber: 0, body: "", recentProgress: [] }),
    } as unknown as ProgressLogger;
    const tools = createLifecycleTools(handle, resolver, progress);
    expect(typeof tools.lifecycle_recovery_decision).toBe("object");
  });
});
