import { describe, expect, it } from "bun:test";

import { toOcttoPayloads } from "@/atlas/cold-init/octto-adapter";
import type { ColdInitQuestion } from "@/atlas/cold-init/questions";

const intent: ColdInitQuestion = {
  id: "intent.pitch",
  group: "intent",
  type: "ask_text",
  question: "What is X for?",
  skippable: true,
  defaultAnswer: null,
};

describe("toOcttoPayloads", () => {
  it("prepends a group label to the question text", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].config.question).toContain("[Project intent]");
  });

  it("propagates the question key for answer correlation", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].questionKey).toBe("intent.pitch");
  });

  it("marks skippable questions with allowCancel=true", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].config.allowCancel).toBe(true);
  });
});
