// tests/utils/required-test-paths.test.ts
import { describe, expect, it } from "bun:test";

import { REQUIRED_TEST_PATHS, requiresTest } from "@/utils/config";

describe("REQUIRED_TEST_PATHS", () => {
  it("exports a non-empty readonly array of RegExp patterns", () => {
    expect(Array.isArray(REQUIRED_TEST_PATHS)).toBe(true);
    expect(REQUIRED_TEST_PATHS.length).toBe(3);
    for (const pattern of REQUIRED_TEST_PATHS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe("requiresTest — positive: src/utils/ prefix", () => {
  it("matches a direct file under src/utils/", () => {
    expect(requiresTest("src/utils/config.ts")).toBe(true);
  });

  it("matches a nested file under src/utils/", () => {
    expect(requiresTest("src/utils/runtime-deploy/index.ts")).toBe(true);
  });

  it("matches src/utils/parser-test/foo.ts because of the src/utils/ prefix", () => {
    expect(requiresTest("src/utils/parser-test/foo.ts")).toBe(true);
  });
});

describe("requiresTest — positive: schema(s).ts basename", () => {
  it("matches schema.ts in any directory", () => {
    expect(requiresTest("src/lifecycle/schema.ts")).toBe(true);
  });

  it("matches schemas.ts in any directory", () => {
    expect(requiresTest("src/octto/schemas.ts")).toBe(true);
  });

  it("matches schema.ts at project root depth", () => {
    expect(requiresTest("schema.ts")).toBe(true);
  });

  it("matches a deeply nested schema.ts", () => {
    expect(requiresTest("src/a/b/c/schema.ts")).toBe(true);
  });
});

describe("requiresTest — positive: parser(s).ts basename", () => {
  it("matches parser.ts in any directory", () => {
    expect(requiresTest("src/project-memory/parser.ts")).toBe(true);
  });

  it("matches parsers.ts in any directory", () => {
    expect(requiresTest("src/something/parsers.ts")).toBe(true);
  });

  it("matches parser.ts at root depth", () => {
    expect(requiresTest("parser.ts")).toBe(true);
  });

  it("matches a deeply nested parsers.ts", () => {
    expect(requiresTest("src/x/y/parsers.ts")).toBe(true);
  });
});

describe("requiresTest — negative: paths that do not match any pattern", () => {
  it("does not match src/agents/planner.ts", () => {
    expect(requiresTest("src/agents/planner.ts")).toBe(false);
  });

  it("does not match src/octto/session.ts", () => {
    expect(requiresTest("src/octto/session.ts")).toBe(false);
  });

  it("does not match src/hooks/foo.ts", () => {
    expect(requiresTest("src/hooks/foo.ts")).toBe(false);
  });

  it("does not match a generic UI display path", () => {
    expect(requiresTest("src/ui/display.ts")).toBe(false);
  });

  it("does not match src/index.ts", () => {
    expect(requiresTest("src/index.ts")).toBe(false);
  });

  it("does not match a file merely containing 'schema' mid-path (not as basename)", () => {
    // 'schema-utils/helper.ts' — the word 'schema' is part of a directory segment, not the file name
    expect(requiresTest("src/agents/schema-utils/helper.ts")).toBe(false);
  });

  it("does not match a file merely containing 'parser' mid-path (not as basename)", () => {
    expect(requiresTest("src/agents/parser-helpers/index.ts")).toBe(false);
  });
});
