import { describe, expect, it } from "bun:test";

import { isUnderRuntime, isUnderSource, RUNTIME_DEPLOY_PATHS } from "@/utils/runtime-deploy/paths";

describe("runtime-deploy paths", () => {
  it("exposes the canonical source and runtime paths", () => {
    expect(RUNTIME_DEPLOY_PATHS.source).toBe("/root/CODE/micode");
    expect(RUNTIME_DEPLOY_PATHS.runtime).toBe("/root/.micode");
    expect(RUNTIME_DEPLOY_PATHS.runtimeBundle).toBe("/root/.micode/dist/index.js");
  });

  it("identifies paths under source", () => {
    expect(isUnderSource("/root/CODE/micode/src/index.ts")).toBe(true);
    expect(isUnderSource("/root/.micode/dist/index.js")).toBe(false);
  });

  it("identifies paths under runtime", () => {
    expect(isUnderRuntime("/root/.micode/dist/index.js")).toBe(true);
    expect(isUnderRuntime("/root/CODE/micode/src/index.ts")).toBe(false);
  });

  it("rejects empty input on the under-source check", () => {
    expect(isUnderSource("")).toBe(false);
    expect(isUnderRuntime("")).toBe(false);
  });
});
