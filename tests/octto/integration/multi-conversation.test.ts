import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";

const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];
const LOOPBACK_HOST = "127.0.0.1";
const OWNER_A = "owner-A";
const OWNER_B = "owner-B";
const ANSWER_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 25;
const SOCKET_OPEN_TIMEOUT_MS = 1_000;
const SOCKET_CLOSE_TIMEOUT_MS = 1_000;

function firstQuestionId(store: ReturnType<typeof createSessionStore>, sessionId: string): string {
  return [...(store.getSession(sessionId)?.questions.keys() ?? [])][0] ?? "";
}

function sessionUrl(port: number, sessionId: string): string {
  return `http://${LOOPBACK_HOST}:${port}/s/${sessionId}`;
}

function websocketUrl(port: number, sessionId: string): string {
  return `ws://${LOOPBACK_HOST}:${port}/ws/${sessionId}`;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timed out")), SOCKET_OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket open failed"));
    };
  });
}

async function waitForAnswered(
  store: ReturnType<typeof createSessionStore>,
  sessionId: string,
  questionId: string,
): Promise<void> {
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const question = store.getSession(sessionId)?.questions.get(questionId);
    if (question?.status === "answered") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function closeSocket(
  socket: WebSocket,
  store: ReturnType<typeof createSessionStore>,
  sessionId: string,
): Promise<void> {
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate();

  const deadline = Date.now() + SOCKET_CLOSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!store.getSession(sessionId)?.wsConnected) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

describe("octto multi-conversation integration", () => {
  let store: ReturnType<typeof createSessionStore>;
  let port: number;

  beforeAll(async () => {
    store = createSessionStore({ skipBrowser: true });
    const handle = await getSharedServer(store, { port: 0 });
    port = handle.port;
  });

  afterAll(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("isolates two sessions on the same shared server", async () => {
    const sessionA = await store.startSession({ ownerSessionID: OWNER_A, questions: askText });
    const sessionB = await store.startSession({ ownerSessionID: OWNER_B, questions: askText });
    const sessionAResponse = await fetch(sessionUrl(port, sessionA.session_id));
    const sessionBResponse = await fetch(sessionUrl(port, sessionB.session_id));

    expect(sessionAResponse.status).toBe(200);
    expect(sessionBResponse.status).toBe(200);
    await Promise.all([sessionAResponse.text(), sessionBResponse.text()]);
    expect(store.isOwner(sessionA.session_id, OWNER_A)).toBe(true);
    expect(store.isOwner(sessionA.session_id, OWNER_B)).toBe(false);
    expect(store.isOwner(sessionB.session_id, OWNER_B)).toBe(true);
  });

  it("delivers a WS response only to the owning session's waiter", async () => {
    const sessionA = await store.startSession({ ownerSessionID: OWNER_A, questions: askText });
    const sessionB = await store.startSession({ ownerSessionID: OWNER_B, questions: askText });
    const questionAId = firstQuestionId(store, sessionA.session_id);
    const questionBId = firstQuestionId(store, sessionB.session_id);
    const socketA = new WebSocket(websocketUrl(port, sessionA.session_id));

    expect(questionAId).not.toBe("");
    expect(questionBId).not.toBe("");

    try {
      await waitForSocketOpen(socketA);
      socketA.send(JSON.stringify({ type: "connected" }));
      socketA.send(JSON.stringify({ type: "response", id: questionAId, answer: { text: "from A" } }));
      await waitForAnswered(store, sessionA.session_id, questionAId);

      expect(store.getSession(sessionA.session_id)?.questions.get(questionAId)?.status).toBe("answered");
      expect(store.getSession(sessionB.session_id)?.questions.get(questionBId)?.status).toBe("pending");
    } finally {
      await closeSocket(socketA, store, sessionA.session_id);
    }
  });
});
