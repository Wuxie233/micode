import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverProject } from "@/atlas/cold-init/discover";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "discover-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("discoverProject", () => {
  it("returns a discovery shape on an empty project", async () => {
    const out = await discoverProject({ projectRoot, projectMemory: { list: async () => [] } });
    expect(out.projectRoot).toBe(projectRoot);
    expect(out.modules).toHaveLength(0);
    expect(out.lifecycleRecords).toHaveLength(0);
  });

  it("aggregates modules and designs", async () => {
    mkdirSync(join(projectRoot, "src", "alpha"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "alpha", "index.ts"), "// alpha module\n", "utf8");
    mkdirSync(join(projectRoot, "thoughts", "shared", "designs"), { recursive: true });
    writeFileSync(join(projectRoot, "thoughts", "shared", "designs", "x.md"), "# X\n\nbody", "utf8");
    writeFileSync(join(projectRoot, "README.md"), "# demo\n", "utf8");
    const out = await discoverProject({ projectRoot, projectMemory: { list: async () => [] } });
    expect(out.modules.length).toBeGreaterThanOrEqual(1);
    expect(out.designs.length).toBeGreaterThanOrEqual(1);
    expect(out.readmeSummary).toContain("demo");
  });

  it("propagates project memory decisions and risks", async () => {
    const out = await discoverProject({
      projectRoot,
      projectMemory: {
        list: async () => [
          { id: "d1", type: "decision", title: "use X", body: "...", status: "active" },
          { id: "r1", type: "risk", title: "drift", body: "...", status: "active" },
          { id: "q1", type: "open_question", title: "unknown", body: "...", status: "open" },
        ],
      },
    });
    expect(out.projectMemoryDecisions).toHaveLength(1);
    expect(out.projectMemoryRisks).toHaveLength(1);
    expect(out.projectMemoryOpenQuestions).toHaveLength(1);
  });
});
