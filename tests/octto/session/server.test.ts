import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import type { SessionStore } from "@/octto/session/sessions";
import { config } from "@/utils/config";

const SESSION_ID = "octto-session-1";
const PLACEHOLDER = "__OCTTO_SESSION_ID_PLACEHOLDER__";
const ORIGINAL_PORTAL_TOKEN = config.octto.portalToken;

function encodeSessionId(sessionId: string): string {
  return JSON.stringify(sessionId).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function fakeStore(known: Set<string>): SessionStore {
  return {
    startSession: async () => ({ session_id: "x", url: "x" }),
    endSession: async () => ({ ok: true }),
    pushQuestion: () => ({ question_id: "q" }),
    getAnswer: async () => ({ completed: false, status: "pending" }),
    getNextAnswer: async () => ({ completed: false, status: "none_pending" }),
    cancelQuestion: () => ({ ok: false }),
    listQuestions: () => ({ questions: [] }),
    handleWsConnect: () => {},
    handleWsDisconnect: () => {},
    handleWsMessage: () => {},
    getSession: (id) => (known.has(id) ? ({ id } as never) : undefined),
    cleanup: async () => {},
    hasSession: (id: string) => known.has(id),
    assertOwner: () => {},
    isOwner: () => true,
    listOwnedSessions: () => [],
  } as unknown as SessionStore;
}

function setPortalToken(token: string): void {
  Object.defineProperty(config.octto, "portalToken", {
    configurable: true,
    enumerable: true,
    value: token,
    writable: true,
  });
}

describe("shared octto server", () => {
  let known: Set<string>;
  let port: number;

  beforeEach(async () => {
    setPortalToken("");
    known = new Set([SESSION_ID]);
    const server = await getSharedServer(fakeStore(known), { port: 0 });
    port = server.port;
  });

  afterEach(async () => {
    await stopSharedServer();
    setPortalToken(ORIGINAL_PORTAL_TOKEN);
  });

  it("serves the portal landing on root path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Octto Portal");
  });

  it("serves the bundle with the sessionId injected for known sessions", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/s/${SESSION_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain(`const sessionId = JSON.parse("${encodeSessionId(SESSION_ID)}");`);
    expect(body).not.toContain(PLACEHOLDER);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/s/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("returns 200 ok on /healthz", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects ws upgrade for unknown sessionId with 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ws/unknown`, {
      headers: { upgrade: "websocket", connection: "upgrade" },
    });
    expect(res.status).toBe(404);
  });

  it("returns the same server handle on second getSharedServer call", async () => {
    const a = await getSharedServer(fakeStore(known), { port: 0 });
    const b = await getSharedServer(fakeStore(known), { port: 0 });
    expect(a.port).toBe(b.port);
  });
});
