// tests/tools/spawn-agent-args.test.ts
import { describe, expect, it } from "bun:test";

import { INVALID_ARGS_MESSAGE, NO_AGENTS_MESSAGE, normalizeSpawnAgentArgs } from "../../src/tools/spawn-agent-args";

const sampleTask = {
  agent: "implementer-frontend",
  prompt: "Build the login form.",
  description: "Login form scaffolding",
};

const secondTask = {
  agent: "implementer-backend",
  prompt: "Wire the auth endpoint.",
  description: "Auth endpoint wiring",
};

describe("normalizeSpawnAgentArgs", () => {
  describe("accepted shapes", () => {
    it("normalizes canonical wrapped array", () => {
      const outcome = normalizeSpawnAgentArgs({ agents: [sampleTask] });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([sampleTask]);
      }
    });

    it("normalizes top-level single task object", () => {
      const outcome = normalizeSpawnAgentArgs({ ...sampleTask });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([sampleTask]);
      }
    });

    it("normalizes wrapped single task object", () => {
      const outcome = normalizeSpawnAgentArgs({ agents: { ...sampleTask } });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([sampleTask]);
      }
    });

    it("normalizes top-level task array", () => {
      const outcome = normalizeSpawnAgentArgs([sampleTask]);

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([sampleTask]);
      }
    });

    it("preserves order across multiple canonical tasks", () => {
      const outcome = normalizeSpawnAgentArgs({ agents: [sampleTask, secondTask] });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([sampleTask, secondTask]);
      }
    });

    it("preserves order across multiple top-level array tasks", () => {
      const outcome = normalizeSpawnAgentArgs([secondTask, sampleTask]);

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([secondTask, sampleTask]);
      }
    });
  });

  describe("empty inputs", () => {
    it("returns NO_AGENTS_MESSAGE for empty wrapped array", () => {
      const outcome = normalizeSpawnAgentArgs({ agents: [] });

      expect(outcome).toEqual({ ok: false, message: NO_AGENTS_MESSAGE });
    });

    it("returns NO_AGENTS_MESSAGE for empty top-level array", () => {
      const outcome = normalizeSpawnAgentArgs([]);

      expect(outcome).toEqual({ ok: false, message: NO_AGENTS_MESSAGE });
    });
  });

  describe("invalid task shapes", () => {
    it("rejects canonical task missing description", () => {
      const outcome = normalizeSpawnAgentArgs({
        agents: [{ agent: "implementer-frontend", prompt: "Hello." }],
      });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects top-level task missing prompt", () => {
      const outcome = normalizeSpawnAgentArgs({
        agent: "implementer-frontend",
        description: "No prompt.",
      });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects task with non-string agent field", () => {
      const outcome = normalizeSpawnAgentArgs({
        agents: [{ agent: 1, prompt: "p", description: "d" }],
      });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects task with non-string prompt field", () => {
      const outcome = normalizeSpawnAgentArgs({
        agents: [{ agent: "x", prompt: 7, description: "d" }],
      });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });
  });

  describe("invalid containers", () => {
    it("rejects { agents: string }", () => {
      const outcome = normalizeSpawnAgentArgs({ agents: "implementer" });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects null", () => {
      const outcome = normalizeSpawnAgentArgs(null);

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects undefined", () => {
      const outcome = normalizeSpawnAgentArgs(undefined);

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects number primitive", () => {
      const outcome = normalizeSpawnAgentArgs(42);

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects string primitive", () => {
      const outcome = normalizeSpawnAgentArgs("implementer");

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("rejects empty record", () => {
      const outcome = normalizeSpawnAgentArgs({});

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });
  });

  describe("ambiguous payloads", () => {
    it("agents key wins over top-level fields when agents is invalid", () => {
      const outcome = normalizeSpawnAgentArgs({
        ...sampleTask,
        agents: "bad",
      });

      expect(outcome).toEqual({ ok: false, message: INVALID_ARGS_MESSAGE });
    });

    it("agents key wins over top-level fields when agents is valid", () => {
      const outcome = normalizeSpawnAgentArgs({
        agent: "top",
        prompt: "top prompt",
        description: "top description",
        agents: [secondTask],
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.tasks).toEqual([secondTask]);
      }
    });
  });

  describe("never throws", () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["string", "implementer"],
      ["empty record", {}],
      ["empty wrapped array", { agents: [] }],
      ["empty top-level array", []],
      ["bad agents container", { agents: "bad" }],
      ["wrong field type", { agents: [{ agent: 1, prompt: "p", description: "d" }] }],
    ];

    for (const [label, input] of cases) {
      it(`does not throw for ${label}`, () => {
        expect(() => normalizeSpawnAgentArgs(input)).not.toThrow();
      });
    }
  });
});
