import { describe, expect, it } from "bun:test";

import { octtoAgent } from "@/agents/octto";

describe("octto completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(octtoAgent.prompt).toContain("<completion-notify");
  });

  it("instructs octto to call autoinfo_send_qq_notification at terminal states for non-lifecycle work", () => {
    expect(octtoAgent.prompt).toContain(
      "For quick-mode and non-lifecycle work, when the task reaches a terminal state, call autoinfo_send_qq_notification exactly once before returning the final response.",
    );
  });

  it("references default private QQ user 445714414", () => {
    expect(octtoAgent.prompt).toContain("445714414");
  });
});
