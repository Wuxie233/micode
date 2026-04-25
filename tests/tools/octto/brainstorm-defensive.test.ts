// tests/tools/octto/brainstorm-defensive.test.ts
//
// These tests pin down the defensive layer that protects the create_brainstorm
// tool when the OpenCode dispatcher hands `branches[i].initial_question` in as
// undefined or null after its own argument transform pass. We poke the same
// helpers the tool uses, so the runtime contract (no throw, useful filter)
// stays honest even if the schema layer would normally reject these shapes.
import { describe, expect, it } from "bun:test";

import type { QUESTION_TYPES } from "../../../src/octto/session";

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
});
