import { describe, expect, it } from "bun:test";

import {
  COLD_INIT_DEFAULT_PROJECT_TYPE,
  COLD_INIT_DESIGN_EXCERPT_CHARS,
  COLD_INIT_QUESTION_GROUP_MAX,
  COLD_INIT_QUESTION_GROUP_MIN,
  COLD_INIT_QUESTION_TIMEOUT_MS,
  COLD_INIT_README_EXCERPT_CHARS,
  COLD_INIT_RUN_ID_PREFIX,
  COLD_INIT_WORKER_CONCURRENCY_MAX,
} from "@/atlas/cold-init/config";

describe("cold-init config", () => {
  it("worker concurrency cap is positive", () => {
    expect(COLD_INIT_WORKER_CONCURRENCY_MAX).toBeGreaterThan(0);
  });

  it("question timeout is at least one minute", () => {
    expect(COLD_INIT_QUESTION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("question group bounds are sane", () => {
    expect(COLD_INIT_QUESTION_GROUP_MIN).toBeGreaterThanOrEqual(1);
    expect(COLD_INIT_QUESTION_GROUP_MAX).toBeGreaterThan(COLD_INIT_QUESTION_GROUP_MIN);
  });

  it("excerpt sizes are positive", () => {
    expect(COLD_INIT_DESIGN_EXCERPT_CHARS).toBeGreaterThan(0);
    expect(COLD_INIT_README_EXCERPT_CHARS).toBeGreaterThan(0);
  });

  it("run id prefix is stable", () => {
    expect(COLD_INIT_RUN_ID_PREFIX).toBe("cold-init");
  });

  it("default project type is generic", () => {
    expect(COLD_INIT_DEFAULT_PROJECT_TYPE).toBe("generic");
  });
});
