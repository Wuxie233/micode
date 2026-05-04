import { describe, expect, it } from "bun:test";

import { runAtlasInit, runAtlasRefresh, runAtlasStatus } from "@/tools/atlas";

describe("atlas tools barrel", () => {
  it("re-exports the three command implementations", () => {
    expect(typeof runAtlasInit).toBe("function");
    expect(typeof runAtlasStatus).toBe("function");
    expect(typeof runAtlasRefresh).toBe("function");
  });
});
