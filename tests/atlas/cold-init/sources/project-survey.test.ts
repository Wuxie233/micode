import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectProjectSurvey } from "@/atlas/cold-init/sources/project-survey";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-survey-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectProjectSurvey", () => {
  it("returns null fields when no documentation present", async () => {
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.readmeSummary).toBeNull();
    expect(survey.architectureSummary).toBeNull();
    expect(survey.packageManifest).toBeNull();
  });

  it("captures README content when present", async () => {
    writeFileSync(join(projectRoot, "README.md"), "# Hello\n\nA project.", "utf8");
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.readmeSummary).toContain("Hello");
  });

  it("parses package.json name and scripts", async () => {
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "demo", description: "x", scripts: { test: "bun test" } }),
      "utf8",
    );
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.packageManifest?.kind).toBe("node");
    expect(survey.packageManifest?.name).toBe("demo");
    expect(survey.packageManifest?.scripts).toContain("test");
  });
});
