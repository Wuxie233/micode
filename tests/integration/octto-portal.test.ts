import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { COOKIE_NAME } from "@/octto/portal/auth";
import { createSessionStore, QUESTIONS, type SessionStore } from "@/octto/session";
import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import type { Question, Session } from "@/octto/session/types";
import { config } from "@/utils/config";

const EPHEMERAL_PORT = 0;
const OK_STATUS = 200;
const UNAUTHORIZED_STATUS = 401;
const CONVERSATION_COUNT = 2;
const QUESTION_COUNT = 2;
const SECRET_TOKEN = "secret";
const EMPTY_TOKEN = "";
const UNAUTHORIZED_TEXT = "Unauthorized";
const API_CONVERSATIONS_PATH = "/api/conversations";
const COOKIE_HEADER = "Cookie";
const OLDER_TITLE = "Older pending portal session";
const NEWER_TITLE = "Newer pending portal session";
const OLDER_OWNER = "portal-owner-one";
const NEWER_OWNER = "portal-owner-two";
const OLDER_CREATED_AT = new Date("2020-01-01T00:00:00.000Z");
const NEWER_CREATED_AT = new Date("2020-01-02T00:00:00.000Z");
const OLDEST_PENDING_AT = new Date("2020-02-01T00:00:00.000Z");
const NEWER_PENDING_AT = new Date("2020-02-02T00:00:00.000Z");
const ORIGINAL_OCTTO_PORT = config.octto.port;
const ORIGINAL_PORTAL_TOKEN = config.octto.portalToken;
const ORIGINAL_ENV_PORTAL_TOKEN = process.env.OCTTO_PORTAL_TOKEN;

interface ConversationSummary {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly pendingCount: number;
  readonly oldestPendingAgeMs: number | null;
  readonly ownerSessionId: string;
}

interface ConversationsResponse {
  readonly conversations: readonly ConversationSummary[];
}

interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly createdAt: Date;
}

interface PortalHarness {
  readonly port: number;
  readonly older: Conversation;
  readonly newer: Conversation;
}

function restoreField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function setOcttoPort(port: number): void {
  restoreField(config.octto, "port", port);
}

function setPortalToken(token: string): void {
  restoreField(config.octto, "portalToken", token);
}

function restoreEnv(): void {
  if (ORIGINAL_ENV_PORTAL_TOKEN === undefined) {
    delete process.env.OCTTO_PORTAL_TOKEN;
    return;
  }

  process.env.OCTTO_PORTAL_TOKEN = ORIGINAL_ENV_PORTAL_TOKEN;
}

function requireSession(store: SessionStore, id: string): Session {
  const session = store.getSession(id);
  if (session) return session;

  throw new Error(`Expected Octto session: ${id}`);
}

function setCreatedAt(target: Session | Question, value: Date): void {
  Object.defineProperty(target, "createdAt", {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function setQuestionDates(session: Session, value: Date): void {
  for (const question of session.questions.values()) setCreatedAt(question, value);
}

async function startConversation(
  store: SessionStore,
  title: string,
  owner: string,
  createdAt: Date,
  pendingAt: Date,
): Promise<Conversation> {
  const started = await store.startSession({
    ownerSessionID: owner,
    title,
    questions: [
      { type: QUESTIONS.ASK_TEXT, config: { question: `${title} first question` } },
      { type: QUESTIONS.ASK_TEXT, config: { question: `${title} second question` } },
    ],
  });
  const questionIds = started.question_ids ?? [];
  if (questionIds.length !== QUESTION_COUNT) throw new Error("Expected two initial question ids");

  const session = requireSession(store, started.session_id);
  setCreatedAt(session, createdAt);
  setQuestionDates(session, pendingAt);

  return { id: started.session_id, title, owner, createdAt };
}

async function bootPortal(store: SessionStore): Promise<PortalHarness> {
  const older = await startConversation(store, OLDER_TITLE, OLDER_OWNER, OLDER_CREATED_AT, OLDEST_PENDING_AT);
  const newer = await startConversation(store, NEWER_TITLE, NEWER_OWNER, NEWER_CREATED_AT, NEWER_PENDING_AT);
  const { port } = await getSharedServer(store);

  return { port, older, newer };
}

function conversationsUrl(port: number): string {
  return `http://127.0.0.1:${port}${API_CONVERSATIONS_PATH}`;
}

async function fetchConversations(port: number, cookie?: string): Promise<Response> {
  if (!cookie) return fetch(conversationsUrl(port));

  return fetch(conversationsUrl(port), { headers: { [COOKIE_HEADER]: cookie } });
}

async function readConversations(response: Response): Promise<ConversationsResponse> {
  return (await response.json()) as ConversationsResponse;
}

function assertSummary(summary: ConversationSummary, conversation: Conversation): void {
  expect(summary.id).toBe(conversation.id);
  expect(summary.title).toBe(conversation.title);
  expect(summary.createdAt).toBe(conversation.createdAt.toISOString());
  expect(summary.pendingCount).toBe(QUESTION_COUNT);
  expect(summary.ownerSessionId).toBe(conversation.owner);
  expect(typeof summary.oldestPendingAgeMs).toBe("number");
}

function assertConversations(payload: ConversationsResponse, older: Conversation, newer: Conversation): void {
  expect(payload.conversations).toHaveLength(CONVERSATION_COUNT);
  const [first, second] = payload.conversations;
  if (!first || !second) throw new Error("Expected two portal conversations");

  assertSummary(first, older);
  assertSummary(second, newer);
  if (first.oldestPendingAgeMs === null || second.oldestPendingAgeMs === null) {
    throw new Error("Expected pending conversations to include pending ages");
  }
  expect(first.oldestPendingAgeMs).toBeGreaterThan(second.oldestPendingAgeMs);
}

describe("octto portal API integration", () => {
  let store: SessionStore | undefined;

  beforeEach(() => {
    setOcttoPort(EPHEMERAL_PORT);
    setPortalToken(EMPTY_TOKEN);
    delete process.env.OCTTO_PORTAL_TOKEN;
  });

  afterEach(async () => {
    await store?.cleanup();
    store = undefined;
    await stopSharedServer();
    setOcttoPort(ORIGINAL_OCTTO_PORT);
    setPortalToken(ORIGINAL_PORTAL_TOKEN);
    restoreEnv();
  });

  it("lists active conversations sorted by oldest pending question and enforces cookie auth after restart", async () => {
    const portalStore = createSessionStore({ skipBrowser: true });
    store = portalStore;
    const harness = await bootPortal(portalStore);

    const openResponse = await fetchConversations(harness.port);
    expect(openResponse.status).toBe(OK_STATUS);
    assertConversations(await readConversations(openResponse), harness.older, harness.newer);

    process.env.OCTTO_PORTAL_TOKEN = SECRET_TOKEN;
    setPortalToken(SECRET_TOKEN);
    await stopSharedServer();
    const restarted = await getSharedServer(portalStore);

    const unauthorizedResponse = await fetchConversations(restarted.port);
    expect(unauthorizedResponse.status).toBe(UNAUTHORIZED_STATUS);
    expect(await unauthorizedResponse.text()).toBe(UNAUTHORIZED_TEXT);

    const cookie = `${COOKIE_NAME}=${SECRET_TOKEN}`;
    const authorizedResponse = await fetchConversations(restarted.port, cookie);
    expect(authorizedResponse.status).toBe(OK_STATUS);
    assertConversations(await readConversations(authorizedResponse), harness.older, harness.newer);
  });
});
