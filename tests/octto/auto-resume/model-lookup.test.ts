import { describe, expect, it } from "bun:test";

import {
  createOwnerModelLookup,
  type OwnerModelClient,
  type SessionMessageWithInfo,
} from "../../../src/octto/auto-resume/model-lookup";

const OWNER_SESSION_ID = "owner-session-1";

function createClient(messages: readonly SessionMessageWithInfo[]): OwnerModelClient {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  };
}

describe("createOwnerModelLookup", () => {
  it("returns the most recent assistant message's provider and model", async () => {
    const client = createClient([
      { info: { role: "assistant", providerID: "anthropic", modelID: "claude-old" } },
      { info: { role: "user" } },
      { info: { role: "assistant", providerID: "wuxie-claude", modelID: "claude-opus-4-7" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toEqual({ providerID: "wuxie-claude", modelID: "claude-opus-4-7" });
  });

  it("ignores user messages and only inspects assistant info", async () => {
    const client = createClient([
      { info: { role: "user", providerID: "anthropic", modelID: "claude-user" } },
      { info: { role: "assistant", providerID: "openai", modelID: "gpt-5" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5" });
  });

  it("returns null when no assistant message carries provider and model", async () => {
    const client = createClient([
      { info: { role: "user" } },
      { info: { role: "assistant" } },
      { info: { role: "assistant", providerID: "anthropic" } },
    ]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("returns null when the response has no messages", async () => {
    const client = createClient([]);
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("swallows client errors and returns null", async () => {
    const failingClient: OwnerModelClient = {
      session: {
        messages: async () => {
          throw new Error("network error");
        },
      },
    };
    const lookup = createOwnerModelLookup({ client: failingClient });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });

  it("returns null when the data field is undefined", async () => {
    const client: OwnerModelClient = {
      session: {
        messages: async () => ({}),
      },
    };
    const lookup = createOwnerModelLookup({ client });

    const result = await lookup.resolve(OWNER_SESSION_ID);

    expect(result).toBeNull();
  });
});
