import { describe, expect, it } from "bun:test";

import { evaluateConflictResolverScope } from "@/lifecycle/conflict-scope";

describe("conflict resolver scope guard", () => {
  it("allows conflict files and a small number of directly related tests/types/call sites", () => {
    const result = evaluateConflictResolverScope({
      conflictFiles: ["src/lifecycle/merge.ts"],
      modifiedFiles: ["src/lifecycle/merge.ts", "tests/lifecycle/merge.test.ts", "src/lifecycle/types.ts"],
    });

    expect(result).toEqual({
      status: "allowed",
      extraFiles: ["tests/lifecycle/merge.test.ts", "src/lifecycle/types.ts"],
      reasons: [
        "tests/lifecycle/merge.test.ts: direct test for conflicted file src/lifecycle/merge.ts",
        "src/lifecycle/types.ts: type/schema/call-site in conflicted directory src/lifecycle",
      ],
    });
  });

  it("blocks unrelated files and excessive scope expansion", () => {
    expect(
      evaluateConflictResolverScope({
        conflictFiles: ["src/lifecycle/merge.ts"],
        modifiedFiles: ["src/lifecycle/merge.ts", "src/agents/commander.ts"],
      }),
    ).toMatchObject({ status: "blocked", blockedFiles: ["src/agents/commander.ts"] });

    expect(
      evaluateConflictResolverScope({
        conflictFiles: ["src/lifecycle/merge.ts"],
        modifiedFiles: [
          "src/lifecycle/merge.ts",
          "tests/lifecycle/merge.test.ts",
          "src/lifecycle/types.ts",
          "src/lifecycle/index.ts",
          "src/lifecycle/runner.ts",
        ],
        maxExtraFiles: 2,
      }),
    ).toMatchObject({ status: "blocked", reason: "too_many_extra_files" });
  });
});
