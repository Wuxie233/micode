import { describe, expect, it } from "bun:test";
import { $ } from "bun";

const PROJECT_ROOT = process.cwd();
const NOT_IGNORED_EXIT_CODE = 1;
const IGNORED_EXIT_CODE = 0;

describe("gitignore tiered policy", () => {
  it("ignores thoughts/ledgers/CONTINUITY*.md", async () => {
    const probe = "thoughts/ledgers/CONTINUITY_test_probe.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(IGNORED_EXIT_CODE);
  });

  it("ignores thoughts/lifecycle/<n>.json", async () => {
    const probe = "thoughts/lifecycle/9999.json";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(IGNORED_EXIT_CODE);
  });

  it("ignores thoughts/brainstorms/", async () => {
    const probe = "thoughts/brainstorms/probe.json";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(IGNORED_EXIT_CODE);
  });

  it("ignores thoughts/octto/", async () => {
    const probe = "thoughts/octto/sessions/probe.json";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(IGNORED_EXIT_CODE);
  });

  it("does NOT ignore thoughts/shared/designs/*.md", async () => {
    const probe = "thoughts/shared/designs/2099-01-01-probe-design.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(NOT_IGNORED_EXIT_CODE);
  });

  it("does NOT ignore thoughts/shared/plans/*.md", async () => {
    const probe = "thoughts/shared/plans/2099-01-01-probe.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(NOT_IGNORED_EXIT_CODE);
  });
});
