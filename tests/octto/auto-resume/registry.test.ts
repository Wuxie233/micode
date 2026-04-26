import { describe, expect, it } from "bun:test";

import { createAutoResumeRegistry } from "../../../src/octto/auto-resume/registry";

const CONVERSATION_ID = "conversation-1";
const OWNER_SESSION_ID = "owner-session-1";

describe("auto-resume registry", () => {
  it("returns the owner session id after registration", () => {
    const registry = createAutoResumeRegistry();

    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);

    expect(registry.lookup(CONVERSATION_ID)).toBe(OWNER_SESSION_ID);
  });

  it("returns null after unregistering a conversation", () => {
    const registry = createAutoResumeRegistry();

    registry.register(CONVERSATION_ID, OWNER_SESSION_ID);
    registry.unregister(CONVERSATION_ID);

    expect(registry.lookup(CONVERSATION_ID)).toBeNull();
  });
});
