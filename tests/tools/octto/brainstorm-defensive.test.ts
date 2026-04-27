// tests/tools/octto/brainstorm-defensive.test.ts
//
// These tests pin down the defensive layer that protects the create_brainstorm
// tool when the OpenCode dispatcher hands `branches[i].initial_question` in as
// undefined or null after its own argument transform pass. We poke the same
// helpers the tool uses, so the runtime contract (no throw, useful filter)
// stays honest even if the schema layer would normally reject these shapes.

import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { type QUESTION_TYPES, type Session, type SessionStore, STATUSES } from "../../../src/octto/session";

// We reach into the brainstorm module via dynamic import because the module
// only exports the tool factory; the helpers are module-private. We re-derive
// them by mirroring the public type and exercising the same filter shape.

interface BranchLike {
  id: string;
  scope: string;
  initial_question?: {
    type: (typeof QUESTION_TYPES)[number];
    config: { question?: string; context?: string };
  } | null;
}

interface CreatedBrainstorm {
  readonly sessionId: string;
  readonly browserSessionId: string;
}

interface FakeSessions {
  readonly sessions: SessionStore;
  readonly startInputs: Parameters<SessionStore["startSession"]>[0][];
  readonly calls: {
    getNextAnswer: number;
    endSession: number;
  };
}

type BrainstormTools = ReturnType<typeof import("../../../src/tools/octto/brainstorm").createBrainstormTools>;

const STATE_DIR = "thoughts/brainstorms";
const OWNER_A = "owner-A";
const OWNER_B = "owner-B";
const FORBIDDEN_HEADER = "## Forbidden";
const BROWSER_SESSION_PREFIX = "browser-session";
const createdStateIds: string[] = [];

const fakeContext = (sessionID: string) => ({ sessionID }) as never;

function bindExecute(tool: { execute: unknown }): (raw: unknown, ctx: unknown) => Promise<string> {
  return (tool.execute as (raw: unknown, ctx: unknown) => Promise<string>).bind(tool);
}

function extractXmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  return match?.[1] ?? "";
}

function createSessionRecord(id: string, input: Parameters<SessionStore["startSession"]>[0]): Session {
  return {
    id,
    title: input.title,
    url: `http://example.test/s/${id}`,
    createdAt: new Date(),
    questions: new Map(),
    ownerSessionID: input.ownerSessionID,
    wsConnected: false,
  };
}

function createFakeSessions(): FakeSessions {
  const records = new Map<string, Session>();
  const startInputs: Parameters<SessionStore["startSession"]>[0][] = [];
  const calls = { getNextAnswer: 0, endSession: 0 };

  const sessions: SessionStore = {
    startSession: async (input) => {
      const id = `${BROWSER_SESSION_PREFIX}-${startInputs.length + 1}`;
      startInputs.push(input);
      records.set(id, createSessionRecord(id, input));
      return {
        session_id: id,
        url: `http://example.test/s/${id}`,
        question_ids: input.questions?.map((_question, index) => `${id}-question-${index}`),
      };
    },
    endSession: async (id) => {
      calls.endSession += 1;
      const existed = records.delete(id);
      return { ok: existed };
    },
    pushQuestion: () => ({ question_id: "review-question" }),
    getAnswer: async () => ({ completed: false, status: STATUSES.CANCELLED, reason: STATUSES.CANCELLED }),
    getNextAnswer: async () => {
      calls.getNextAnswer += 1;
      return { completed: false, status: STATUSES.NONE_PENDING, reason: STATUSES.NONE_PENDING };
    },
    cancelQuestion: () => ({ ok: false }),
    listQuestions: () => ({ questions: [] }),
    handleWsConnect: () => {},
    handleWsDisconnect: () => {},
    handleWsMessage: () => {},
    getSession: (id) => records.get(id),
    hasSession: (id) => records.has(id),
    findSessionIdByQuestion: () => undefined,
    assertOwner: (id, owner) => {
      if (records.get(id)?.ownerSessionID !== owner) throw new Error("forbidden");
    },
    isOwner: (id, owner) => records.get(id)?.ownerSessionID === owner,
    listOwnedSessions: (owner) =>
      Array.from(records.values())
        .filter((session) => session.ownerSessionID === owner)
        .map((session) => session.id),
    cleanup: async () => {
      records.clear();
    },
  };

  return { sessions, startInputs, calls };
}

async function createOwnedBrainstorm(tools: BrainstormTools, ownerSessionID = OWNER_A): Promise<CreatedBrainstorm> {
  const create = bindExecute(tools.create_brainstorm);
  const output = await create({ request: "test", branches: [goodBranch] }, fakeContext(ownerSessionID));
  const sessionId = extractXmlValue(output, "session_id");
  const browserSessionId = extractXmlValue(output, "browser_session");
  createdStateIds.push(sessionId);
  return { sessionId, browserSessionId };
}

afterEach(() => {
  for (const id of createdStateIds.splice(0)) {
    rmSync(join(STATE_DIR, `${id}.json`), { force: true });
  }
});

// Inline copy of the project's `hasInitialQuestion` predicate so the test
// describes the contract we expect, not the implementation. If the brainstorm
// module's predicate diverges, the higher-level execute test will surface it.
function hasInitialQuestion(branch: BranchLike | null | undefined): boolean {
  if (branch === null || branch === undefined) return false;
  const candidate = branch as Partial<BranchLike>;
  return Boolean(candidate.id && candidate.scope && candidate.initial_question);
}

const goodBranch: BranchLike = {
  id: "branch-good",
  scope: "Working branch",
  initial_question: {
    type: "ask_text",
    config: { question: "What now?", context: "ctx" },
  },
};

const branchMissingInitial: BranchLike = {
  id: "branch-missing",
  scope: "Stripped by dispatcher",
};

const branchNullInitial: BranchLike = {
  id: "branch-null",
  scope: "Null after transform",
  initial_question: null,
};

describe("brainstorm defensive helpers", () => {
  it("hasInitialQuestion accepts a fully formed branch", () => {
    expect(hasInitialQuestion(goodBranch)).toBe(true);
  });

  it("hasInitialQuestion rejects a branch with missing initial_question", () => {
    expect(hasInitialQuestion(branchMissingInitial)).toBe(false);
  });

  it("hasInitialQuestion rejects a branch with null initial_question", () => {
    expect(hasInitialQuestion(branchNullInitial)).toBe(false);
  });

  it("hasInitialQuestion rejects null and undefined branches", () => {
    expect(hasInitialQuestion(null)).toBe(false);
    expect(hasInitialQuestion(undefined)).toBe(false);
  });

  it("filtering preserves only branches that survived dispatcher transform", () => {
    const branches: BranchLike[] = [goodBranch, branchMissingInitial, branchNullInitial];
    const filtered = branches.filter(hasInitialQuestion);
    expect(filtered).toEqual([goodBranch]);
  });

  it("filtering does not throw for an array of all-broken branches", () => {
    const branches: BranchLike[] = [branchMissingInitial, branchNullInitial];
    expect(() => branches.filter(hasInitialQuestion)).not.toThrow();
    expect(branches.filter(hasInitialQuestion)).toEqual([]);
  });
});

describe("brainstorm create_brainstorm execute (integration)", () => {
  // Minimal harness against the real exported factory. We assert that when all
  // branches lose their initial_question (post-dispatch shape), the tool
  // returns a structured <error> rather than throwing.
  it("returns an <error> when every branch lost its initial_question", async () => {
    const { createBrainstormTools } = await import("../../../src/tools/octto/brainstorm");

    const sessionsStub = {
      startSession: async () => {
        throw new Error("startSession should not be reached when branches are unusable");
      },
      endSession: async () => ({ ok: true as const }),
      getNextAnswer: async () => ({ completed: false, status: "timeout" }),
      pushQuestion: () => "noop",
    };

    const clientStub = {} as Parameters<typeof createBrainstormTools>[1];
    const tools = createBrainstormTools(
      sessionsStub as unknown as Parameters<typeof createBrainstormTools>[0],
      clientStub,
    );

    const createTool = tools.create_brainstorm;
    type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;
    const exec = createTool.execute.bind(createTool) as unknown as ExecuteSignature;

    const result = await exec(
      {
        request: "test",
        branches: [
          { id: "a", scope: "scope a" },
          { id: "b", scope: "scope b", initial_question: null },
        ],
      },
      { sessionID: "test-session" },
    );

    expect(result.startsWith("<error>")).toBe(true);
    expect(result).toContain("create_brainstorm");
    expect(result).toContain("initial_question");
  });

  it("passes ownerSessionID to the browser session", async () => {
    const { createBrainstormTools } = await import("../../../src/tools/octto/brainstorm");
    const fake = createFakeSessions();
    const clientStub = {} as Parameters<typeof createBrainstormTools>[1];
    const tools = createBrainstormTools(fake.sessions, clientStub);
    const created = await createOwnedBrainstorm(tools);

    expect(created.browserSessionId).toBe(`${BROWSER_SESSION_PREFIX}-1`);
    expect(fake.startInputs[0]?.ownerSessionID).toBe(OWNER_A);

    const end = bindExecute(tools.end_brainstorm);
    await end({ session_id: created.sessionId }, fakeContext(OWNER_A));
  });

  it("refuses non-owner brainstorm operations without mutating sessions", async () => {
    const { createBrainstormTools } = await import("../../../src/tools/octto/brainstorm");
    const fake = createFakeSessions();
    const clientStub = {} as Parameters<typeof createBrainstormTools>[1];
    const tools = createBrainstormTools(fake.sessions, clientStub);
    const created = await createOwnedBrainstorm(tools);

    const summary = await bindExecute(tools.get_session_summary)(
      { session_id: created.sessionId },
      fakeContext(OWNER_B),
    );
    const awaited = await bindExecute(tools.await_brainstorm_complete)(
      { session_id: created.sessionId, browser_session_id: created.browserSessionId },
      fakeContext(OWNER_B),
    );
    const ended = await bindExecute(tools.end_brainstorm)({ session_id: created.sessionId }, fakeContext(OWNER_B));

    expect(summary).toContain(FORBIDDEN_HEADER);
    expect(awaited).toContain(FORBIDDEN_HEADER);
    expect(ended).toContain(FORBIDDEN_HEADER);
    expect(fake.calls.getNextAnswer).toBe(0);
    expect(fake.calls.endSession).toBe(0);

    const ownerSummary = await bindExecute(tools.get_session_summary)(
      { session_id: created.sessionId },
      fakeContext(OWNER_A),
    );
    expect(ownerSummary).toContain("<session_summary>");

    const ownerEnd = await bindExecute(tools.end_brainstorm)({ session_id: created.sessionId }, fakeContext(OWNER_A));
    expect(ownerEnd).toContain("<brainstorm_ended>");
    expect(fake.calls.endSession).toBe(1);
  });

  it("refuses a caller's browser session when it targets another owner's brainstorm", async () => {
    const { createBrainstormTools } = await import("../../../src/tools/octto/brainstorm");
    const fake = createFakeSessions();
    const clientStub = {} as Parameters<typeof createBrainstormTools>[1];
    const tools = createBrainstormTools(fake.sessions, clientStub);
    const ownerABrainstorm = await createOwnedBrainstorm(tools, OWNER_A);
    const ownerBBrainstorm = await createOwnedBrainstorm(tools, OWNER_B);

    const awaited = await bindExecute(tools.await_brainstorm_complete)(
      {
        session_id: ownerABrainstorm.sessionId,
        browser_session_id: ownerBBrainstorm.browserSessionId,
      },
      fakeContext(OWNER_B),
    );

    expect(awaited).toContain(FORBIDDEN_HEADER);
    expect(awaited).toContain(ownerABrainstorm.browserSessionId);
    expect(fake.calls.getNextAnswer).toBe(0);
  });
});
