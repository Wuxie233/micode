import { describe, expect, it } from "bun:test";

import { createLifecycleRunner } from "@/lifecycle/runner";

const VERSION_ARGS = ["--version"] as const;
const OK_EXIT_CODE = 0;

describe("createLifecycleRunner", () => {
  it("runs git commands", async () => {
    const runner = createLifecycleRunner();

    const completed = await runner.git(VERSION_ARGS);

    expect(completed.exitCode).toBe(OK_EXIT_CODE);
    expect(completed.stdout.trim().length).toBeGreaterThan(0);
  });

  it("runs gh commands", async () => {
    const runner = createLifecycleRunner();

    const completed = await runner.gh(VERSION_ARGS);

    expect(completed.exitCode).toBe(OK_EXIT_CODE);
    expect(completed.stdout.trim().length).toBeGreaterThan(0);
  });
});
