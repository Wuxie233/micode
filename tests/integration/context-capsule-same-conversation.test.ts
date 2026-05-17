import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuiltContextCapsule, ContextCapsuleRef } from "@/agents/context-capsule";
import {
  buildContextCapsule,
  evaluateContextCapsuleFreshness,
  findReusableContextCapsule,
  hashText,
  parseContextCapsuleDocument,
  resolveConversationAnchor,
} from "@/agents/context-capsule";

const tempDirs: string[] = [];

const branch = "issue-93-working-context-capsule-v2-trigger-reuse-anchor";
const headSha = "abc123";
const sessionId = "same-conversation-session";
const sourcePath = "src/agents/executor.ts";
const sourceContent = "executor-direct confirmed reusable context";
const sourceHashes = { [sourcePath]: hashText(sourceContent) };

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function expectFreshCapsule(capsule: ReturnType<typeof buildContextCapsule>): BuiltContextCapsule {
  expect(capsule.status).toBe("fresh");
  if (capsule.status !== "fresh") throw new Error("expected fresh capsule");
  return capsule;
}

function buildDispatchCapsule(input: {
  readonly outputDir: string;
  readonly worktree: string;
  readonly conversationAnchor: string;
  readonly dispatchNumber: number;
  readonly parentCapsuleSha?: string | null;
}): BuiltContextCapsule {
  return expectFreshCapsule(
    buildContextCapsule({
      topic: `executor-direct dispatch ${input.dispatchNumber}`,
      lifecycleIssue: null,
      branch,
      headSha,
      worktree: input.worktree,
      outputDir: input.outputDir,
      createdAt: new Date(`2026-05-17T00:00:0${input.dispatchNumber}.000Z`),
      confirmedFacts: [`dispatch ${input.dispatchNumber} completed`],
      sourceFiles: [{ path: sourcePath, content: sourceContent }],
      conversationAnchor: input.conversationAnchor,
      generatedBy: "executor",
      dispatchKind: "executor-direct",
      parentCapsuleSha: input.parentCapsuleSha ?? null,
    }),
  );
}

async function findReusable(input: {
  readonly outputDir: string;
  readonly lifecycleIssue?: number | null;
  readonly conversationAnchor: string | null;
  readonly worktree: string;
}): Promise<ContextCapsuleRef | null> {
  return findReusableContextCapsule({
    directory: input.outputDir,
    lifecycleIssue: input.lifecycleIssue ?? null,
    conversationAnchor: input.conversationAnchor,
    branch,
    worktree: input.worktree,
  });
}

function expectFreshReuse(
  capsule: ContextCapsuleRef,
  input: { readonly conversationAnchor: string; readonly worktree: string },
) {
  const parsed = parseContextCapsuleDocument(capsule.content);

  expect(
    evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: input.conversationAnchor,
      branch,
      headSha,
      worktree: input.worktree,
      sourceHashes,
      frontmatter: parsed.frontmatter,
    }),
  ).toEqual({
    status: "fresh",
    reasons: [],
    staleSourceFiles: [],
  });

  return parsed;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("context capsule same-conversation executor-direct reuse", () => {
  it("chains three same-conversation dispatches and keeps restart, null-anchor, and worktree boundaries", async () => {
    const outputDir = makeTempDir("context-capsule-same-conversation-store-");
    const worktree = makeTempDir("context-capsule-same-conversation-worktree-");
    const otherWorktree = makeTempDir("context-capsule-same-conversation-other-worktree-");
    const conversationAnchor = resolveConversationAnchor(sessionId);
    const restartedConversationAnchor = resolveConversationAnchor("new-session-after-restart");

    expect(conversationAnchor).toBeTruthy();
    expect(restartedConversationAnchor).toBeTruthy();
    expect(restartedConversationAnchor).not.toBe(conversationAnchor);
    expect(resolveConversationAnchor(null)).toBeNull();

    expect(await findReusable({ outputDir, conversationAnchor, worktree })).toBeNull();

    const dispatch1 = buildDispatchCapsule({ outputDir, worktree, conversationAnchor, dispatchNumber: 1 });

    const dispatch2Reuse = await findReusable({ outputDir, conversationAnchor, worktree });
    expect(dispatch2Reuse?.sha).toBe(dispatch1.sha);
    const dispatch2ReuseParsed = expectFreshReuse(dispatch2Reuse!, { conversationAnchor, worktree });
    expect(dispatch2ReuseParsed.frontmatter.parent_capsule).toBeNull();

    const dispatch2 = buildDispatchCapsule({
      outputDir,
      worktree,
      conversationAnchor,
      dispatchNumber: 2,
      parentCapsuleSha: dispatch2Reuse!.sha,
    });

    const dispatch3Reuse = await findReusable({ outputDir, conversationAnchor, worktree });
    expect(dispatch3Reuse?.sha).toBe(dispatch2.sha);
    const dispatch3ReuseParsed = expectFreshReuse(dispatch3Reuse!, { conversationAnchor, worktree });
    expect(dispatch3ReuseParsed.frontmatter.parent_capsule).toBe(dispatch1.sha);

    buildDispatchCapsule({
      outputDir,
      worktree,
      conversationAnchor,
      dispatchNumber: 3,
      parentCapsuleSha: dispatch3Reuse!.sha,
    });

    expect(await findReusable({ outputDir, conversationAnchor: restartedConversationAnchor, worktree })).toBeNull();
    expect(await findReusable({ outputDir, conversationAnchor: null, worktree })).toBeNull();
    expect(await findReusable({ outputDir, conversationAnchor, worktree: otherWorktree })).toBeNull();
  });
});
