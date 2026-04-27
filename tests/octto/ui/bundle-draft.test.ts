import { describe, expect, it } from "bun:test";
import { createContext, Script } from "node:vm";

import { getHtmlBundle } from "@/octto/ui";

interface FakeElement {
  innerHTML: string;
  textContent: string;
  readonly value: string;
  remove: () => void;
  before: (_child: FakeElement) => void;
  appendChild: (_child: FakeElement) => void;
  querySelector: (_selector: string) => FakeElement | null;
  querySelectorAll: (_selector: string) => FakeElement[];
}

interface Runtime {
  readonly root: FakeElement;
  readonly socket: FakeWebSocket;
  readonly api: {
    readonly editAnswer: (questionId: string) => void;
    readonly sendDraftAnswers: () => void;
    readonly submitAnswer: (questionId: string, answer: Record<string, unknown>) => void;
  };
}

const SESSION_ID = "session-123";
const PLACEHOLDER = "__OCTTO_SESSION_ID_PLACEHOLDER__";
const SCRIPT_RE = /<script>\n([\s\S]*)\n {2}<\/script>/;
const SUBMIT_RE = /function submitAnswer\(questionId, answer\) \{[\s\S]*?\n {4}\}/;
const RESPONSE_TYPE = "response";

interface FakeWebSocket {
  readonly sent: string[];
  readonly url: string;
  onmessage: ((event: { readonly data: string }) => void) | null;
  readonly send: (payload: string) => void;
}

function createFakeWebSocket(url: string): FakeWebSocket {
  const sent: string[] = [];
  return {
    sent,
    url,
    onmessage: null,
    send: (payload: string) => {
      sent.push(payload);
    },
  };
}

function createElement(): FakeElement {
  let html = "";
  return {
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
    },
    get textContent() {
      return html;
    },
    set textContent(value: string) {
      html = escapeHtml(value);
    },
    value: "",
    remove: () => {},
    before: (_child: FakeElement) => {},
    appendChild: (_child: FakeElement) => {},
    querySelector: (_selector: string) => null,
    querySelectorAll: (_selector: string) => [],
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function extractScript(html: string): string {
  const match = SCRIPT_RE.exec(html);
  expect(match?.[1]).toBeString();
  return match?.[1] ?? "";
}

function encodeSessionId(sessionId: string): string {
  return JSON.stringify(sessionId).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function htmlForSession(sessionId: string): string {
  return getHtmlBundle().replace(PLACEHOLDER, encodeSessionId(sessionId));
}

function createRuntime(protocol = "https:", sessionId = SESSION_ID): Runtime {
  const root = createElement();
  let socket: FakeWebSocket | undefined;
  const document = {
    addEventListener: () => {},
    createElement,
    getElementById: (id: string) => (id === "root" ? root : createElement()),
    querySelector: (_selector: string) => null,
    querySelectorAll: (_selector: string) => [],
  };
  const window = {
    location: {
      host: "octto.example.test",
      pathname: "/not-a-session-path",
      protocol,
    },
  };
  function WebSocket(url: string): FakeWebSocket {
    const created = createFakeWebSocket(url);
    socket = created;
    return created;
  }
  const script = new Script(
    `${extractScript(htmlForSession(sessionId))}\n({ editAnswer, sendDraftAnswers, submitAnswer });`,
  );
  const context = createContext({
    document,
    marked: { parse: (value: string) => value },
    setTimeout: () => undefined,
    WebSocket,
    window,
  });
  const api = script.runInContext(context) as Runtime["api"];

  expect(socket).toBeDefined();
  return { api, root, socket: socket as FakeWebSocket };
}

function sendQuestion(runtime: Runtime, id = "q1"): void {
  runtime.socket.onmessage?.({
    data: JSON.stringify({
      type: "question",
      id,
      questionType: "ask_text",
      config: { question: `Question ${id}?`, context: "" },
    }),
  });
}

describe("octto UI bundle draft-before-send", () => {
  const html = getHtmlBundle();

  it("injects the session id from the script placeholder", () => {
    const script = extractScript(html);

    expect(script).toContain(`const sessionId = JSON.parse("${PLACEHOLDER}");`);
    expect(html).not.toContain(`<!-- ${PLACEHOLDER} -->`);
    expect(script).not.toContain("window.location.pathname");
    expect(html).toContain("window.location.protocol === 'https:'");
    expect(html).toContain("wss://");
    expect(html).toContain("'/ws/' + encodeURIComponent(sessionId)");
  });

  it("builds session-scoped WebSocket URLs from the injected session id", () => {
    const secureRuntime = createRuntime("https:", "session with space");
    const insecureRuntime = createRuntime("http:", "plain-session");

    expect(secureRuntime.socket.url).toBe("wss://octto.example.test/ws/session%20with%20space");
    expect(insecureRuntime.socket.url).toBe("ws://octto.example.test/ws/plain-session");
  });

  it("keeps per-question submit from sending over the WebSocket", () => {
    const match = SUBMIT_RE.exec(html);
    expect(match?.[0]).toBeString();
    expect(match?.[0] ?? "").not.toContain("ws.send");
  });

  it("contains the review, draft, edit, and batch-send affordances", () => {
    expect(html).toContain("Review Answers");
    expect(html).toContain("Send ");
    expect(html).toContain("[DRAFT]");
    expect(html).toContain("editAnswer");
    expect(html).toContain("sendDraftAnswers");
  });

  it("stores draft answers locally until the batch send action flushes them once", () => {
    const runtime = createRuntime();
    expect(runtime.socket.url).toBe(`wss://octto.example.test/ws/${SESSION_ID}`);

    sendQuestion(runtime);
    runtime.api.submitAnswer("q1", { text: "draft answer" });

    expect(runtime.socket.sent).toEqual([]);
    expect(runtime.root.innerHTML).toContain("Review Answers");
    expect(runtime.root.innerHTML).toContain("[DRAFT]");
    expect(runtime.root.innerHTML).toContain("Edit");

    runtime.api.sendDraftAnswers();
    runtime.api.sendDraftAnswers();

    expect(runtime.socket.sent).toHaveLength(1);
    expect(JSON.parse(runtime.socket.sent[0] ?? "{}")).toEqual({
      type: RESPONSE_TYPE,
      id: "q1",
      answer: { text: "draft answer" },
    });
    expect(runtime.root.innerHTML).toContain("[OK]");
    expect(runtime.root.innerHTML).not.toContain("[DRAFT]");
  });

  it("keeps the current question visible while reviewing unsent drafts", () => {
    const runtime = createRuntime();

    sendQuestion(runtime, "q1");
    sendQuestion(runtime, "q2");
    runtime.api.submitAnswer("q1", { text: "draft answer" });

    const questionIndex = runtime.root.innerHTML.indexOf("Question q2?");
    const reviewIndex = runtime.root.innerHTML.indexOf("Review Answers");

    expect(questionIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThan(questionIndex);
    expect(runtime.root.innerHTML).toContain("[DRAFT]");
  });

  it("lets draft answers be edited before they are sent", () => {
    const runtime = createRuntime();

    sendQuestion(runtime);
    runtime.api.submitAnswer("q1", { text: "draft answer" });
    runtime.api.editAnswer("q1");

    expect(runtime.socket.sent).toEqual([]);
    expect(runtime.root.innerHTML).not.toContain("[DRAFT]");
    expect(runtime.root.innerHTML).toContain("Question q1?");
  });
});
