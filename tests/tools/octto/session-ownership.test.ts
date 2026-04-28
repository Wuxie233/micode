import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createSessionTools } from "@/tools/octto/session";
import { config } from "@/utils/config";

const fakeContext = (sessionID: string) => ({ sessionID }) as never;
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];
const EPHEMERAL_PORT = 0;
const ORIGINAL_OCTTO_PORT = config.octto.port;

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    value: port,
    writable: true,
  });
}

describe("session tools ownership", () => {
  let store: ReturnType<typeof createSessionStore>;
  let tools: ReturnType<typeof createSessionTools>;

  beforeEach(() => {
    setOcttoPort(EPHEMERAL_PORT);
    store = createSessionStore({ skipBrowser: true });
    tools = createSessionTools(store);
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
    setOcttoPort(ORIGINAL_OCTTO_PORT);
  });

  it("end_session refuses for a non-owning caller and returns the forbidden Markdown", async () => {
    const startOut = (await tools.start_session.execute(
      { questions: askText } as never,
      fakeContext("owner-A"),
    )) as string;
    const idMatch = /Session ID \| (\S+)/.exec(startOut);
    const id = idMatch?.[1] ?? "";
    expect(id).not.toBe("");

    const endOut = (await tools.end_session.execute({ session_id: id } as never, fakeContext("owner-B"))) as string;
    expect(endOut).toContain("## Forbidden");
    expect(endOut).toContain(`Session ${id}`);

    expect(store.hasSession(id)).toBe(true);
  });

  it("end_session works for the owning caller", async () => {
    const startOut = (await tools.start_session.execute(
      { questions: askText } as never,
      fakeContext("owner-A"),
    )) as string;
    const id = (/Session ID \| (\S+)/.exec(startOut) ?? [])[1] ?? "";
    const endOut = (await tools.end_session.execute({ session_id: id } as never, fakeContext("owner-A"))) as string;
    expect(endOut).toContain("ended successfully");
    expect(store.hasSession(id)).toBe(false);
  });
});
