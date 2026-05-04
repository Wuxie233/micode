import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannedNode, VaultPlan } from "@/atlas/cold-init/types";
import { writeVault } from "@/atlas/cold-init/vault-writer";
import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { ATLAS_LAYERS, type AtlasLayer } from "@/atlas/types";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "vault-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const createNode = (id: string, layer: AtlasLayer, relativePath: string, inferred = false): PlannedNode => ({
  id,
  layer,
  relativePath,
  title: id,
  summary: "seed summary",
  sources: [],
  connections: [],
  inferred,
});

const createPlan = (): VaultPlan => ({
  indexNode: createNode("index", ATLAS_LAYERS.DECISION, "00-index.md"),
  buildNodes: [createNode("10-impl/alpha", ATLAS_LAYERS.IMPL, "10-impl/alpha.md")],
  behaviorNodes: [createNode("20-behavior/feature", ATLAS_LAYERS.BEHAVIOR, "20-behavior/feature.md", true)],
  decisionNodes: [createNode("40-decisions/roadmap", ATLAS_LAYERS.DECISION, "40-decisions/roadmap.md")],
  riskNodes: [createNode("50-risks/drift", ATLAS_LAYERS.RISK, "50-risks/drift.md", true)],
  timelineNodes: [createNode("60-timeline/initial", ATLAS_LAYERS.TIMELINE, "60-timeline/initial.md")],
});

describe("writeVault", () => {
  it("writes every cold-init layer, the maintenance log, and the schema version file", async () => {
    const out = await writeVault({
      projectRoot,
      runId: "cold-init-test",
      plan: createPlan(),
      answers: {},
    });

    expect(out.nodesWritten).toBe(6);
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "10-impl", "alpha.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "20-behavior", "feature.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "roadmap.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "50-risks", "drift.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "60-timeline", "initial.md"))).toBe(true);
    expect(readFileSync(join(projectRoot, "atlas", "_meta", "schema-version"), "utf8")).toBe(
      `${ATLAS_SCHEMA_VERSION}\n`,
    );
    expect(out.logPath).toBe(join(projectRoot, "atlas", "_meta", "log", "cold-init-test.md"));
    expect(readFileSync(out.logPath, "utf8")).toContain("I wrote 6 nodes");
    expect(existsSync(out.stagingDir)).toBe(false);
  });

  it("incorporates user notes in node body when answers map provides them", async () => {
    await writeVault({
      projectRoot,
      runId: "cold-init-test",
      plan: createPlan(),
      answers: { "behavior.20-behavior/feature": "User said: this is the X flow." },
    });

    const body = readFileSync(join(projectRoot, "atlas", "20-behavior", "feature.md"), "utf8");
    expect(body).toContain("User notes");
    expect(body).toContain("X flow");
    expect(body).not.toContain("confidence");
    expect(body).not.toContain("human_authored");
  });

  it("rolls back staging and skips schema version when a write cannot commit", async () => {
    const bad = createNode("bad", ATLAS_LAYERS.IMPL, "10-impl");
    const plan: VaultPlan = { ...createPlan(), buildNodes: [bad] };

    await expect(writeVault({ projectRoot, runId: "rollback-test", plan, answers: {} })).rejects.toThrow();

    expect(existsSync(join(projectRoot, "atlas", "_meta", "staging", "rollback-test"))).toBe(false);
    expect(existsSync(join(projectRoot, "atlas", "_meta", "schema-version"))).toBe(false);
  });
});
