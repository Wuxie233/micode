import { describe, expect, it } from "bun:test";

import { formatLookupResults } from "@/project-memory/format";

describe("formatLookupResults", () => {
  it("renders an empty-state line when there are no hits", () => {
    expect(formatLookupResults("perm cache", [])).toContain("No project memory entries");
  });

  it("renders entry title, type, status, source pointers, and snippet", () => {
    const out = formatLookupResults("perm cache", [
      {
        entry: {
          id: "x1",
          projectId: "p",
          entityId: "e1",
          type: "decision",
          title: "Cache TTL 30s",
          summary: "Decided to cache permissions for 30s",
          status: "active",
          sensitivity: "internal",
          createdAt: 1,
          updatedAt: 1,
        },
        entity: { id: "e1", projectId: "p", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 },
        sources: [
          {
            id: "s1",
            projectId: "p",
            entryId: "x1",
            kind: "design",
            pointer: "thoughts/shared/designs/2026-04-28.md",
            createdAt: 1,
          },
        ],
        snippet: "Decided to cache permissions for 30s",
        score: 1.5,
        degraded: false,
      },
    ]);
    expect(out).toContain("Cache TTL 30s");
    expect(out).toContain("decision");
    expect(out).toContain("auth");
    expect(out).toContain("thoughts/shared/designs/2026-04-28.md");
  });

  it("marks degraded entries with a warning glyph", () => {
    const out = formatLookupResults("x", [
      {
        entry: {
          id: "x1",
          projectId: "p",
          entityId: "e1",
          type: "fact",
          title: "T",
          summary: "S",
          status: "active",
          sensitivity: "internal",
          createdAt: 1,
          updatedAt: 1,
        },
        entity: { id: "e1", projectId: "p", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 },
        sources: [],
        snippet: "S",
        score: 1,
        degraded: true,
      },
    ]);
    expect(out.toLowerCase()).toContain("degraded");
  });
});
