import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createPortalRouter } from "@/octto/portal/register";
import type { SessionStore } from "@/octto/session";
import { createSessionStore, QUESTIONS } from "@/octto/session";
import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import { config } from "@/utils/config";

const OWNER = "owner-session-portal";
const PORTAL_TOKEN = "valid-portal-token";
const WRONG_TOKEN = "wrong-portal-token";
const COOKIE_NAME = "octto_portal_token";
const EPHEMERAL_PORT = 0;
const OK_STATUS = 200;
const UNAUTHORIZED_STATUS = 401;
const NOT_FOUND_STATUS = 404;
const ORIGINAL_PORTAL_TOKEN = config.octto.portalToken;
const ORIGINAL_OCTTO_PORT = config.octto.port;
const UNAUTHORIZED_HTML = "<!doctype html><title>Octto</title><body>Unauthorized</body>";
const PLACEHOLDER = "__OCTTO_SESSION_ID_PLACEHOLDER__";

interface ConversationHandle {
  readonly id: string;
  readonly questionId: string;
}

interface ConversationsPayload {
  readonly conversations: readonly { readonly id: string }[];
}

interface QuestionsPayload {
  readonly conversationId: string;
  readonly questions: readonly { readonly id: string }[];
}

function setPortalToken(token: string): void {
  Object.defineProperty(config.octto, "portalToken", {
    configurable: true,
    enumerable: true,
    value: token,
    writable: true,
  });
}

function setOcttoPort(port: number): void {
  Object.defineProperty(config.octto, "port", {
    configurable: true,
    enumerable: true,
    value: port,
    writable: true,
  });
}

function cookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function encodeSessionId(sessionId: string): string {
  return JSON.stringify(sessionId).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function firstQuestionId(ids: readonly string[] | undefined): string {
  const questionId = ids?.[0];
  if (questionId) return questionId;
  throw new Error("Missing portal test question id");
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("octto portal router registration", () => {
  let store: SessionStore;
  let port: number;

  beforeEach(async () => {
    setOcttoPort(EPHEMERAL_PORT);
    setPortalToken("");
    store = createSessionStore({ skipBrowser: true });
    const handle = await getSharedServer(store, { port: EPHEMERAL_PORT });
    port = handle.port;
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
    setPortalToken(ORIGINAL_PORTAL_TOKEN);
    setOcttoPort(ORIGINAL_OCTTO_PORT);
  });

  it("exports a portal router factory", () => {
    expect(typeof createPortalRouter).toBe("function");
  });

  it("serves landing HTML on root and portal alias when auth is disabled", async () => {
    const root = await fetch(`http://127.0.0.1:${port}/`);
    const portal = await fetch(`http://127.0.0.1:${port}/portal`);

    expect(root.status).toBe(OK_STATUS);
    expect(portal.status).toBe(OK_STATUS);
    expect(root.headers.get("content-type") ?? "").toContain("text/html");
    expect(await root.text()).toContain("Octto Portal");
    expect(await portal.text()).toContain("Octto Portal");
  });

  it("sets a portal cookie from a landing query token and authorizes API cookies", async () => {
    setPortalToken(PORTAL_TOKEN);
    const conversation = await startConversation(store);

    const landing = await fetch(`http://127.0.0.1:${port}/?token=${encodeURIComponent(PORTAL_TOKEN)}`);
    const setCookie = landing.headers.get("set-cookie") ?? "";
    const response = await fetch(`http://127.0.0.1:${port}/api/conversations`, {
      headers: { cookie: setCookie },
    });
    const payload = await parseJson<ConversationsPayload>(response);

    expect(landing.status).toBe(OK_STATUS);
    expect(setCookie).toContain(`${COOKIE_NAME}=${encodeURIComponent(PORTAL_TOKEN)}`);
    expect(response.status).toBe(OK_STATUS);
    expect(payload.conversations.map((summary) => summary.id)).toContain(conversation.id);
  });

  it("rejects wrong tokens without leaking portal or API data", async () => {
    setPortalToken(PORTAL_TOKEN);
    const conversation = await startConversation(store);

    const portal = await fetch(`http://127.0.0.1:${port}/portal/${conversation.id}`, {
      headers: { cookie: cookie(WRONG_TOKEN) },
    });
    const api = await fetch(`http://127.0.0.1:${port}/api/conversations`, {
      headers: { cookie: cookie(WRONG_TOKEN) },
    });

    expect(portal.status).toBe(UNAUTHORIZED_STATUS);
    expect(await portal.text()).toBe(UNAUTHORIZED_HTML);
    expect(api.status).toBe(UNAUTHORIZED_STATUS);
    expect(await api.text()).toBe("Unauthorized");
  });

  it("serves the existing bundle on portal conversation routes", async () => {
    const conversation = await startConversation(store);

    const response = await fetch(`http://127.0.0.1:${port}/portal/${conversation.id}`);
    const unknown = await fetch(`http://127.0.0.1:${port}/portal/missing-conversation`);
    const body = await response.text();

    expect(response.status).toBe(OK_STATUS);
    expect(body).toContain(`const sessionId = JSON.parse("${encodeSessionId(conversation.id)}");`);
    expect(body).not.toContain(PLACEHOLDER);
    expect(unknown.status).toBe(NOT_FOUND_STATUS);
  });

  it("serves authenticated conversation questions and contract 404s", async () => {
    setPortalToken(PORTAL_TOKEN);
    const conversation = await startConversation(store);
    const headers = { cookie: cookie(PORTAL_TOKEN) };

    const response = await fetch(`http://127.0.0.1:${port}/api/conversations/${conversation.id}/questions`, {
      headers,
    });
    const missing = await fetch(`http://127.0.0.1:${port}/api/conversations/missing-conversation/questions`, {
      headers,
    });
    const payload = await parseJson<QuestionsPayload>(response);

    expect(response.status).toBe(OK_STATUS);
    expect(payload.conversationId).toBe(conversation.id);
    expect(payload.questions.map((question) => question.id)).toContain(conversation.questionId);
    expect(missing.status).toBe(NOT_FOUND_STATUS);
    expect(await missing.json()).toEqual({ error: "ConversationNotFound", conversationId: "missing-conversation" });
  });
});

async function startConversation(store: SessionStore): Promise<ConversationHandle> {
  const output = await store.startSession({
    ownerSessionID: OWNER,
    title: "Portal thread",
    questions: [{ type: QUESTIONS.ASK_TEXT, config: { question: "What should happen next?" } }],
  });

  return { id: output.session_id, questionId: firstQuestionId(output.question_ids) };
}
