// tests/tools/octto/schema.test.ts
import { describe, expect, it } from "bun:test";
import { tool } from "@opencode-ai/plugin/tool";

import { createBrainstormTools } from "../../../src/tools/octto/brainstorm";
import { createQuestionTools } from "../../../src/tools/octto/questions";
import { createSessionTools } from "../../../src/tools/octto/session";

type ArgsShape = Parameters<typeof tool>[0]["args"];

const schemaFor = (args: unknown) => tool.schema.object(args as ArgsShape);

const question = {
  type: "ask_text",
  config: { question: "Question?" },
};

const branch = {
  id: "frontend",
  scope: "Frontend scope",
  initial_question: question,
};

const option = {
  id: "a",
  label: "Option A",
  description: "First option",
};

describe("octto array-like tool schemas", () => {
  const sessionTools = createSessionTools({} as never);
  const questionTools = createQuestionTools({} as never);
  const brainstormTools = createBrainstormTools({} as never, {} as never);

  it("accepts start_session questions as array, single object, or indexed object", () => {
    const schema = schemaFor(sessionTools.start_session.args);

    expect(schema.safeParse({ questions: [question] }).success).toBe(true);
    expect(schema.safeParse({ questions: question }).success).toBe(true);
    expect(schema.safeParse({ questions: { "0": question } }).success).toBe(true);
  });

  it("accepts create_brainstorm branches as array, single object, or indexed object", () => {
    const schema = schemaFor(brainstormTools.create_brainstorm.args);

    expect(schema.safeParse({ request: "Request", branches: [branch] }).success).toBe(true);
    expect(schema.safeParse({ request: "Request", branches: branch }).success).toBe(true);
    expect(schema.safeParse({ request: "Request", branches: { "0": branch } }).success).toBe(true);
  });

  it("accepts question option lists as array, single object, or indexed object", () => {
    const schema = schemaFor(questionTools.pick_one.args);

    expect(schema.safeParse({ session_id: "s", question: "Pick", options: [option] }).success).toBe(true);
    expect(schema.safeParse({ session_id: "s", question: "Pick", options: option }).success).toBe(true);
    expect(schema.safeParse({ session_id: "s", question: "Pick", options: { "0": option } }).success).toBe(true);
  });

  it("accepts show_plan sections and emoji options in array-like shapes", () => {
    const showPlan = schemaFor(questionTools.show_plan.args);
    const emoji = schemaFor(questionTools.emoji_react.args);
    const section = { id: "summary", title: "Summary", content: "Markdown" };

    expect(showPlan.safeParse({ session_id: "s", question: "Review", sections: section }).success).toBe(true);
    expect(showPlan.safeParse({ session_id: "s", question: "Review", sections: { "0": section } }).success).toBe(true);
    expect(emoji.safeParse({ session_id: "s", question: "React", emojis: "👍" }).success).toBe(true);
    expect(emoji.safeParse({ session_id: "s", question: "React", emojis: { "0": "👍" } }).success).toBe(true);
  });
});
