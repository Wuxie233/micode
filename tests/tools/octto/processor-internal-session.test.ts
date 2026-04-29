import { describe, expect, it } from "bun:test";

import { type Answer, QUESTIONS, type SessionStore } from "@/octto/session";
import { BRANCH_STATUSES, type BrainstormState, type StateStore } from "@/octto/state";
import { processAnswer } from "@/tools/octto/processor";
import type { OpencodeClient } from "@/tools/octto/types";
import { deleteInternalSession } from "@/utils/internal-session";

const EMPTY_DIRECTORY = "";
const SESSION_ID = "brainstorm-session";
const BROWSER_SESSION_ID = "browser-session";
const BRANCH_ID = "branch-a";
const QUESTION_ID = "question-a";
const PROBE_SESSION_ID = "probe-session";
const PROBE_TITLE = `probe-${BRANCH_ID}`;
const PROBE_AGENT = "probe";
const FINDING = "ready to proceed";
const DELETE_FAILURE = "delete failed";

interface SessionCreateRequest {
  readonly body: { readonly title?: string };
  readonly query?: { readonly directory: string };
}

interface SessionPromptRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly agent?: string; readonly parts?: readonly unknown[] };
}

interface SessionDeleteRequest {
  readonly path: { readonly id: string };
  readonly query?: { readonly directory: string };
}

interface RecordedClient {
  readonly client: OpencodeClient;
  readonly creates: readonly SessionCreateRequest[];
  readonly prompts: readonly SessionPromptRequest[];
  readonly deletes: readonly SessionDeleteRequest[];
}

function createBrainstormState(): BrainstormState {
  return {
    session_id: SESSION_ID,
    browser_session_id: BROWSER_SESSION_ID,
    request: "Choose a direction",
    created_at: 1,
    updated_at: 1,
    branch_order: [BRANCH_ID],
    branches: {
      [BRANCH_ID]: {
        id: BRANCH_ID,
        scope: "Check feasibility",
        status: BRANCH_STATUSES.EXPLORING,
        questions: [{ id: QUESTION_ID, type: QUESTIONS.ASK_TEXT, text: "What next?", config: {} }],
        finding: null,
      },
    },
  };
}

function createStateStore(state: BrainstormState): StateStore {
  return {
    createSession: async () => state,
    getSession: async () => state,
    setBrowserSessionId: async () => {},
    addQuestionToBranch: async (_sessionId, _branchId, question) => question,
    recordAnswer: async () => {},
    completeBranch: async (_sessionId, branchId, finding) => {
      const branch = state.branches[branchId];
      if (!branch) throw new Error(`Missing branch ${branchId}`);
      branch.status = BRANCH_STATUSES.DONE;
      branch.finding = finding;
    },
    getNextExploringBranch: async () => state.branches[BRANCH_ID] ?? null,
    isSessionComplete: async () => false,
    deleteSession: async () => {},
  };
}

function createSessionStore(): SessionStore {
  return {
    pushQuestion: () => ({ question_id: "follow-up" }),
  } as unknown as SessionStore;
}

function createClient(): RecordedClient {
  const creates: SessionCreateRequest[] = [];
  const prompts: SessionPromptRequest[] = [];
  const deletes: SessionDeleteRequest[] = [];
  const client = {
    session: {
      create: async (request: SessionCreateRequest) => {
        creates.push(request);
        return { data: { id: PROBE_SESSION_ID } };
      },
      prompt: async (request: SessionPromptRequest) => {
        prompts.push(request);
        return { data: { parts: [{ type: "text", text: JSON.stringify({ done: true, finding: FINDING }) }] } };
      },
      delete: async (request: SessionDeleteRequest) => {
        deletes.push(request);
        return { data: {} };
      },
    },
  } as unknown as OpencodeClient;
  return { client, creates, prompts, deletes };
}

describe("octto processor internal session usage", () => {
  it("creates and deletes probe sessions with helper request shape", async () => {
    const state = createBrainstormState();
    const recorded = createClient();

    await processAnswer(
      createStateStore(state),
      createSessionStore(),
      SESSION_ID,
      BROWSER_SESSION_ID,
      QUESTION_ID,
      { text: "answered" } satisfies Answer,
      recorded.client,
    );

    expect(recorded.creates).toEqual([{ body: { title: PROBE_TITLE }, query: { directory: EMPTY_DIRECTORY } }]);
    expect(recorded.prompts[0]?.path.id).toBe(PROBE_SESSION_ID);
    expect(recorded.prompts[0]?.body.agent).toBe(PROBE_AGENT);
    expect(recorded.deletes).toEqual([{ path: { id: PROBE_SESSION_ID }, query: { directory: EMPTY_DIRECTORY } }]);
    expect(state.branches[BRANCH_ID]?.finding).toBe(FINDING);
  });

  it("deleteInternalSession resolves after retry exhaustion for probe cleanup", async () => {
    const deletes: SessionDeleteRequest[] = [];
    const warnings: string[] = [];
    const ctx = {
      directory: EMPTY_DIRECTORY,
      client: {
        session: {
          delete: async (request: SessionDeleteRequest) => {
            deletes.push(request);
            throw new Error(DELETE_FAILURE);
          },
        },
      },
    } as unknown as Parameters<typeof deleteInternalSession>[0]["ctx"];

    await expect(
      deleteInternalSession({
        ctx,
        sessionId: PROBE_SESSION_ID,
        agent: PROBE_AGENT,
        logger: {
          warn: (_module, message) => {
            warnings.push(message);
          },
        },
        sleep: async () => {},
      }),
    ).resolves.toBeUndefined();

    expect(deletes).toHaveLength(3);
    expect(warnings[0]).toContain(PROBE_SESSION_ID);
    expect(warnings[0]).toContain(PROBE_AGENT);
  });
});
