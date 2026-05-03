import { describe, expect, it } from "bun:test";

import { candidateIdFor } from "@/skill-autopilot/candidate-id";

describe("candidateIdFor", () => {
  it("produces stable ids for same project + content", () => {
    const a = candidateIdFor("proj1", "trig", ["a", "b"]);
    const b = candidateIdFor("proj1", "trig", ["a", "b"]);
    expect(a).toBe(b);
  });

  it("differs across projects", () => {
    const a = candidateIdFor("proj1", "t", ["a"]);
    const b = candidateIdFor("proj2", "t", ["a"]);
    expect(a).not.toBe(b);
  });
});
