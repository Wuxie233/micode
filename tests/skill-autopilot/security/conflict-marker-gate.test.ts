import { describe, expect, it } from "bun:test";

import { conflictMarkerGate, hasConflictMarkers } from "@/skill-autopilot/security/conflict-marker-gate";

function inp(body: string) {
  return { name: "n", description: "d", trigger: "t", steps: ["s"], body, frontmatter: { name: "n" } };
}

describe("conflictMarkerGate", () => {
  it("rejects content with conflict markers", () => {
    expect(conflictMarkerGate(inp("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> branch\n")).ok).toBe(false);
  });

  it("passes clean content", () => {
    expect(conflictMarkerGate(inp("a\nb\nc")).ok).toBe(true);
  });

  it("hasConflictMarkers helper exposes detection for the loader", () => {
    expect(hasConflictMarkers("<<<<<<< HEAD")).toBe(true);
    expect(hasConflictMarkers("ok")).toBe(false);
  });
});
