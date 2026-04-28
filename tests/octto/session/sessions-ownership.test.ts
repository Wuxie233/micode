import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { OcttoForbiddenError } from "@/octto/session/errors";
import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { config } from "@/utils/config";

const QUESTIONS = [{ type: "ask_text" as const, config: { question: "hi" } }];
const EPHEMERAL_PORT = 0;
const PUBLIC_BASE_URL_ENV = "OCTTO_PUBLIC_BASE_URL";
const PUBLIC_BASE_URL = "https://octto.wuxie233.com";
const ORIGINAL_OCTTO_PORT = config.octto.port;

async function loadPublicBaseUrl(cacheKey: string): Promise<string> {
  const mod = await import(`../../../src/utils/config.ts?cache=${cacheKey}`);
  return mod.config.octto.publicBaseUrl;
}

function setPublicBaseUrl(publicBaseUrl: string): void {
  Object.defineProperty(config.octto, "publicBaseUrl", {
    configurable: true,
    value: publicBaseUrl,
    writable: true,
  });
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    value: port,
    writable: true,
  });
}

describe("session store ownership and shared server", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    setOcttoPort(EPHEMERAL_PORT);
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
    setOcttoPort(ORIGINAL_OCTTO_PORT);
  });

  it("records ownerSessionID at startSession and exposes it via getSession", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const session = store.getSession(out.session_id);
    expect(session?.ownerSessionID).toBe("owner-A");
  });

  it("assertOwner throws OcttoForbiddenError when the caller does not match", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(() => store.assertOwner(out.session_id, "owner-B")).toThrow(OcttoForbiddenError);
    expect(store.assertOwner(out.session_id, "owner-A")).toBeUndefined();
  });

  it("isOwner returns true only for the exact owner", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(store.isOwner(out.session_id, "owner-A")).toBe(true);
    expect(store.isOwner(out.session_id, "owner-B")).toBe(false);
    expect(store.isOwner("nonexistent", "owner-A")).toBe(false);
  });

  it("listOwnedSessions filters by owner", async () => {
    const a1 = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const a2 = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const b1 = await store.startSession({ ownerSessionID: "owner-B", questions: QUESTIONS });

    expect(store.listOwnedSessions("owner-A").sort()).toEqual([a1.session_id, a2.session_id].sort());
    expect(store.listOwnedSessions("owner-B")).toEqual([b1.session_id]);
  });

  it("returns a session url derived from OCTTO_PUBLIC_BASE_URL and strips trailing slash", async () => {
    const originalEnv = process.env[PUBLIC_BASE_URL_ENV];
    const originalPublicBaseUrl = config.octto.publicBaseUrl;
    process.env[PUBLIC_BASE_URL_ENV] = `${PUBLIC_BASE_URL}/`;

    try {
      setPublicBaseUrl(await loadPublicBaseUrl("session-store-public-base-url"));
      const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
      expect(out.url).toBe(`${PUBLIC_BASE_URL}/s/${out.session_id}`);
    } finally {
      if (originalEnv === undefined) delete process.env[PUBLIC_BASE_URL_ENV];
      else process.env[PUBLIC_BASE_URL_ENV] = originalEnv;
      setPublicBaseUrl(originalPublicBaseUrl);
    }
  });

  it("hasSession reflects current sessions", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(store.hasSession(out.session_id)).toBe(true);
    expect(store.hasSession("missing")).toBe(false);

    await store.endSession(out.session_id);
    expect(store.hasSession(out.session_id)).toBe(false);
  });
});
