import { describe, expect, it } from "bun:test";

import { notificationCourierAgent } from "@/agents/notification-courier";

describe("notificationCourierAgent", () => {
  it("is registered as a subagent", () => {
    expect(notificationCourierAgent.mode).toBe("subagent");
  });

  it("instructs the courier to call autoinfo_send_qq_notification", () => {
    expect(notificationCourierAgent.prompt).toContain("autoinfo_send_qq_notification");
  });

  it("forbids editing files or running shell commands", () => {
    expect(notificationCourierAgent.prompt.toLowerCase()).toContain("never edit");
    expect(notificationCourierAgent.prompt.toLowerCase()).toContain("never run");
  });

  it("uses a low temperature for deterministic dispatch", () => {
    expect(notificationCourierAgent.temperature ?? 0).toBeLessThanOrEqual(0.2);
  });
});
