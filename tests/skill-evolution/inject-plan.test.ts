import { describe, expect, it } from "bun:test";

import type { LookupHit } from "@/project-memory";
import { planProcedureInjection } from "@/skill-evolution/inject-plan";

const hit = (overrides: Partial<LookupHit["entry"]> = {}, score = 1, snippet = "summary text"): LookupHit => ({
  entry: {
    id: "entry_1",
    projectId: "p1",
    entityId: "ent_1",
    type: "procedure",
    title: "title",
    summary: "summary text",
    status: "tentative",
    sensitivity: "internal",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  },
  entity: { id: "ent_1", projectId: "p1", kind: "module", name: "x", createdAt: 1, updatedAt: 1 },
  sources: [],
  snippet,
  score,
  degraded: false,
});

const baseCfg = {
  enabled: true,
  maxInjectedProcedures: 3,
  injectionCharBudget: 500,
  snippetMaxChars: 80,
};

describe("planProcedureInjection", () => {
  it("returns null when feature is disabled", () => {
    const out = planProcedureInjection({ ...baseCfg, enabled: false, hits: [hit()] });
    expect(out).toBeNull();
  });

  it("returns null when there are zero matches", () => {
    const out = planProcedureInjection({ ...baseCfg, hits: [] });
    expect(out).toBeNull();
  });

  it("formats up to maxInjectedProcedures matches inside a procedure-context block", () => {
    const hits = [
      hit({ id: "e1", title: "t1" }),
      hit({ id: "e2", title: "t2" }),
      hit({ id: "e3", title: "t3" }),
      hit({ id: "e4", title: "t4" }),
    ];
    const out = planProcedureInjection({ ...baseCfg, maxInjectedProcedures: 2, hits });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out).toContain("<procedure-context>");
    expect(out).toContain("</procedure-context>");
    expect(out).toContain("t1");
    expect(out).toContain("t2");
    expect(out).not.toContain("t3");
  });

  it("truncates each snippet to snippetMaxChars characters", () => {
    const long = "x".repeat(500);
    const out = planProcedureInjection({
      ...baseCfg,
      snippetMaxChars: 20,
      hits: [hit({ summary: "unused fallback" }, 1, long)],
    });
    expect(out).not.toBeNull();
    if (!out) return;
    const line = out.split("\n").find((part) => part.startsWith("- [title]"));
    expect(line).toBe(`- [title] ${"x".repeat(19)}…`);
  });

  it("stops adding entries once the char budget would be exceeded", () => {
    const long = "y".repeat(200);
    const hits = [
      hit({ id: "e1", title: "first", summary: "unused fallback" }, 1, long),
      hit({ id: "e2", title: "second", summary: "unused fallback" }, 1, long),
      hit({ id: "e3", title: "third", summary: "unused fallback" }, 1, long),
    ];
    const out = planProcedureInjection({ ...baseCfg, injectionCharBudget: 250, hits });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.length).toBeLessThanOrEqual(250);
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(out).not.toContain("third");
  });

  it("returns null if no entry fits within the char budget", () => {
    const out = planProcedureInjection({
      ...baseCfg,
      injectionCharBudget: 5,
      snippetMaxChars: 200,
      hits: [hit({ summary: "long summary text here" })],
    });
    expect(out).toBeNull();
  });
});
